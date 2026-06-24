import { createClient } from "@/lib/supabase/client";
import { variantCode } from "@/lib/po-meta";
import type { ProgramCard, ProgramCardDesign, ProgramCardFormValues } from "@/lib/types";

/** Public Storage bucket holding the program-card PDF colour cuttings (migration 005). */
export const CUTTING_BUCKET = "program-cuttings";

const PC_COLUMNS =
  "id, program_uid, lot_no, po_unique_id, program_date, dying_house_name, total_meters, color, color_cutting_attached, total_color_cutting, delivery_days, pdf_url, created_at";

const numOrNull = (s: string): number | null => {
  const t = (s ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const sanitize = (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80) || "cutting.pdf";

type Supabase = ReturnType<typeof createClient>;

/** Every program card (full columns), newest first. QC'd ones are filtered in the UI. */
export async function fetchProgramCards(): Promise<ProgramCard[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("program_cards")
    .select(PC_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProgramCard[];
}

/** Design cuttings for one program card (loaded on demand in the detail popup). */
export async function fetchProgramCardDesigns(programCardId: string): Promise<ProgramCardDesign[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("program_card_designs")
    .select("id, program_card, design_no, color, meter, cutting_url")
    .eq("program_card", programCardId)
    .order("design_no", { ascending: true }); // the A/B/C code is the canonical display order
  if (error) throw new Error(error.message);
  return (data ?? []) as ProgramCardDesign[];
}

/** Next "PG-{n}" number = (max existing n) + 1, read fresh at insert time. */
async function nextProgramNumber(supabase: Supabase): Promise<number> {
  const { data, error } = await supabase.from("program_cards").select("program_uid");
  if (error) throw new Error(error.message);
  let max = 0;
  for (const r of data ?? []) {
    const m = /^PG-(\d+)$/.exec((r as { program_uid: string | null }).program_uid ?? "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

/**
 * Create a program card + its colour cuttings. Each colour row may carry its own cutting
 * photo/PDF (White colours need none — white-swatch rule). Uploads run first, then the card
 * (PG-id auto-assigned, retried on a unique collision), then the design rows with cutting_url.
 */
export async function createProgramCard(values: ProgramCardFormValues): Promise<void> {
  const supabase = createClient();

  // Letter by the row's ORIGINAL position (the code the form showed) THEN drop blank rows, so a
  // saved design_no matches the displayed code even if an earlier colour row was left empty.
  const rows = values.designs
    .map((d, i) => ({ ...d, code: variantCode(i) }))
    .filter((d) => d.design_no.trim() !== "" || d.color.trim() !== "" || d.meter.trim() !== "" || d.file);

  const uploadedPaths: string[] = [];
  let cardId: string | null = null;
  try {
    // 1) upload each colour's cutting (path keyed by time+random, never the program id)
    const prepared: { design_no: string; color: string | null; meter: number | null; cutting_url: string | null }[] = [];
    for (const d of rows) {
      let cutting_url: string | null = null;
      if (d.file) {
        const path = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${sanitize(d.file.name)}`;
        const { error: upErr } = await supabase.storage
          .from(CUTTING_BUCKET)
          .upload(path, d.file, { contentType: d.file.type || "application/octet-stream", upsert: false });
        if (upErr) {
          throw new Error(
            `Couldn't upload the cutting for ${d.color.trim() || `colour ${d.code}`} (${upErr.message}). Make sure the "${CUTTING_BUCKET}" bucket exists (migration 005).`,
          );
        }
        uploadedPaths.push(path);
        cutting_url = supabase.storage.from(CUTTING_BUCKET).getPublicUrl(path).data.publicUrl;
      }
      prepared.push({ design_no: d.design_no.trim() || d.code, color: d.color.trim() || null, meter: numOrNull(d.meter), cutting_url });
    }

    const base = {
      lot_no: values.lot_no.trim() || null,
      po_unique_id: values.po_unique_id,
      program_date: values.program_date || null,
      dying_house_name: values.dying_house_name.trim() || null,
      total_meters: numOrNull(values.total_meters),
      color: values.color.trim() || null,
      delivery_days: numOrNull(values.delivery_days),
      color_cutting_attached: values.color_cutting_attached ?? false, // user-set Yes/No
      total_color_cutting: prepared.length || null,
      pdf_url: prepared.find((p) => p.cutting_url)?.cutting_url ?? null, // a representative cutting
    };

    // 2) insert the card, retrying the PG number on a unique collision
    const start = await nextProgramNumber(supabase);
    let assignedUid = "";
    let lastErr = "";
    for (let i = 0; i < 5; i++) {
      assignedUid = `PG-${start + i}`;
      const { data, error } = await supabase
        .from("program_cards")
        .insert({ program_uid: assignedUid, ...base })
        .select("id")
        .single();
      if (!error && data) {
        cardId = (data as { id: string }).id;
        break;
      }
      lastErr = error?.message ?? "Insert failed";
      if (error?.code !== "23505") throw new Error(lastErr);
    }
    if (!cardId) throw new Error(lastErr || "Could not assign a unique Program ID — please retry.");

    // 3) insert the colour cuttings (design_no = the A/B/C code)
    if (prepared.length) {
      const designRows = prepared.map((p) => ({ program_card: cardId, ...p }));
      const { error } = await supabase.from("program_card_designs").insert(designRows);
      if (error) {
        throw new Error(`Program card ${assignedUid} was created, but saving its colour cuttings failed: ${error.message}`);
      }
    }
  } catch (e) {
    // Only remove uploaded files when NO card was committed — once the card exists it owns them
    // (deleting would break the saved links); that partial case is surfaced to the user.
    if (!cardId) {
      for (const p of uploadedPaths) {
        try {
          await supabase.storage.from(CUTTING_BUCKET).remove([p]);
        } catch {
          /* best-effort cleanup — ignore */
        }
      }
    }
    throw e;
  }
}
