"use client"

import type { Dispatch, SetStateAction } from "react"
import { ArrowUpDown, ChevronDown, ChevronUp, ListOrdered, Trash2 } from "lucide-react"
import { WAIVER_EMPTY_PENDING_TITLE } from "@/lib/waiver-wire/WaiverWireViewService"
import { parseOptionalNumber } from "@/lib/waiver-wire/WaiverClaimFlowController"

export type PendingClaimRow = {
  id: string
  addPlayerId: string
  dropPlayerId: string | null
  faabBid: number | null
  priorityOrder: number
  status: string
}

type RosterOption = { id: string; name: string | null }

type Props = {
  claims: PendingClaimRow[]
  isFaab: boolean
  rosterPlayers: RosterOption[]
  pendingEdits: Record<string, { faabBid: string; priority: string; dropPlayerId: string }>
  setPendingEdits: Dispatch<
    SetStateAction<Record<string, { faabBid: string; priority: string; dropPlayerId: string }>>
  >
  onSave: (claimId: string, idx: number, c: PendingClaimRow) => void
  onCancel: (claimId: string) => void
  /** Step 3C: move a claim up/down in the processing order (swaps priority with its neighbor). */
  onReorder?: (claimId: string, direction: "up" | "down") => void
  /** "Processes after …" for a claim on a player still on waivers after a drop; null otherwise. */
  processesAfterLabel?: (c: PendingClaimRow) => string | null
}

/**
 * Editable pending waiver queue (priority, optional FAAB, drop target).
 */
export default function PendingClaimsList({
  claims,
  isFaab,
  rosterPlayers,
  pendingEdits,
  setPendingEdits,
  onSave,
  onCancel,
  onReorder,
  processesAfterLabel,
}: Props) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4" data-testid="pending-claims-list">
      <div className="mb-2 flex items-center justify-between text-xs text-white/60">
        <span>Manage claim order, bids, and drops before processing.</span>
        <span className="inline-flex items-center gap-1">
          <ArrowUpDown className="h-3 w-3" />
          Use priority numbers to order your claims for batch runs.
        </span>
      </div>
      <ul className="space-y-2">
        {claims.length === 0 ? (
          <li className="py-4 text-center text-sm text-white/50">{WAIVER_EMPTY_PENDING_TITLE}</li>
        ) : (
          claims.map((c, idx) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-white/80">
                <div className="flex flex-wrap items-center gap-2">
                  <ListOrdered className="h-4 w-4 text-white/50" />
                  <span className="text-sm text-white">
                    #{idx + 1} Add {c.addPlayerId}
                  </span>
                  {c.dropPlayerId && <span className="text-xs text-white/60">Drop {c.dropPlayerId}</span>}
                </div>
                {(() => {
                  const label = processesAfterLabel?.(c)
                  return label ? (
                    <span className="text-[11px] text-amber-200" data-testid={`waiver-claim-hold-${c.id}`}>
                      {label}
                    </span>
                  ) : null
                })()}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-white/50">Drop</span>
                    <select
                      value={pendingEdits[c.id]?.dropPlayerId ?? (c.dropPlayerId ?? "")}
                      aria-label={`Pending claim drop player ${c.id}`}
                      data-testid={`waiver-claim-drop-edit-${c.id}`}
                      onChange={(e) =>
                        setPendingEdits((prev) => ({
                          ...prev,
                          [c.id]: {
                            faabBid: prev[c.id]?.faabBid ?? (c.faabBid != null ? c.faabBid.toString() : ""),
                            priority: prev[c.id]?.priority ?? (c.priorityOrder ?? idx + 1).toString(),
                            dropPlayerId: e.target.value,
                          },
                        }))
                      }
                      className="rounded border border-white/25 bg-black/40 px-1.5 py-0.5 text-[11px] text-white outline-none"
                    >
                      <option value="">No drop</option>
                      {rosterPlayers.map((rp) => (
                        <option key={rp.id} value={rp.id}>
                          {rp.name || rp.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-white/50">Priority</span>
                    <input
                      type="number"
                      min={0}
                      className="w-14 rounded border border-white/25 bg-black/40 px-1.5 py-0.5 text-[11px] text-white outline-none"
                      value={pendingEdits[c.id]?.priority ?? (c.priorityOrder ?? idx + 1).toString()}
                      onChange={(e) =>
                        setPendingEdits((prev) => ({
                          ...prev,
                          [c.id]: {
                            faabBid: prev[c.id]?.faabBid ?? (c.faabBid != null ? c.faabBid.toString() : ""),
                            priority: e.target.value,
                            dropPlayerId: prev[c.id]?.dropPlayerId ?? (c.dropPlayerId ?? ""),
                          },
                        }))
                      }
                    />
                  </div>
                  {isFaab && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-white/50">Bid</span>
                      <input
                        type="number"
                        min={0}
                        className="w-16 rounded border border-white/25 bg-black/40 px-1.5 py-0.5 text-[11px] text-white outline-none"
                        value={pendingEdits[c.id]?.faabBid ?? (c.faabBid != null ? c.faabBid.toString() : "")}
                        onChange={(e) =>
                          setPendingEdits((prev) => ({
                            ...prev,
                            [c.id]: {
                              faabBid: e.target.value,
                              priority: prev[c.id]?.priority ?? (c.priorityOrder ?? idx + 1).toString(),
                              dropPlayerId: prev[c.id]?.dropPlayerId ?? (c.dropPlayerId ?? ""),
                            },
                          }))
                        }
                      />
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {onReorder && claims.length > 1 && (
                  <div className="flex flex-col">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => onReorder(c.id, "up")}
                      aria-label={`Move claim ${idx + 1} up`}
                      data-testid={`waiver-claim-move-up-${c.id}`}
                      className="rounded border border-white/20 px-1 text-white/70 hover:bg-white/10 disabled:opacity-30"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === claims.length - 1}
                      onClick={() => onReorder(c.id, "down")}
                      aria-label={`Move claim ${idx + 1} down`}
                      data-testid={`waiver-claim-move-down-${c.id}`}
                      className="rounded border border-white/20 px-1 text-white/70 hover:bg-white/10 disabled:opacity-30"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => onSave(c.id, idx, c)}
                  data-testid={`waiver-claim-save-${c.id}`}
                  className="rounded border border-cyan-400/60 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => onCancel(c.id)}
                  data-testid={`waiver-claim-cancel-${c.id}`}
                  className="rounded border border-red-400/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/20"
                >
                  <Trash2 className="mr-1 inline h-3 w-3" />
                  Cancel
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}

export function buildPendingClaimPatch(
  c: PendingClaimRow,
  idx: number,
  edit: { faabBid: string; priority: string; dropPlayerId: string } | undefined,
  isFaab: boolean,
): { faabBid?: number | null; priorityOrder?: number | null; dropPlayerId?: string | null } {
  const nextPriority = edit?.priority ?? (c.priorityOrder ?? idx + 1).toString()
  const nextBidRaw = edit?.faabBid ?? (c.faabBid != null ? c.faabBid.toString() : "")
  const nextDropPlayerId = edit?.dropPlayerId ?? (c.dropPlayerId ?? "")
  const patch: { faabBid?: number | null; priorityOrder?: number | null; dropPlayerId?: string | null } = {}
  if (nextPriority !== "") patch.priorityOrder = parseOptionalNumber(nextPriority) || 0
  if (isFaab && nextBidRaw !== "") patch.faabBid = parseOptionalNumber(nextBidRaw) || 0
  patch.dropPlayerId = nextDropPlayerId || null
  return patch
}
