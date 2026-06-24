"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { usePageSearchInput } from "@/components/experience/CommandProvider";
import { useEscClose } from "@/lib/use-esc-close";
import {
  createMaster,
  deleteMaster,
  fetchMasters,
  updateMaster,
  MASTER_META,
  type MasterRow,
  type MasterTable,
} from "@/lib/masters";

export function MasterListsClient({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();

  const [table, setTable] = useState<MasterTable>("qualities");
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<MasterRow | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  usePageSearchInput(searchRef);

  const meta = MASTER_META.find((m) => m.table === table)!;
  const { data: rows = [], isFetching } = useQuery({ queryKey: ["masters", table], queryFn: () => fetchMasters(table) });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["masters", table] });

  const createM = useMutation({
    mutationFn: (name: string) => createMaster(table, name),
    onSuccess: () => { toast.success(`${meta.singular} added`); setNewName(""); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateM = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; active?: boolean } }) => updateMaster(table, id, patch),
    onSuccess: () => { toast.success("Updated"); setEditingId(null); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => deleteMaster(table, id),
    onSuccess: () => { toast.success("Deleted"); setDeleteTarget(null); invalidate(); },
    onError: (e: Error) => { toast.error(e.message); setDeleteTarget(null); },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  useEscClose(!!deleteTarget, () => setDeleteTarget(null));

  const startEdit = (r: MasterRow) => { setEditingId(r.id); setEditName(r.name); };
  const saveEdit = () => { if (editingId && editName.trim()) updateM.mutate({ id: editingId, patch: { name: editName.trim() } }); };
  const addNew = () => { if (newName.trim()) createM.mutate(newName.trim()); };

  return (
    <>
      <div className="seg" role="group" aria-label="Master list" style={{ marginBottom: 14, flexWrap: "wrap" }}>
        {MASTER_META.map((m) => (
          <button key={m.table} className={table === m.table ? "on" : ""} aria-pressed={table === m.table} onClick={() => { setTable(m.table); setSearch(""); setEditingId(null); }}>
            {m.label}
          </button>
        ))}
      </div>

      <div className="toolbar split">
        <div className="search">
          <Icon name="search" size={15} />
          <input ref={searchRef} placeholder={`Search ${meta.label.toLowerCase()}…`} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {isFetching && <span className="fetching">Updating…</span>}
      </div>

      {isAdmin && (
        <div className="master-add">
          <input
            placeholder={`Add a ${meta.singular}…`}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addNew(); }}
          />
          <button className="btn btn-primary" disabled={!newName.trim() || createM.isPending} onClick={addNew}>
            <Icon name="plus" size={15} />Add
          </button>
        </div>
      )}

      <div className="panel first" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <h3>{meta.label}</h3>
          <span className="tag">{rows.length} entr{rows.length === 1 ? "y" : "ies"}</span>
        </div>
        {filtered.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  {isAdmin && <th className="col-actions">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const inactive = r.active === false;
                  return (
                    <tr key={r.id}>
                      <td>
                        {editingId === r.id ? (
                          <input
                            className="inline-edit"
                            value={editName}
                            autoFocus
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                          />
                        ) : (
                          <span className="strong">{r.name}</span>
                        )}
                      </td>
                      <td><span className={`pill ${inactive ? "plain" : "success"}`}>{inactive ? "Inactive" : "Active"}</span></td>
                      {isAdmin && (
                        <td className="col-actions">
                          <div className="row-actions">
                            {editingId === r.id ? (
                              <>
                                <button className="act" disabled={updateM.isPending || !editName.trim()} onClick={saveEdit}><Icon name="check" size={14} />Save</button>
                                <button className="act" onClick={() => setEditingId(null)}>Cancel</button>
                              </>
                            ) : (
                              <>
                                <button className="act" title="Rename" onClick={() => startEdit(r)}><Icon name="pencil" size={14} /></button>
                                <button className="act" disabled={updateM.isPending} onClick={() => updateM.mutate({ id: r.id, patch: { active: inactive } })}>
                                  <Icon name={inactive ? "check" : "xCircle"} size={14} />{inactive ? "Reactivate" : "Deactivate"}
                                </button>
                                <button className="act danger" title="Delete" onClick={() => setDeleteTarget(r)}><Icon name="trash" size={14} /></button>
                              </>
                            )}
                          </div>
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
            <div className="ph-icon"><Icon name="columns" size={24} /></div>
            <h3>{rows.length ? "No matching entries" : `No ${meta.label.toLowerCase()} yet`}</h3>
            <p>{rows.length ? "Try a different search." : isAdmin ? `Add a ${meta.singular} above — it'll feed the form dropdowns.` : "An admin can add entries here."}</p>
          </div>
        )}
      </div>

      {!isAdmin && (
        <div className="subtle-note">
          <Icon name="info" size={16} />
          <span>Only admins can manage master lists. These entries feed the dropdowns in the PO &amp; Program forms.</span>
        </div>
      )}

      {deleteTarget && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setDeleteTarget(null)}>
          <div className="modal sm" role="dialog" aria-modal="true" aria-label="Delete entry?">
            <div className="modal-head">
              <div><h3>Delete entry?</h3><p>{deleteTarget.name}</p></div>
              <button className="close-x" onClick={() => setDeleteTarget(null)} aria-label="Close"><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              <p className="confirm-text">
                This permanently removes <b>{deleteTarget.name}</b> from {meta.label}. Existing records that already
                use this name are unaffected (the value is stored as text). Prefer <b>Deactivate</b> to just hide it
                from new dropdowns.
              </p>
            </div>
            <div className="modal-foot">
              <span />
              <div className="foot-actions">
                <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
                <button className="btn btn-danger" disabled={deleteM.isPending} onClick={() => deleteM.mutate(deleteTarget.id)}>
                  {deleteM.isPending ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
