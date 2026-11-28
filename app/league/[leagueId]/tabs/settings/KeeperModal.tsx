'use client'

/**
 * League settings → "Keepers & carryover": every team's roster at a glance, and the way to the Keepers tab.
 *
 * Colours come from ../keeper/keeper-surfaces.css (tokens). It was hard-coded dark, and in light mode the global
 * `.mode-readable` rule turned its text dark on the still-dark panel (keeper audit 2026-11-22). The disabled
 * checkbox beside each player did nothing and is gone; keepers are picked in the Keepers tab.
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { LeagueTeamBrief } from './types'
import '../keeper/keeper-surfaces.css'

type RosterPlayerLite = { id: string; label: string; position?: string | null }

/** One submitted keeper, as /api/keeper/commissioner/records returns it. */
type CarryRecord = { teamName?: string | null; playerName?: string | null; status: string; costRound?: number | null; costLabel?: string | null }

const KEPT_WORD: Record<string, string> = { pending: 'Kept · waiting', confirmed: 'Kept', approved: 'Kept', locked: 'Kept' }

/**
 * The keepers on one team, by player name — the records carry the team's name and the player's, not the roster
 * ids this dialog's teams use. A rejected keeper is not kept.
 */
export function keptByName(records: CarryRecord[], teamName: string): Map<string, CarryRecord> {
  const out = new Map<string, CarryRecord>()
  for (const r of records) {
    if (r.status === 'rejected' || !r.playerName || (r.teamName ?? '') !== teamName) continue
    out.set(r.playerName, r)
  }
  return out
}

function extractPlayers(roster: unknown): RosterPlayerLite[] {
  if (!roster || typeof roster !== 'object') return []
  const o = roster as Record<string, unknown>
  const candidates = o.players ?? o.roster ?? o.starters
  if (Array.isArray(candidates)) {
    return candidates
      .map((p, i) => {
        if (typeof p === 'string') return { id: p, label: p }
        if (p && typeof p === 'object') {
          const x = p as Record<string, unknown>
          const id = String(x.playerId ?? x.id ?? i)
          const label =
            typeof x.name === 'string'
              ? x.name
              : typeof x.playerName === 'string'
                ? x.playerName
                : id
          return { id, label, position: typeof x.position === 'string' ? x.position : null }
        }
        return null
      })
      .filter((x): x is RosterPlayerLite => x != null)
  }
  return []
}

export function KeeperModal({
  open,
  leagueId,
  teams,
  onClose,
}: {
  open: boolean
  leagueId: string
  teams: LeagueTeamBrief[]
  onClose: () => void
}) {
  const [byTeam, setByTeam] = useState<Record<string, RosterPlayerLite[]>>({})
  const [records, setRecords] = useState<CarryRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const next: Record<string, RosterPlayerLite[]> = {}
    try {
      const claimed = teams.filter((t) => Boolean(t.claimedByUserId))
      await Promise.all(
        claimed.map(async (t) => {
          const uid = t.claimedByUserId
          if (!uid) return
          const res = await fetch(
            `/api/league/roster?leagueId=${encodeURIComponent(leagueId)}&userId=${encodeURIComponent(uid)}`,
          )
          if (!res.ok) {
            next[t.id] = []
            return
          }
          const data = (await res.json()) as { roster?: unknown }
          const raw = data.roster
          next[t.id] = extractPlayers(raw)
        }),
      )
      setByTeam(next)
      // Who is being kept: the open window's records. Only a commissioner may read them; anyone else sees rosters.
      try {
        const ctxRes = await fetch(`/api/keeper/context?leagueId=${encodeURIComponent(leagueId)}`)
        const ctx = ctxRes.ok ? ((await ctxRes.json()) as { session?: { seasonId?: string } | null }) : null
        const seasonId = ctx?.session?.seasonId
        if (seasonId) {
          const recRes = await fetch(`/api/keeper/commissioner/records?leagueId=${encodeURIComponent(leagueId)}&seasonId=${encodeURIComponent(seasonId)}`)
          const recJson = recRes.ok ? ((await recRes.json()) as { records?: CarryRecord[] }) : null
          setRecords(Array.isArray(recJson?.records) ? recJson!.records! : [])
        }
      } catch {
        setRecords([])
      }
    } catch {
      setError('Couldn’t load the rosters. Try again in a moment.')
    } finally {
      setLoading(false)
    }
  }, [leagueId, teams])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const titleId = `keeper-carryover-title-${leagueId}`
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: 'color-mix(in srgb, var(--bg) 55%, transparent)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="keeper-carryover-dialog"
        className="kp-panel max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl p-5 shadow-xl sm:p-6">
        <h3 id={titleId} className="kp-text text-[16px] font-bold">Keepers &amp; carryover</h3>
        <p className="kp-muted mt-1 text-[13px] leading-snug">
          Every team’s roster, with its keepers first. Managers pick their keepers in the Keepers tab.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
          <Link href={`/league/${leagueId}?tab=keeper`} className="kp-btn-primary rounded-lg px-3 py-2 font-semibold">
            Open Keepers tab
          </Link>
          <Link href={`/league/${leagueId}?tab=draft`} className="kp-btn rounded-lg px-3 py-2 font-semibold">
            Open draft
          </Link>
        </div>
        {loading ? <p className="kp-muted mt-4 text-[13px]" role="status">Loading rosters…</p> : null}
        {error ? <p className="kp-bad mt-2 text-[13px]" role="alert">{error}</p> : null}
        <div className="mt-4 space-y-3">
          {teams.map((team) => {
            const kept = keptByName(records, team.teamName)
            // Keepers first, so the dialog answers what it is named for before the rest of the roster.
            const players = [...(byTeam[team.id] ?? [])].sort((a, b) => Number(kept.has(b.label)) - Number(kept.has(a.label)))
            return (
              <div key={team.id} className="kp-card rounded-xl p-3" data-testid={`keeper-carryover-team-${team.id}`}>
                <p className="kp-text text-[14px] font-semibold">{team.teamName}</p>
                {/* An open team's name already says so: "Open team / Open team / No manager yet" said it three times. */}
                {team.claimedByUserId && team.ownerName ? <p className="kp-muted text-[12px]">{team.ownerName}</p> : null}
                {!team.claimedByUserId ? (
                  <p className="kp-faint mt-2 text-[12px]">No manager yet.</p>
                ) : loading ? null : players.length === 0 ? (
                  <p className="kp-faint mt-2 text-[12px]">No players on this roster yet.</p>
                ) : (
                  <ul className="kp-text2 mt-2 grid max-h-40 grid-cols-1 gap-x-4 gap-y-1 overflow-y-auto text-[13px] sm:grid-cols-2">
                    {players.map((p) => {
                      const k = kept.get(p.label)
                      const cost = k ? (k.costLabel ?? (k.costRound != null ? `Round ${k.costRound}` : null)) : null
                      return (
                        <li key={p.id} data-kept={k ? '' : undefined}>
                          <span className={k ? 'kp-text font-semibold' : undefined}>{p.label}</span>
                          {p.position ? <span className="kp-muted"> · {p.position}</span> : null}
                          {k ? (
                            <span className={k.status === 'pending' ? 'kp-warn' : 'kp-good'}>
                              {' · '}
                              {KEPT_WORD[k.status] ?? 'Kept'}
                              {cost ? ` (${cost.replace(/^Round (\d+)$/, 'round $1')})` : ''}
                            </span>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onClose} className="kp-btn rounded-xl px-4 py-2 text-[13px] font-bold">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
