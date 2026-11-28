'use client'

/**
 * Position eligibility, as a league sees it (NBA). Presentational: data in, one callback out.
 * The container (PositionEligibilityPanel) fetches and posts; the /e2e harness renders this with sample data.
 *
 * One headline, one list, one log — and every number said once. The commissioner picks a player, taps a
 * position to add or remove it, and gives a reason the whole league reads in the log below.
 */
import { useMemo, useState } from 'react'
import { History, Search } from 'lucide-react'
import {
  NBA_ELIGIBILITY_POSITIONS,
  type NbaEligibilityPosition,
  type PlayerEligibility,
  type PositionEvidence,
} from '@/lib/league-eligibility/nbaPositionEligibility'

export type PositionEligibilityPlayer = {
  id: string
  name: string
  team: string | null
  rosterName: string | null
  state: PlayerEligibility
  evidence: PositionEvidence[]
}

export type PositionEligibilityLogEntry = {
  playerId: string
  playerName: string
  position: NbaEligibilityPosition
  action: 'add' | 'remove' | 'reset'
  reason: string | null
  actorName: string | null
  createdAt: string
}

export type PositionEligibilitySubmit = {
  playerId: string
  position: NbaEligibilityPosition
  action: 'add' | 'remove' | 'reset'
  reason: string
}

type Props = {
  players: PositionEligibilityPlayer[]
  log: PositionEligibilityLogEntry[]
  canEdit: boolean
  busy?: boolean
  error?: string | null
  /** Initially selected player (the harness opens on one). */
  initialPlayerId?: string | null
  /** Resolve `false` when the change was refused, so the form stays open with what was typed. */
  onSubmit?: (change: PositionEligibilitySubmit) => boolean | void | Promise<boolean | void>
}

function chipClass(kind: 'listed' | 'added' | 'removed'): string {
  if (kind === 'added') return 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
  if (kind === 'removed') return 'border-rose-500/50 bg-rose-500/10 text-rose-500 line-through decoration-2'
  return 'border-white/15 bg-white/[0.06] text-white/85'
}

export function PositionChips({ state }: { state: PlayerEligibility }) {
  const chips: Array<{ p: NbaEligibilityPosition; kind: 'listed' | 'added' | 'removed' }> = []
  for (const p of NBA_ELIGIBILITY_POSITIONS) {
    if (state.added.includes(p)) chips.push({ p, kind: 'added' })
    else if (state.removed.includes(p)) chips.push({ p, kind: 'removed' })
    else if (state.listed.includes(p)) chips.push({ p, kind: 'listed' })
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {chips.map(({ p, kind }) => (
        <span
          key={p}
          className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${chipClass(kind)}`}
          title={kind === 'added' ? 'Added by the commissioner' : kind === 'removed' ? 'Removed by the commissioner' : 'Listed position'}
        >
          {kind === 'added' ? `+${p}` : p}
        </span>
      ))}
    </span>
  )
}

function evidenceLine(evidence: PositionEvidence[]): string | null {
  if (!evidence.length) return null
  return evidence.map((e) => `${e.position} ${e.games}`).join(' · ')
}

function actionWords(e: PositionEligibilityLogEntry): string {
  if (e.action === 'add') return `added ${e.position} for`
  if (e.action === 'remove') return `removed ${e.position} from`
  return `undid the ${e.position} change for`
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function PositionEligibilityView({ players, log, canEdit, busy, error, initialPlayerId, onSubmit }: Props) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(initialPlayerId ?? null)
  const [pending, setPending] = useState<{ position: NbaEligibilityPosition; action: 'add' | 'remove' } | null>(null)
  const [reason, setReason] = useState('')

  const changed = useMemo(() => players.filter((p) => p.state.added.length || p.state.removed.length), [players])
  const selected = players.find((p) => p.id === selectedId) ?? null
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return players.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8)
  }, [players, query])

  const pick = (id: string) => {
    setSelectedId(id)
    setQuery('')
    setPending(null)
    setReason('')
  }

  const submit = async (change: PositionEligibilitySubmit) => {
    if ((await onSubmit?.(change)) === false) return
    setPending(null)
    setReason('')
  }

  return (
    <section className="space-y-5" data-testid="position-eligibility">
      <header>
        <h3 className="text-base font-semibold text-white">Position eligibility</h3>
        <p className="mt-0.5 text-xs text-white/55">
          {changed.length === 0
            ? 'Every player plays his listed positions.'
            : `${changed.length} ${changed.length === 1 ? 'player has' : 'players have'} a commissioner change.`}{' '}
          {canEdit
            ? 'Add or remove a position any time. It applies to lineups right away, and the whole league sees the reason.'
            : 'Only the commissioner can change these. Every change is listed below.'}
        </p>
      </header>

      {canEdit && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
          <label className="relative block">
            <span className="sr-only">Find a player</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a rostered player"
              className="w-full rounded-lg border border-white/10 bg-black/20 py-2 pl-8 pr-3 text-sm text-white placeholder:text-white/35 focus:border-cyan-400/50 focus:outline-none"
              data-testid="position-eligibility-search"
            />
          </label>
          {matches.length > 0 && (
            <ul className="mt-1 overflow-hidden rounded-lg border border-white/10 bg-black/40" role="listbox">
              {matches.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => pick(p.id)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-white/85 hover:bg-white/[0.06]"
                  >
                    <span className="min-w-0 truncate">
                      {p.name}
                      {p.team ? <span className="text-white/40"> · {p.team}</span> : null}
                    </span>
                    <PositionChips state={p.state} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selected && (
            <div className="mt-3 space-y-3" data-testid="position-eligibility-editor">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-white">
                  {selected.name}
                  {selected.team ? <span className="font-normal text-white/45"> · {selected.team}</span> : null}
                  {selected.rosterName ? <span className="font-normal text-white/45"> · {selected.rosterName}</span> : null}
                </p>
                <PositionChips state={selected.state} />
              </div>
              {evidenceLine(selected.evidence) ? (
                <p className="text-[11px] text-white/50">
                  Games this season by box-score position: <span className="text-white/75">{evidenceLine(selected.evidence)}</span>
                </p>
              ) : (
                <p className="text-[11px] text-white/40">No box scores for him this season yet.</p>
              )}

              <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Positions">
                {NBA_ELIGIBILITY_POSITIONS.map((p) => {
                  const plays = selected.state.effective.includes(p)
                  const changedHere = selected.state.added.includes(p) || selected.state.removed.includes(p)
                  const action = plays ? 'remove' : 'add'
                  const active = pending?.position === p
                  return (
                    <button
                      key={p}
                      type="button"
                      disabled={busy}
                      onClick={() => setPending(active ? null : { position: p, action })}
                      aria-pressed={plays}
                      className={`rounded-lg border px-1 py-2 text-xs font-bold transition ${
                        active
                          ? 'border-cyan-300 bg-cyan-500/25 text-white'
                          : plays
                            ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
                            : 'border-white/10 bg-white/[0.03] text-white/45 hover:text-white/80'
                      }`}
                    >
                      {p}
                      <span className="mt-0.5 block text-[11px] font-medium opacity-80">
                        {changedHere ? 'changed' : plays ? 'plays' : 'add'}
                      </span>
                    </button>
                  )
                })}
              </div>

              {pending && (
                <div className="space-y-2">
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={280}
                    placeholder={pending.action === 'add' ? 'Why? e.g. "Started 10 straight at SF"' : 'Why? e.g. "Has not played PG since October"'}
                    className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:border-cyan-400/50 focus:outline-none"
                    data-testid="position-eligibility-reason"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy || !reason.trim()}
                      onClick={() => submit({ playerId: selected.id, position: pending.position, action: pending.action, reason })}
                      className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-40"
                    >
                      {pending.action === 'add' ? `Add ${pending.position}` : `Remove ${pending.position}`}
                    </button>
                    {(selected.state.added.includes(pending.position) || selected.state.removed.includes(pending.position)) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => submit({ playerId: selected.id, position: pending.position, action: 'reset', reason: reason || 'Back to listed positions' })}
                        className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white/75 hover:bg-white/[0.05]"
                      >
                        Undo my {pending.position} change
                      </button>
                    )}
                  </div>
                </div>
              )}
              {error ? <p className="text-xs text-rose-300" role="alert">{error}</p> : null}
            </div>
          )}
        </div>
      )}

      {changed.length > 0 && (
        <div>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">Changed players</h4>
          <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-white/[0.02]">
            {changed.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => pick(p.id)}
                  className="min-w-0 text-left text-sm text-white/90 enabled:hover:text-white"
                >
                  {p.name}
                  {p.team ? <span className="text-white/40"> · {p.team}</span> : null}
                </button>
                <PositionChips state={p.state} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">
          <History className="h-3.5 w-3.5" /> Change log
        </h4>
        {log.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-xs text-white/40">
            No changes yet.
          </p>
        ) : (
          <ol className="space-y-1.5" data-testid="position-eligibility-log">
            {log.map((e, i) => (
              <li key={`${e.playerId}-${e.createdAt}-${i}`} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <p className="text-xs text-white/80">
                  <span className="text-white/45">{shortDate(e.createdAt)} · </span>
                  <span className="font-semibold text-white">{e.actorName ?? 'Commissioner'}</span> {actionWords(e)}{' '}
                  <span className="font-semibold text-white">{e.playerName}</span>
                </p>
                {e.reason ? <p className="mt-0.5 text-[11px] text-white/55">“{e.reason}”</p> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
