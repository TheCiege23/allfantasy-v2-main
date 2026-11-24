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
      <div className="flex min-h-[50vh] items-center justify-center bg-[var(--surface)] text-[var(--muted)]">
        Loading picks…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--surface)] text-[var(--text)]">
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[var(--surface)] px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2">
          <Link href={`/league/${leagueId}`} className="text-[12px] font-semibold text-[var(--accent)]">
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
              tab === 'yours' ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'bg-white/[0.04] text-[var(--muted)]'
            }`}
          >
            Your picks
          </button>
          <button
            type="button"
            onClick={() => setTab('board')}
            className={`flex-1 rounded-lg py-2 text-[12px] font-semibold min-h-[44px] ${
              tab === 'board' ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'bg-white/[0.04] text-[var(--muted)]'
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
                year === y ? 'bg-[var(--devy-violet-soft)] text-[var(--devy-violet)]' : 'bg-white/[0.05] text-[var(--muted)]'
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
                <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-[var(--text2)]">
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
                  <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-[var(--accent)]">
                    Rookie picks
                  </h2>
                  <PickTable teamLabel={teamLabel} picks={yearData?.rookiePicks ?? []} rosterId={rosterId} onPick={(p) => setSheet(p)} />
                </section>
                <section>
                  <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-[var(--devy-violet)]">
                    Devy picks
                  </h2>
                  <PickTable teamLabel={teamLabel} picks={yearData?.devyPicks ?? []} rosterId={rosterId} onPick={(p) => setSheet(p)} />
                </section>
              </>
            )}
          </div>
        ) : (
          <section className="rounded-xl border border-white/[0.08] bg-[var(--surface)] p-3">
            <h2 className="mb-3 text-[12px] font-bold uppercase text-[var(--text2)]">All teams · {year}</h2>
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
          className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--surface2)] md:items-center"
          onClick={() => setSheet(null)}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-t-2xl border border-white/[0.1] bg-[var(--surface)] p-4 md:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
          >
            <p className="text-[13px] font-bold text-[var(--text)]">
              Round {sheet.round} · {sheet.pickType}
            </p>
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              Owner: {teamLabel(sheet.currentOwnerId)}
            </p>
            {sheet.isTradeable && !sheet.isUsed ? (
              <button
                type="button"
                className="mt-4 w-full rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)] py-3 text-[13px] font-semibold text-[var(--accent)] min-h-[44px]"
              >
                Trade this pick
              </button>
            ) : null}
            <button
              type="button"
              className="mt-2 w-full rounded-xl border border-white/[0.1] py-3 text-[12px] text-[var(--text2)] min-h-[44px]"
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

/**
 * Your picks, one row each (2026-11-23). It was a table whose Source, Owner and Status columns all read "You / You /
 * Owned by you"; a row now names a team only when the pick came from someone else, and says "Used" once it is.
 */
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
    <ul className="rounded-xl border border-white/[0.08] bg-[var(--surface2)]">
      {picks.map((p) => {
        const via = p.originalOwnerId !== p.currentOwnerId && p.originalOwnerId !== rosterId ? teamLabel(p.originalOwnerId) : null
        return (
          <li key={p.id} className="border-t border-white/[0.06] first:border-t-0">
            <button
              type="button"
              className="flex min-h-[48px] w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px]"
              onClick={() => onPick(p)}
            >
              <span className="font-semibold text-[var(--text)]">Round {p.round}</span>
              <span className="flex min-w-0 items-center gap-2 text-[12px]">
                {via ? <span className="truncate text-[var(--text2)]">via {via}</span> : null}
                {p.isUsed ? <span className="rounded-full bg-[var(--good-soft)] px-2 py-0.5 font-bold text-[var(--good)]">Used</span> : null}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
