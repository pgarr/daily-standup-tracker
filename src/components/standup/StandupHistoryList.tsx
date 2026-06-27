import React, { useState } from "react";
import type { BlockerAlert, StandupEntry } from "@/types";

interface Props {
  entries: StandupEntry[];
  blockerAlerts: BlockerAlert[];
}

export default function StandupHistoryList({ entries, blockerAlerts }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editDid, setEditDid] = useState("");
  const [editPlan, setEditPlan] = useState("");
  const [editBlockers, setEditBlockers] = useState("");
  const [didError, setDidError] = useState<string | undefined>();
  const [planError, setPlanError] = useState<string | undefined>();

  function startEdit(entry: StandupEntry) {
    setEditingId(entry.id);
    setDeletingId(null);
    setEditDid(entry.did);
    setEditPlan(entry.plan);
    setEditBlockers(entry.blockers ?? "");
    setDidError(undefined);
    setPlanError(undefined);
  }

  function startDelete(entryId: string) {
    setDeletingId(entryId);
    setEditingId(null);
  }

  function handleEditSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    let valid = true;
    if (!editDid.trim()) {
      setDidError("What you did is required");
      valid = false;
    } else {
      setDidError(undefined);
    }
    if (!editPlan.trim()) {
      setPlanError("Plan for today is required");
      valid = false;
    } else {
      setPlanError(undefined);
    }
    if (!valid) e.preventDefault();
  }

  const textareaBase =
    "w-full resize-none rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-purple-400/60 focus:outline-none focus:ring-1 focus:ring-purple-400/40";

  if (entries.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium tracking-wide text-blue-100/60 uppercase">History</h2>
      <div className="space-y-3">
        {entries.map((entry) => {
          const entryAlert = blockerAlerts.find(
            (a) => a.trigger_date === entry.submitted_date && a.status === "confirmed",
          );
          const isEditing = editingId === entry.id;
          const isDeleting = deletingId === entry.id;

          return (
            <div
              key={entry.id}
              className="rounded-xl border border-white/10 bg-white/5 p-4 text-white backdrop-blur-xl"
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-medium text-purple-300">{entry.submitted_date}</p>
                <div className="flex items-center gap-2">
                  {entryAlert && (
                    <span className="rounded-full border border-red-400/40 bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-300">
                      ⚠ Recurring Blocker
                    </span>
                  )}
                  {!isEditing && !isDeleting && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          startEdit(entry);
                        }}
                        className="text-xs text-blue-100/50 transition hover:text-blue-100/80"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          startDelete(entry.id);
                        }}
                        className="text-xs text-red-400/60 transition hover:text-red-400/90"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>

              {isEditing ? (
                <form
                  method="POST"
                  action="/api/standup/update"
                  onSubmit={handleEditSubmit}
                  className="space-y-3"
                  noValidate
                >
                  <input type="hidden" name="id" value={entry.id} />
                  <div>
                    <label
                      htmlFor="edit-did"
                      className="mb-1 block text-xs font-medium tracking-wide text-blue-100/50 uppercase"
                    >
                      What you did
                    </label>
                    <textarea
                      id="edit-did"
                      name="did"
                      rows={3}
                      className={textareaBase}
                      value={editDid}
                      onChange={(e) => {
                        setEditDid(e.target.value);
                        if (didError) setDidError(undefined);
                      }}
                    />
                    {didError && <p className="mt-1 text-xs text-red-400">{didError}</p>}
                  </div>
                  <div>
                    <label
                      htmlFor="edit-plan"
                      className="mb-1 block text-xs font-medium tracking-wide text-blue-100/50 uppercase"
                    >
                      Plan
                    </label>
                    <textarea
                      id="edit-plan"
                      name="plan"
                      rows={3}
                      className={textareaBase}
                      value={editPlan}
                      onChange={(e) => {
                        setEditPlan(e.target.value);
                        if (planError) setPlanError(undefined);
                      }}
                    />
                    {planError && <p className="mt-1 text-xs text-red-400">{planError}</p>}
                  </div>
                  <div>
                    <label
                      htmlFor="edit-blockers"
                      className="mb-1 block text-xs font-medium tracking-wide text-blue-100/50 uppercase"
                    >
                      Blockers
                    </label>
                    <textarea
                      id="edit-blockers"
                      name="blockers"
                      rows={2}
                      className={textareaBase}
                      value={editBlockers}
                      onChange={(e) => {
                        setEditBlockers(e.target.value);
                      }}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="rounded-lg border border-purple-400/40 bg-purple-500/20 px-3 py-1.5 text-xs font-medium text-purple-200 transition hover:bg-purple-500/30"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                      }}
                      className="rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-medium text-blue-100/60 transition hover:bg-white/10"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : isDeleting ? (
                <div className="space-y-3">
                  <p className="text-sm text-blue-100/70">Delete this entry? This cannot be undone.</p>
                  <div className="flex gap-2">
                    <form method="POST" action="/api/standup/delete">
                      <input type="hidden" name="id" value={entry.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-red-400/40 bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-500/30"
                      >
                        Confirm delete
                      </button>
                    </form>
                    <button
                      type="button"
                      onClick={() => {
                        setDeletingId(null);
                      }}
                      className="rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-medium text-blue-100/60 transition hover:bg-white/10"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <p className="mb-1 text-xs font-medium tracking-wide text-blue-100/50 uppercase">What you did</p>
                    <p className="text-sm whitespace-pre-wrap text-blue-100/80">{entry.did}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium tracking-wide text-blue-100/50 uppercase">Plan</p>
                    <p className="text-sm whitespace-pre-wrap text-blue-100/80">{entry.plan}</p>
                  </div>
                  {entry.blockers && (
                    <div>
                      <p className="mb-1 text-xs font-medium tracking-wide text-blue-100/50 uppercase">Blockers</p>
                      <p className="text-sm whitespace-pre-wrap text-blue-100/80">{entry.blockers}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
