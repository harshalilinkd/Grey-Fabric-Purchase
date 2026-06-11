"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { Icon } from "@/components/ui/Icon";
import type { TeamMember } from "@/lib/types";

export type MemberFormValues = {
  full_name: string;
  email: string;
  password: string;
  role: "admin" | "operator";
  department: string;
};

const EMPTY: MemberFormValues = { full_name: "", email: "", password: "", role: "operator", department: "" };

export function MemberFormModal({
  open,
  mode,
  member,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: "add" | "edit";
  member: TeamMember | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: MemberFormValues) => void;
}) {
  const [v, setV] = useState<MemberFormValues>(EMPTY);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && member) {
      setV({
        full_name: member.full_name ?? "",
        email: member.email ?? "",
        password: "",
        role: member.role === "admin" ? "admin" : "operator",
        department: member.department ?? "",
      });
    } else {
      setV(EMPTY);
    }
  }, [open, mode, member]);

  if (!open) return null;

  const set =
    (k: keyof MemberFormValues) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setV((p) => ({ ...p, [k]: e.target.value }));

  const canSave = v.email.trim() !== "" && (mode === "edit" || v.password.length >= 6);

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={mode === "add" ? "Add member" : "Edit member"}>
        <div className="modal-head">
          <div>
            <h3>{mode === "add" ? "Add team member" : "Edit team member"}</h3>
            <p>{mode === "add" ? "Creates a login and a profile" : "Update this member's details"}</p>
          </div>
          <button className="close-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}>
          <div className="modal-body">
            <div className="field">
              <label>Full name</label>
              <input value={v.full_name} onChange={set("full_name")} placeholder="Harshali Patel" />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" required value={v.email} onChange={set("email")} placeholder="user@ldsilkmills.com" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field">
                <label>Role</label>
                <select value={v.role} onChange={set("role")}>
                  <option value="operator">Operator</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="field">
                <label>Department</label>
                <input value={v.department} onChange={set("department")} placeholder="Procurement" />
              </div>
            </div>
            <div className="field">
              <label>{mode === "add" ? "Password" : "New password (leave blank to keep)"}</label>
              <input
                type="password"
                value={v.password}
                onChange={set("password")}
                placeholder={mode === "add" ? "min 6 characters" : "••••••••"}
                required={mode === "add"}
                autoComplete="new-password"
              />
            </div>
          </div>

          <div className="modal-foot">
            <span />
            <div className="foot-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={!canSave || saving}>
                {saving ? "Saving…" : mode === "add" ? "Add member" : "Save changes"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
