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

type RosterPlayerLite = { id: string; label: string }

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
          return { id, label }
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
          Every team’s roster at a glance. Managers pick their keepers in the Keepers tab.
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
            const players = byTeam[team.id] ?? []
            return (
              <div key={team.id} className="kp-card rounded-xl p-3" data-testid={`keeper-carryover-team-${team.id}`}>
                <p className="kp-text text-[14px] font-semibold">{team.teamName}</p>
                <p className="kp-muted text-[12px]">{team.ownerName || 'Open team'}</p>
                {!team.claimedByUserId ? (
                  <p className="kp-faint mt-2 text-[12px]">No manager yet.</p>
                ) : loading ? null : players.length === 0 ? (
                  <p className="kp-faint mt-2 text-[12px]">No players on this roster yet.</p>
                ) : (
                  <ul className="kp-text2 mt-2 grid max-h-40 grid-cols-1 gap-x-4 gap-y-1 overflow-y-auto text-[13px] sm:grid-cols-2">
                    {players.map((p) => (
                      <li key={p.id}>{p.label}</li>
                    ))}
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
