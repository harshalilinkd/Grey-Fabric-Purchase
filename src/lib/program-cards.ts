import { createClient } from "@/lib/supabase/client";
import type { ProgramCard, ProgramCardDesign, ProgramCardFormValues } from "@/lib/types";

/** Public Storage bucket holding the program-card PDF colour cuttings (migration 005). */
export const CUTTING_BUCKET = "program-cuttings";

const PC_COLUMNS =
  "id, program_uid, lot_no, po_unique_id, program_date, dying_house_name, total_meters, color_cutting_attached, total_color_cutting, delivery_days, pdf_url, created_at";

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
    .select("id, program_card, design_no, color, meter")
    .eq("program_card", programCardId)
    .order("created_at", { ascending: true });
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
 * Create a program card + its design cuttings, uploading the optional PDF cutting first.
 * The PG-id is auto-assigned and retried on a unique collision (concurrent creates).
 */
export async function createProgramCard(
  values: ProgramCardFormValues,
  file: File | null,
): Promise<void> {
  const supabase = createClient();

  // 1) Upload the PDF first. The path is keyed by time+random (not the program id), so a
  //    PG-id retry never strands or overwrites it. If the card insert fails outright we
  //    best-effort delete this object in the catch below, so a fully-failed create leaks nothing.
  let path: string | null = null;
  let pdf_url: string | null = null;
  if (file) {
    path = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${sanitize(file.name)}`;
    const { error: upErr } = await supabase.storage
      .from(CUTTING_BUCKET)
      .upload(path, file, { contentType: file.type || "application/pdf", upsert: false });
    if (upErr) {
      throw new Error(
        `Couldn't upload the PDF (${upErr.message}). Make sure the "${CUTTING_BUCKET}" storage bucket exists — run migration 005.`,
      );
    }
    pdf_url = supabase.storage.from(CUTTING_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  // Keep only cuttings that carry some data.
  const designs = values.designs.filter(
    (d) => d.design_no.trim() !== "" || d.color.trim() !== "" || d.meter.trim() !== "",
  );

  const base = {
    lot_no: values.lot_no.trim() || null,
    po_unique_id: values.po_unique_id,
    program_date: values.program_date || null,
    dying_house_name: values.dying_house_name.trim() || null,
    total_meters: numOrNull(values.total_meters),
    color_cutting_attached: !!file,
    total_color_cutting: designs.length || null,
    pdf_url,
  };

  let cardId: string | null = null;
  try {
    // 2) Insert the card, retrying with the next PG number if the id was taken in a race.
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
      if (error?.code !== "23505") throw new Error(lastErr); // not a duplicate-id race → real error
    }
    if (!cardId) throw new Error(lastErr || "Could not assign a unique Program ID — please retry.");

    // 3) Insert the design cuttings. RLS forbids operators from rolling back the card, so on
    //    failure we keep the (valid) card and just report — the client refreshes so it surfaces.
    if (designs.length) {
      const rows = designs.map((d) => ({
        program_card: cardId,
        design_no: d.design_no.trim() || null,
        color: d.color.trim() || null,
        meter: numOrNull(d.meter),
      }));
      const { error } = await supabase.from("program_card_designs").insert(rows);
      if (error) {
        throw new Error(`Program card ${assignedUid} was created, but saving its cuttings failed: ${error.message}`);
      }
    }
  } catch (e) {
    // Only remove the uploaded PDF when NO card was committed — once a card exists it owns the
    // file (deleting it would break the saved link); that partial case is surfaced to the user.
    if (path && !cardId) {
      try {
        await supabase.storage.from(CUTTING_BUCKET).remove([path]);
      } catch {
        /* best-effort cleanup — ignore */
      }
    }
    throw e;
  }
}
