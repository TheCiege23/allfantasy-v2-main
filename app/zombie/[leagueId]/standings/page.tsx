'use client'

import { useParams } from 'next/navigation'
import { useEffect, useState, useMemo } from 'react'
import clsx from 'clsx'
import { ZombieStatusBadge } from '@/app/zombie/components/ZombieStatusBadge'
import { ZombieHordeBar } from '@/app/zombie/components/ZombieHordeBar'

type Row = {
  rosterId: string
  status: string
  wins: number
  losses: number
  pointsFor: number
  fantasyTeamName: string | null
  displayName: string | null
  weekBecameZombie?: number | null
  killedByUserId?: string | null
  serumsHeld?: number
  weaponsHeld?: number
}

type Filter = 'all' | 'survivors' | 'zombies' | 'whisperer'

function getStatusKey(s: string): string {
  const lower = s.toLowerCase()
  if (lower.includes('whisperer')) return 'whisperer'
  if (lower.includes('zombie')) return 'zombie'
  if (lower.includes('revived')) return 'revived'
  if (lower.includes('eliminat')) return 'eliminated'
  return 'survivor'
}

export default function ZombieStandingsPage() {
  const { leagueId  } = useParams<{ leagueId: string }>() ?? ({} as { leagueId: string })
  const [rows, setRows] = useState<Row[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [week, setWeek] = useState(1)

  useEffect(() => {
    if (!leagueId) return
    fetch(`/api/zombie/league?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { league?: { teams: Row[]; currentWeek?: number } } | null) => {
        setRows(d?.league?.teams ?? [])
        if (d?.league?.currentWeek) setWeek(d.league.currentWeek)
      })
      .catch(() => setRows([]))
  }, [leagueId])

  const survivorCount = rows.filter((r) => {
    const k = getStatusKey(r.status)
    return k === 'survivor' || k === 'revived'
  }).length
  const zombieCount = rows.filter((r) => getStatusKey(r.status) === 'zombie').length

  const filtered = useMemo(() => {
    let list = [...rows]
    if (filter === 'survivors') list = list.filter((r) => {
      const k = getStatusKey(r.status)
      return k === 'survivor' || k === 'revived'
    })
    if (filter === 'zombies') list = list.filter((r) => getStatusKey(r.status) === 'zombie')
    if (filter === 'whisperer') list = list.filter((r) => getStatusKey(r.status) === 'whisperer')

    list.sort((a, b) => {
      const rank = (s: string) => {
        const x = getStatusKey(s)
        if (x === 'survivor' || x === 'revived') return 0
        if (x === 'whisperer') return 1
        if (x === 'zombie') return 2
        return 3
      }
      const dr = rank(a.status) - rank(b.status)
      if (dr !== 0) return dr
      if (b.wins !== a.wins) return b.wins - a.wins
      return b.pointsFor - a.pointsFor
    })
    return list
  }, [rows, filter])

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: rows.length },
    { id: 'survivors', label: 'Survivors', count: survivorCount },
    { id: 'zombies', label: 'Zombies', count: zombieCount },
    { id: 'whisperer', label: 'Whisperer', count: rows.filter((r) => getStatusKey(r.status) === 'whisperer').length },
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Header with counts */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-black text-[var(--zombie-text-full)]">Standings</h1>
          <p className="text-[12px] text-[var(--zombie-text-mid)]">Week {week} · {rows.length} teams</p>
        </div>
        <div className="flex gap-3 text-[12px]">
          <span className="text-[var(--zombie-green)]">🧍 {survivorCount}</span>
          <span className="text-[var(--zombie-purple)]">🧟 {zombieCount}</span>
        </div>
      </div>

      {/* Horde bar */}
      <ZombieHordeBar hordeCount={zombieCount} survivorCount={survivorCount} />

      {/* Filter chips */}
      <div className="flex gap-1.5">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={clsx(
              'rounded-lg px-3 py-1.5 text-[11px] font-semibold transition',
              filter === f.id
                ? 'bg-[var(--zombie-crimson)]/20 text-[var(--zombie-crimson)]'
                : 'text-[var(--zombie-text-dim)] hover:bg-white/[0.04]',
            )}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      {/* Standings table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--zombie-border)]">
        <table className="w-full min-w-[420px] border-collapse">
          <thead>
            <tr className="border-b border-[var(--zombie-border)] text-left text-[11px] uppercase tracking-wide text-[var(--zombie-text-dim)]">
              <th className="p-2.5 w-8">#</th>
              <th className="p-2.5">Team</th>
              <th className="p-2.5 w-10">Status</th>
              <th className="p-2.5 w-14 text-right">W-L</th>
              <th className="hidden p-2.5 text-right sm:table-cell">PF</th>
              <th className="hidden p-2.5 text-right sm:table-cell">PPW</th>
              <th className="p-2.5 text-right w-16">Items</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t, i) => {
              const sk = getStatusKey(t.status)
              const played = t.wins + t.losses
              const ppw = played > 0 ? (t.pointsFor / played).toFixed(2) : '0.00'
              return (
                <tr
                  key={t.rosterId}
                  className={clsx(
                    'border-b border-white/[0.04] text-[12px] transition-colors',
                    sk === 'whisperer' && 'bg-[var(--zombie-crimson)]/[0.04]',
                    sk === 'revived' && 'bg-[var(--zombie-gold)]/[0.04]',
                    sk === 'zombie' && 'opacity-80 saturate-[0.65]',
                    sk === 'eliminated' && 'opacity-40',
                  )}
                >
                  <td className="p-2.5 font-mono text-[var(--zombie-text-dim)]">{i + 1}</td>
                  <td className="p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[var(--zombie-text-full)]">
                        {t.fantasyTeamName || t.displayName || t.rosterId}
                      </span>
                      {sk === 'zombie' && t.weekBecameZombie && (
                        <span className="text-[11px] text-[var(--zombie-purple)]">
                          Wk {t.weekBecameZombie}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-2.5">
                    <ZombieStatusBadge status={t.status} compact />
                  </td>
                  <td className="p-2.5 text-right font-mono text-[var(--zombie-text-mid)]">
                    {t.wins}-{t.losses}
                  </td>
                  <td className="hidden p-2.5 text-right font-mono text-[var(--zombie-text-mid)] sm:table-cell">
                    {t.pointsFor.toFixed(1)}
                  </td>
                  <td className="hidden p-2.5 text-right font-mono text-[var(--zombie-text-mid)] sm:table-cell">
                    {ppw}
                  </td>
                  <td className="p-2.5 text-right">
                    <div className="flex items-center justify-end gap-1 text-[11px]">
                      {t.serumsHeld ? (
                        <span title={`${t.serumsHeld} serums`} className="text-teal-400">
                          🧪{t.serumsHeld}
                        </span>
                      ) : null}
                      {t.weaponsHeld ? (
                        <span title={`${t.weaponsHeld} weapons`} className="text-white/60">
                          ⚔️{t.weaponsHeld}
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p className="py-8 text-center text-[12px] text-[var(--zombie-text-dim)]">
          No teams match this filter.
        </p>
      )}
    </div>
  )
}
