'use client'

import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useZombieAnimationSse } from '@/lib/hooks/useZombieAnimationSse'
import { LeagueClipOverlayHost } from '@/components/league/LeagueClipOverlayHost'
import { ZombieBashingCard, type ZombieBashingRules } from '@/components/zombie/ZombieBashingCard'
import type { ZombieMatchupView } from '@/lib/zombie/zombieMatchupBoard'

type MatchupsPayload = {
  matchups?: ZombieMatchupView[]
  week?: number
  rules?: ZombieBashingRules
}

/** The week's matchups as Bashing cards — yours first — with the sport's real bash/maul lines. */
export default function ZombieMatchupsPage() {
  const { leagueId } = useParams<{ leagueId: string }>() ?? ({} as { leagueId: string })
  const [list, setList] = useState<ZombieMatchupView[]>([])
  /** Null until the first load: the server picks the league's current week. */
  const [week, setWeek] = useState<number | null>(null)
  const [rules, setRules] = useState<ZombieBashingRules | null>(null)
  const lastAnimId = useRef<string | null>(null)

  const loadMatchups = useCallback(() => {
    if (!leagueId) return
    const qs = week != null ? `&week=${week}` : ''
    fetch(`/api/zombie/matchups?leagueId=${encodeURIComponent(leagueId)}${qs}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: MatchupsPayload | null) => {
        if (!d) return
        setList(d.matchups ?? [])
        if (d.week && d.week !== week) setWeek(d.week)
        if (d.rules) setRules(d.rules)
      })
      .catch(() => setList([]))
  }, [leagueId, week])

  const loadRef = useRef(loadMatchups)
  loadRef.current = loadMatchups

  useEffect(() => {
    loadMatchups()
  }, [loadMatchups])

  useEffect(() => {
    if (!leagueId) return
    const t = setInterval(() => loadRef.current(), 30_000)
    return () => clearInterval(t)
  }, [leagueId])

  useZombieAnimationSse(
    leagueId ?? null,
    (ev) => {
      if (ev.leagueId && ev.leagueId !== leagueId) return
      if (ev.id && lastAnimId.current === ev.id) return
      if (ev.id) lastAnimId.current = ev.id
      loadRef.current()
    },
    Boolean(leagueId),
  )

  const ordered = [...list].sort((a, b) => Number(Boolean(b.mySide)) - Number(Boolean(a.mySide)))

  return (
    <div>
      {leagueId ? <LeagueClipOverlayHost leagueId={leagueId} variant="zombie" enabled /> : null}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white">Bashings and maulings{week ? ` · week ${week}` : ''}</h1>
          {rules ? (
            <p className="text-[13px] text-white/60">
              Win by {rules.bashingThreshold}+ to bash, {rules.maulingThreshold}+ to maul. The loser hands over{' '}
              the winnings allowed by the league rules, limited to what the losing team holds.
            </p>
          ) : null}
        </div>
        {week ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setWeek(Math.max(1, week - 1))}
              disabled={week <= 1}
              className="min-h-[40px] rounded-xl border border-white/15 bg-black/30 px-3 text-sm text-white disabled:opacity-40"
            >
              ‹ Week {Math.max(1, week - 1)}
            </button>
            <button
              type="button"
              onClick={() => setWeek(week + 1)}
              className="min-h-[40px] rounded-xl border border-white/15 bg-black/30 px-3 text-sm text-white"
            >
              Week {week + 1} ›
            </button>
          </div>
        ) : null}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {rules ? ordered.map((m) => <ZombieBashingCard key={m.id} m={m} rules={rules} />) : null}
      </div>
      {!list.length ? <p className="text-[13px] text-[var(--zombie-text-dim)]">No matchups this week.</p> : null}
    </div>
  )
}
