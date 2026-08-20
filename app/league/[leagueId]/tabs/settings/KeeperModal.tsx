'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { LeagueTeamBrief } from './types'

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
      setError('Could not load rosters.')
    } finally {
      setLoading(false)
    }
  }, [leagueId, teams])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#0c1220] p-6 shadow-xl">
        <h3 className="text-[16px] font-bold text-white">Keepers & carryover</h3>
        <p className="mt-1 text-[12px] text-white/45">
          Quick roster snapshot by team. Use the <strong className="text-white/70">Keepers</strong> tab for declaration
          deadlines and eligibility, and the <strong className="text-white/70">Draft</strong> tab for pre-draft keeper
          locks when your draft session is live.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
          <Link
            href={`/league/${leagueId}?tab=keeper`}
            className="rounded-lg border border-[#ff3d81]/35 bg-[#ff3d81]/10 px-3 py-1.5 font-semibold text-[#ffb8d1] hover:bg-[#ff3d81]/20"
          >
            Open Keepers tab
          </Link>
          <Link
            href={`/league/${leagueId}?tab=draft`}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 font-semibold text-white/80 hover:bg-white/[0.08]"
          >
            Open Draft tab
          </Link>
        </div>
        {loading ? <p className="mt-4 text-[12px] text-[#ff3d81]/80">Loading rosters…</p> : null}
        {error ? <p className="mt-2 text-[12px] text-red-400">{error}</p> : null}
        <div className="mt-4 space-y-4">
          {teams.map((team) => (
            <div key={team.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="text-[13px] font-semibold text-white">{team.teamName}</p>
              <p className="text-[11px] text-white/35">{team.ownerName}</p>
              <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-[11px] text-white/55">
                {(byTeam[team.id] ?? []).length === 0 ? (
                  <li className="text-white/30">No structured players in roster payload (import/sync may be required).</li>
                ) : (
                  byTeam[team.id]!.map((p) => (
                    <li key={p.id} className="flex items-center gap-2">
                      <input type="checkbox" disabled className="rounded border-white/20" />
                      <span>{p.label}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-[#ff3d81] px-4 py-2 text-[13px] font-bold text-black hover:bg-[#ff3d81]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
