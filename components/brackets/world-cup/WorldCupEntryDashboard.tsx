"use client"
import { useState } from "react"
import { Check, ChevronRight, Loader2, Lock, Pencil, Plus, Radio, Trash2, Trophy, X } from "lucide-react"
import type { WorldCupBracketEntryClient } from "@/lib/world-cup/worldCupClientApi"
import { getEntryStatus } from "@/lib/world-cup/worldCupClientApi"

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLES = {
  not_started: "border-white/10 bg-white/[0.04] text-white/40",
  in_progress: "border-cyan-300/30 bg-cyan-300/10 text-white/85",
  complete: "border-emerald-300/30 bg-emerald-300/10 text-white/85",
  locked: "border-white/10 bg-white/[0.06] text-white/35",
  live: "border-rose-400/30 bg-rose-400/10 text-white/85",
}
const STATUS_LABEL = {
  not_started: "Not Started",
  in_progress: "In Progress",
  complete: "Complete",
  locked: "Locked",
  live: "Live",
}

function StatusBadge({ entry }: { entry: WorldCupBracketEntryClient }) {
  const status = getEntryStatus(entry)
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${STATUS_STYLES[status]}`}
    >
      {status === "live" && <Radio className="h-2.5 w-2.5" />}
      {status === "complete" && <Check className="h-2.5 w-2.5" />}
      {status === "locked" && <Lock className="h-2.5 w-2.5" />}
      {STATUS_LABEL[status]}
    </span>
  )
}

// ── Rename inline ─────────────────────────────────────────────────────────────

function RenameForm({
  currentName,
  onSave,
  onCancel,
}: {
  currentName: string
  onSave: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(currentName)
  const trimmed = value.trim()
  const tooLong = trimmed.length > 40
  const empty = trimmed.length === 0

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (empty || tooLong) return
    onSave(trimmed)
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 flex items-center gap-2">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={45}
        className="min-w-0 flex-1 rounded-lg border border-white/20 bg-white/[0.07] px-2 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-cyan-300/50 focus:outline-none"
        placeholder="Bracket name"
      />
      <button
        type="submit"
        disabled={empty || tooLong}
        className="rounded-lg bg-cyan-300 px-3 py-1.5 text-xs font-black text-black disabled:opacity-40"
      >
        Save
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg border border-white/10 bg-white/[0.04] p-1.5 text-white/50"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      {tooLong && (
        <span className="text-[11px] text-white/70">Max 40 chars</span>
      )}
    </form>
  )
}

// ── Entry card ────────────────────────────────────────────────────────────────

function EntryCard({
  entry,
  isSelected,
  isLocked,
  isMutating,
  onSelect,
  onRename,
  onDelete,
}: {
  entry: WorldCupBracketEntryClient
  isSelected: boolean
  isLocked: boolean
  isMutating: boolean
  onSelect: () => void
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div
      className={`flex flex-col rounded-xl border p-4 transition-colors ${
        isSelected
          ? "border-cyan-300/40 bg-cyan-300/[0.06]"
          : "border-white/10 bg-white/[0.03]"
      }`}
    >
      {/* Top row */}
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <RenameForm
              currentName={entry.name}
              onSave={(name) => {
                onRename(name)
                setRenaming(false)
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <div className="flex items-center gap-2">
              <span className="truncate text-base font-black text-white">
                {entry.name}
              </span>
              <StatusBadge entry={entry} />
            </div>
          )}
        </div>
        {!renaming && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              title="Rename"
              onClick={() => setRenaming(true)}
              disabled={isMutating}
              className="rounded-lg border border-white/10 bg-white/[0.04] p-1.5 text-white/50 hover:text-white disabled:opacity-40"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {!isLocked && (
              <button
                type="button"
                title="Delete"
                onClick={() => setConfirmDelete(true)}
                disabled={isMutating}
                className="rounded-lg border border-rose-400/20 bg-rose-400/[0.06] p-1.5 text-white/60 hover:text-white/85 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Stats row */}
      {!renaming && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Score" value={entry.totalScore} />
          <Stat label="Rank" value={entry.rank != null ? `#${entry.rank}` : "—"} />
          <Stat label="Correct" value={entry.correctPicks} />
          <Stat label="Max Pts" value={entry.maxPossibleScore} />
        </div>
      )}

      {/* Champion */}
      {!renaming && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-white/40">
          <Trophy className="h-3 w-3 shrink-0 text-white/50" />
          {entry.championTeamName ?? "No champion picked yet"}
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div
          data-testid="world-cup-entry-delete-confirm"
          className="mt-3 rounded-lg border border-rose-400/25 bg-rose-400/[0.07] px-3 py-2 text-xs text-white/85"
        >
          <p className="font-bold">Delete &ldquo;{entry.name}&rdquo;?</p>
          {entry.submittedAt ? (
            <p className="mt-0.5 text-white/65">
              This bracket is finalized. Deleting it will remove the finalized entry from rankings and the pool leaderboard. This cannot be undone.
            </p>
          ) : (
            <p className="mt-0.5 text-white/65">
              Deleting this bracket will remove it from this pool and the leaderboard. This cannot be undone.
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmDelete(false)
                onDelete()
              }}
              disabled={isMutating}
              className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-black text-white disabled:opacity-50"
            >
              {isMutating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-white/60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Open button */}
      {!renaming && !confirmDelete && (
        <button
          type="button"
          onClick={onSelect}
          className={`mt-3 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-black transition-colors ${
            isSelected
              ? "bg-cyan-300 text-black"
              : "border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08]"
          }`}
        >
          {isSelected ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Selected
            </>
          ) : (
            <>
              Open Bracket
              <ChevronRight className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/45">{label}</div>
      <div className="text-sm font-black tabular-nums text-white">{value}</div>
    </div>
  )
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function WorldCupEntryDashboard({
  challengeId,
  entries,
  maxEntriesPerParticipant,
  isLocked,
  selectedEntryId,
  onCreateEntry,
  onSelectEntry,
  onRenameEntry,
  onDeleteEntry,
  isLoading = false,
  isCreating = false,
  isMutating = false,
}: {
  challengeId: string
  entries: WorldCupBracketEntryClient[]
  maxEntriesPerParticipant: number
  isLocked: boolean
  selectedEntryId?: string | null
  onCreateEntry: () => void
  onSelectEntry: (entryId: string) => void
  onRenameEntry: (entryId: string, name: string) => void
  onDeleteEntry: (entryId: string) => void
  isLoading?: boolean
  isCreating?: boolean
  isMutating?: boolean
}) {
  const atMax = entries.length >= maxEntriesPerParticipant
  const canCreate = !atMax && !isLocked

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 pb-28 sm:pb-8">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-white">My World Cup Brackets</h2>
          <p className="text-xs text-white/40">
            {entries.length} of {maxEntriesPerParticipant} entries used
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateEntry}
          disabled={!canCreate || isCreating}
          title={
            isLocked ? "Bracket is locked"
            : atMax ? "Entry limit reached"
            : "Create new bracket"
          }
          className="inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-4 py-2 text-xs font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isCreating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          {isLocked ? "Locked"
          : atMax ? "Limit Reached"
          : isCreating ? "Creating…"
          : "Create Bracket"}
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading brackets…
        </div>
      )}

      {/* Locked notice banner */}
      {!isLoading && isLocked && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-white/[0.08] bg-amber-300/[0.07] px-4 py-3 text-sm">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-white/70" />
          <div>
            <p className="font-bold text-white/75">This pool is locked.</p>
            <p className="mt-0.5 text-xs text-white/50">
              The World Cup has started. You can review your brackets and follow the leaderboard, but picks can no longer be changed.
            </p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && entries.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] px-6 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-300/10">
            <Trophy className="h-6 w-6 text-white/85" />
          </div>
          {isLocked ? (
            <div>
              <p className="font-black text-white">No brackets created</p>
              <p className="mt-1 text-sm text-white/45">
                This pool is locked. You didn't create a bracket before the tournament started.
              </p>
            </div>
          ) : (
            <div>
              <p className="font-black text-white">You haven't created a bracket yet.</p>
              <p className="mt-1 text-sm text-white/45">
                Create your first bracket, make your picks, and edit them until the tournament starts.
              </p>
              <p className="mt-1 text-xs text-white/30">
                You can create up to {maxEntriesPerParticipant} bracket{maxEntriesPerParticipant !== 1 ? "s" : ""} in this pool.
              </p>
              {/* Scoring explainer chips */}
              <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                {[
                  { label: "R32", pts: "+10" },
                  { label: "R16", pts: "+20" },
                  { label: "QF", pts: "+40" },
                  { label: "SF", pts: "+80" },
                  { label: "Final", pts: "+160" },
                  { label: "Champion", pts: "+320" },
                ].map(({ label, pts }) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-bold"
                  >
                    <span className="text-white/45">{label}</span>
                    <span className="text-cyan-300">{pts}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {!isLocked && (
            <button
              type="button"
              onClick={onCreateEntry}
              disabled={!canCreate || isCreating}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-2.5 text-sm font-black text-black disabled:opacity-40"
            >
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {isCreating ? "Creating…" : "Create Your First Bracket"}
            </button>
          )}
        </div>
      )}

      {/* Entry grid */}
      {!isLoading && entries.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              isSelected={entry.id === selectedEntryId}
              isLocked={isLocked}
              isMutating={isMutating}
              onSelect={() => onSelectEntry(entry.id)}
              onRename={(name) => onRenameEntry(entry.id, name)}
              onDelete={() => onDeleteEntry(entry.id)}
            />
          ))}
        </div>
      )}

      {/* Limit notice */}
      {!isLoading && entries.length > 0 && atMax && !isLocked && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-xs text-white/50">
          <Trophy className="h-3.5 w-3.5 shrink-0 text-white/50" />
          You've used all {maxEntriesPerParticipant} bracket entries for this pool. Best of luck!
        </div>
      )}
    </div>
  )
}
