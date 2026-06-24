"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { usePagePrimaryAction, usePageSearchInput } from "@/components/experience/CommandProvider";
import {
  createTeamMember,
  deleteTeamMember,
  fetchTeam,
  updateTeamMember,
  type NewMember,
  type TeamPatch,
} from "@/lib/team";
import { fmtDate } from "@/lib/format";
import { useEscClose } from "@/lib/use-esc-close";
import { MemberFormModal, type MemberFormValues } from "./MemberFormModal";
import type { TeamMember } from "@/lib/types";

function initials(m: TeamMember) {
  const name = (m.full_name ?? m.email ?? "?").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

const ROLE_LABEL: Record<string, string> = { super_admin: "Super admin", admin: "Admin", operator: "Operator" };
const ROLE_PILL: Record<string, string> = { super_admin: "brand", admin: "info", operator: "plain" };

export function TeamClient({ initialTeam, selfId }: { initialTeam: TeamMember[]; selfId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: team = [], isFetching } = useQuery({ queryKey: ["team"], queryFn: fetchTeam, initialData: initialTeam });

  const me = team.find((m) => m.id === selfId);
  const isSuper = me?.role === "super_admin";

  const [search, setSearch] = useState("");
  const [formMode, setFormMode] = useState<"add" | "edit" | null>(null);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<TeamMember | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TeamMember | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  usePageSearchInput(searchRef);
  // "Add member" is the page primary action (n key + palette) — only super admins can add.
  const openAdd = useCallback(() => { if (isSuper) { setEditing(null); setFormMode("add"); } }, [isSuper]);
  usePagePrimaryAction("Add member", openAdd);

  useEscClose(!!deactivateTarget, () => setDeactivateTarget(null));
  useEscClose(!!deleteTarget, () => setDeleteTarget(null));
  useEscClose(!!formMode, () => setFormMode(null));

  const invalidate = () => qc.invalidateQueries({ queryKey: ["team"] });

  const createM = useMutation({
    mutationFn: (input: NewMember) => createTeamMember(input),
    onSuccess: () => { toast.success("Member added"); invalidate(); setFormMode(null); },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateM = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TeamPatch }) => updateTeamMember(id, patch),
    onSuccess: (_d, { patch }) => {
      toast.success(
        patch.active === false ? "Member deactivated" : patch.active === true ? "Member reactivated" : "Member updated",
      );
      invalidate();
      setDeactivateTarget(null);
      setFormMode(null);
      setEditing(null);
    },
    onError: (e: Error) => { toast.error(e.message); setDeactivateTarget(null); },
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => deleteTeamMember(id),
    onSuccess: () => { toast.success("Member removed"); invalidate(); setDeleteTarget(null); },
    onError: (e: Error) => { toast.error(e.message); setDeleteTarget(null); },
  });

  /** Rows a super admin may manage (not self, not other super admins). */
  const canManage = (m: TeamMember) => isSuper && m.id !== selfId && m.role !== "super_admin";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return team;
    return team.filter((m) => {
      const status = m.active === false ? "deactivated" : "active";
      return [m.full_name, m.email, ROLE_LABEL[m.role], m.department, status].some((f) =>
        (f ?? "").toLowerCase().includes(q),
      );
    });
  }, [team, search]);

  const onFormSubmit = (v: MemberFormValues) => {
    const department = v.department.trim() || null;
    if (formMode === "add") {
      createM.mutate({ full_name: v.full_name.trim(), email: v.email.trim(), password: v.password, role: v.role, department });
    } else if (editing) {
      const patch: TeamPatch = {
        full_name: v.full_name.trim() || null,
        email: v.email.trim(),
        role: v.role,
        department,
      };
      if (v.password) patch.password = v.password;
      updateM.mutate({ id: editing.id, patch });
    }
  };

  return (
    <>
      <div className="toolbar split">
        <div className="search">
          <Icon name="search" size={15} />
          <input
            ref={searchRef}
            placeholder="Search name, email, role, department, status…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {isSuper && (
          <button className="btn btn-primary" onClick={openAdd}>
            <Icon name="plus" size={15} />Add member
          </button>
        )}
      </div>

      <div className="panel first">
        <div className="panel-head">
          <h3>Team Management</h3>
          <span className="tag">
            {search.trim() ? `${filtered.length} of ${team.length}` : `${team.length} member${team.length === 1 ? "" : "s"}`}
            {isFetching ? " · updating…" : ""}
          </span>
        </div>

        {filtered.length > 0 ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Email</th>
                <th>Role</th>
                <th>Department</th>
                <th>Status</th>
                <th>Joined</th>
                {isSuper && <th className="col-actions">Access</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const deactivated = m.active === false;
                return (
                  <tr key={m.id}>
                    <td>
                      <span className="member-cell">
                        <span className="member-avatar" aria-hidden="true">{initials(m)}</span>
                        <span className="strong">{m.full_name ?? "—"}</span>
                        {m.id === selfId && <span className="pill plain">You</span>}
                      </span>
                    </td>
                    <td>{m.email ?? "—"}</td>
                    <td><span className={`pill ${ROLE_PILL[m.role] ?? "plain"}`}>{ROLE_LABEL[m.role] ?? m.role}</span></td>
                    <td>{m.department ? m.department : <span className="dim">—</span>}</td>
                    <td><span className={`pill ${deactivated ? "danger" : "success"}`}>{deactivated ? "Deactivated" : "Active"}</span></td>
                    <td><span className="dim">{m.created_at ? fmtDate(m.created_at) : "—"}</span></td>
                    {isSuper && (
                      <td className="col-actions">
                        {canManage(m) ? (
                          <div className="row-actions">
                            <select
                              className="role-select"
                              value={m.role}
                              aria-label={`Role for ${m.full_name ?? m.email ?? "member"}`}
                              disabled={updateM.isPending}
                              onChange={(e) => updateM.mutate({ id: m.id, patch: { role: e.target.value as "admin" | "operator" } })}
                            >
                              <option value="operator">Operator</option>
                              <option value="admin">Admin</option>
                            </select>
                            <button className="act" title="Edit" onClick={() => { setEditing(m); setFormMode("edit"); }}>
                              <Icon name="pencil" size={14} />
                            </button>
                            {deactivated ? (
                              <button className="act" disabled={updateM.isPending} onClick={() => updateM.mutate({ id: m.id, patch: { active: true } })}>
                                <Icon name="check" size={14} />Reactivate
                              </button>
                            ) : (
                              <button className="act danger" disabled={updateM.isPending} onClick={() => setDeactivateTarget(m)}>
                                <Icon name="xCircle" size={14} />Deactivate
                              </button>
                            )}
                            <button className="act danger" title="Delete" onClick={() => setDeleteTarget(m)}>
                              <Icon name="trash" size={14} />
                            </button>
                          </div>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        ) : (
          <div className="empty">
            <div className="ph-icon"><Icon name="search" size={24} /></div>
            <h3>No matching members</h3>
            <p>Try a different search.</p>
          </div>
        )}
      </div>

      {!isSuper && (
        <div className="subtle-note">
          <Icon name="info" size={16} />
          <span>Only a super admin can manage team members.</span>
        </div>
      )}

      <MemberFormModal
        open={formMode !== null}
        mode={formMode ?? "add"}
        member={editing}
        saving={createM.isPending || updateM.isPending}
        onClose={() => { setFormMode(null); setEditing(null); }}
        onSubmit={onFormSubmit}
      />

      {deactivateTarget && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setDeactivateTarget(null)}>
          <div className="modal sm" role="dialog" aria-modal="true" aria-label="Deactivate member?">
            <div className="modal-head">
              <div><h3>Deactivate member?</h3><p>{deactivateTarget.full_name ?? deactivateTarget.email ?? "Member"}</p></div>
              <button className="close-x" onClick={() => setDeactivateTarget(null)} aria-label="Close"><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              <p className="confirm-text">
                <b>{deactivateTarget.full_name ?? deactivateTarget.email}</b> will be signed out and blocked from the app
                until reactivated. Their records and history are kept.
              </p>
            </div>
            <div className="modal-foot">
              <span />
              <div className="foot-actions">
                <button className="btn btn-ghost" onClick={() => setDeactivateTarget(null)}>Cancel</button>
                <button className="btn btn-danger" disabled={updateM.isPending} onClick={() => updateM.mutate({ id: deactivateTarget.id, patch: { active: false } })}>
                  {updateM.isPending ? "Deactivating…" : "Deactivate"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setDeleteTarget(null)}>
          <div className="modal sm" role="dialog" aria-modal="true" aria-label="Delete member?">
            <div className="modal-head">
              <div><h3>Delete member?</h3><p>{deleteTarget.full_name ?? deleteTarget.email ?? "Member"}</p></div>
              <button className="close-x" onClick={() => setDeleteTarget(null)} aria-label="Close"><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              <p className="confirm-text">
                This <b>permanently deletes</b> the login and profile for <b>{deleteTarget.full_name ?? deleteTarget.email}</b>.
                This cannot be undone — consider deactivating instead if you only want to block access.
              </p>
            </div>
            <div className="modal-foot">
              <span />
              <div className="foot-actions">
                <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
                <button className="btn btn-danger" disabled={deleteM.isPending} onClick={() => deleteM.mutate(deleteTarget.id)}>
                  {deleteM.isPending ? "Deleting…" : "Delete permanently"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
