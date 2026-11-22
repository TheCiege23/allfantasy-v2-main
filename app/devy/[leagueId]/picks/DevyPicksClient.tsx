'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { PicksBoard, type PickRow } from '@/app/devy/components/PicksBoard'

/** GET /api/devy/picks?rosterId= — one roster's picks, by draft year. */
export type DevyPickInventory = {
  years?: { year: number; rookiePicks: PickRow[]; devyPicks: PickRow[] }[]
  seasonStart?: number
}

export function DevyPicksClient({ leagueId, userId }: { leagueId: string; userId: string }) {
  const [tab, setTab] = useState<'yours' | 'board'>('yours')
  const [year, setYear] = useState(2026)
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [rosterId, setRosterId] = useState<string | null>(null)
  type Inv = DevyPickInventory
  const [inventory, setInventory] = useState<Inv | null>(null)
  const [allPicks, setAllPicks] = useState<PickRow[]>([])
  const [leagueRosterIds, setLeagueRosterIds] = useState<string[]>([])
  /** Pick owners are roster ids; the season's rosters carry their team names. */
  const [teamNames, setTeamNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [sheet, setSheet] = useState<PickRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const cr = await fetch(`/api/devy?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      if (!cr.ok) throw new Error('Not a devy league')
      const cj = (await cr.json()) as { config: Record<string, unknown> }
      setConfig(cj.config)
      const season = Number(cj.config?.season ?? new Date().getFullYear())

      const sr = await fetch(`/api/redraft/season?leagueId=${encodeURIComponent(leagueId)}`, {
        credentials: 'include',
      })
      if (!sr.ok) throw new Error('No season')
      const sj = (await sr.json()) as {
        season?: { rosters?: { id: string; ownerId: string | null; teamName?: string | null }[] }
      }
      const rosters = sj.season?.rosters ?? []
      setLeagueRosterIds(rosters.map((r) => r.id))
      setTeamNames(Object.fromEntries(rosters.filter((r) => r.teamName).map((r) => [r.id, r.teamName as string])))
      const rid = rosters.find((r) => r.ownerId === userId)?.id ?? null
      setRosterId(rid)

      if (rid) {
        const pr = await fetch(
          `/api/devy/picks?leagueId=${encodeURIComponent(leagueId)}&rosterId=${encodeURIComponent(rid)}&season=${season}`,
          { credentials: 'include' },
        )
        if (pr.ok) {
          const pj = (await pr.json()) as { inventory?: Inv }
          setInventory(pj.inventory ?? null)
        }
      }

      const ar = await fetch(`/api/devy/picks?leagueId=${encodeURIComponent(leagueId)}&type=all`, {
        credentials: 'include',
      })
      if (ar.ok) {
        const aj = (await ar.json()) as { picks?: PickRow[] }
        setAllPicks((aj.picks ?? []) as PickRow[])
      }

      setYear(season)
    } catch {
      setConfig(null)
    } finally {
      setLoading(false)
    }
  }, [leagueId, userId])

  useEffect(() => {
    void load()
  }, [load])

  const years = useMemo(() => {
    const ys = new Set<number>()
    for (const y of inventory?.years ?? []) ys.add(y.year)
    if (ys.size === 0) ys.add(year)
    return [...ys].sort((a, b) => a - b)
  }, [inventory, year])

  const yearData = inventory?.years?.find((y) => y.year === year)
  const teamLabel = (ownerRosterId: string) =>
    ownerRosterId === rosterId ? 'You' : teamNames[ownerRosterId] ?? 'Another team'
  const combined = config?.futureDraftFormat === 'combined'

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center bg-[#040915] text-white/50">
        Loading picks…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#040915] text-white">
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#0c0c1e]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2">
          <Link href={`/league/${leagueId}`} className="text-[12px] font-semibold text-cyan-300/90">
            ← League
          </Link>
          <span className="text-[13px] font-bold">Devy picks</span>
          <span className="w-12" />
        </div>
        <div className="mx-auto mt-3 flex max-w-4xl gap-2">
          <button
            type="button"
            onClick={() => setTab('yours')}
            className={`flex-1 rounded-lg py-2 text-[12px] font-semibold min-h-[44px] ${
              tab === 'yours' ? 'bg-cyan-500/20 text-cyan-100' : 'bg-white/[0.04] text-white/45'
            }`}
          >
            Your picks
          </button>
          <button
            type="button"
            onClick={() => setTab('board')}
            className={`flex-1 rounded-lg py-2 text-[12px] font-semibold min-h-[44px] ${
              tab === 'board' ? 'bg-cyan-500/20 text-cyan-100' : 'bg-white/[0.04] text-white/45'
            }`}
          >
            League board
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-3 py-4">
        <div className="scrollbar-none flex gap-1 overflow-x-auto pb-2">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setYear(y)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-bold min-h-[44px] md:min-h-0 ${
                year === y ? 'bg-violet-500/25 text-violet-100' : 'bg-white/[0.05] text-white/45'
              }`}
            >
              {y}
            </button>
          ))}
        </div>

        {tab === 'yours' ? (
          <div className="space-y-6">
            {combined ? (
              <section>
                <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-white/70">
                  Rookie + Devy picks
                </h2>
                <PickTable
                  teamLabel={teamLabel}
                  picks={[...(yearData?.rookiePicks ?? []), ...(yearData?.devyPicks ?? [])]}
                  rosterId={rosterId}
                  onPick={(p) => setSheet(p)}
                />
              </section>
            ) : (
              <>
                <section>
                  <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-sky-200/90">
                    Rookie picks
                  </h2>
                  <PickTable teamLabel={teamLabel} picks={yearData?.rookiePicks ?? []} rosterId={rosterId} onPick={(p) => setSheet(p)} />
                </section>
                <section>
                  <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-violet-200/90">
                    Devy picks
                  </h2>
                  <PickTable teamLabel={teamLabel} picks={yearData?.devyPicks ?? []} rosterId={rosterId} onPick={(p) => setSheet(p)} />
                </section>
              </>
            )}
          </div>
        ) : (
          <section className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-3">
            <h2 className="mb-3 text-[12px] font-bold uppercase text-white/70">All teams · {year}</h2>
            <PicksBoard
              teamLabel={teamLabel}
              picks={allPicks.filter((p) => (p.season ?? year) === year)}
              rosterIdByColumn={leagueRosterIds.length ? leagueRosterIds : ['a', 'b']}
            />
          </section>
        )}
      </div>

      {sheet ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 md:items-center"
          onClick={() => setSheet(null)}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-t-2xl border border-white/[0.1] bg-[#0a1228] p-4 md:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
          >
            <p className="text-[13px] font-bold text-white">
              Round {sheet.round} · {sheet.pickType}
            </p>
            <p className="mt-2 text-[11px] text-white/55">
              Owner: {teamLabel(sheet.currentOwnerId)}
            </p>
            {sheet.isTradeable && !sheet.isUsed ? (
              <button
                type="button"
                className="mt-4 w-full rounded-xl border border-cyan-500/40 bg-cyan-500/15 py-3 text-[13px] font-semibold text-cyan-100 min-h-[44px]"
              >
                Trade this pick
              </button>
            ) : null}
            <button
              type="button"
              className="mt-2 w-full rounded-xl border border-white/[0.1] py-3 text-[12px] text-white/70 min-h-[44px]"
              onClick={() => setSheet(null)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function PickTable({
  picks,
  rosterId,
  onPick,
  teamLabel,
}: {
  picks: PickRow[]
  rosterId: string | null
  onPick: (p: PickRow) => void
  teamLabel: (ownerRosterId: string) => string
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
      <table className="w-full min-w-[320px] text-left text-[11px] text-white/75">
        <thead className="border-b border-white/[0.06] bg-black/30 text-white/45">
          <tr>
            <th className="px-2 py-2">Rd</th>
            <th className="px-2 py-2">Source</th>
            <th className="px-2 py-2">Owner</th>
            <th className="px-2 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {picks.map((p) => {
            const mine = p.currentOwnerId === rosterId
            return (
              <tr
                key={p.id}
                className={`border-b border-white/[0.04] ${mine ? 'bg-cyan-500/10' : ''}`}
                onClick={() => onPick(p)}
              >
                <td className="px-2 py-2 font-mono">{p.round}</td>
                <td className="px-2 py-2 text-white/55">{teamLabel(p.originalOwnerId)}</td>
                <td className="px-2 py-2">{teamLabel(p.currentOwnerId)}</td>
                <td className="px-2 py-2">
                  {p.isUsed ? '✓ Used' : mine ? 'Owned by you' : 'Traded'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
