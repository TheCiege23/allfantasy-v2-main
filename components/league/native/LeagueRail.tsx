'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import type { RailLeague, RailMatchupSummary } from '@/components/core-app/AfCoreShell'
import { LeagueMark } from '@/components/core-app/LeagueMark'
import { RailRowBody, mergeRailMatchup } from '@/components/core-app/RailRowBody'
import { useLiveRailScores, type LiveRailScore } from '@/components/core-app/useLiveRailScores'
import { coreRefreshIntervalMs } from '@/lib/core-app/coreRefreshPolicy'
import { importedPlatformLabel, isNativePlatform } from '@/lib/dashboard/platform-label'
import { nativeLeaguePhase } from '@/lib/league/nativeLeagueNavigation'

/**
 * The /league/[leagueId] league rail, drawn with /core's rail row.
 *
 * ⚠ NOT A SECOND RAIL. The data is `getRailMatchups` (the DB-first loader /core's rail reads,
 * called server-side in app/league/[leagueId]/page.tsx), the live overlay is `useLiveRailScores`
 * polling `/api/core/rail-scores`, and the row body is `RailRowBody` — the component /core's
 * rail renders. This file only maps a `UserLeague` onto those and owns the link.
 */
export type LeagueRailData = {
  /** `getRailMatchups(...).byLeague` — this week's head-to-head per league id. */
  matchups: Record<string, RailMatchupSummary>
  /** Resolved crest per league id (logo, Sleeper avatar, or the league type's artwork). */
  imageUrls: Record<string, string | null>
}

export type LeagueRailRowView = {
  id: string
  name: string
  /** Lower-cased platform; native spellings all become `native`, which `.af-platform` colours. */
  platform: string
  platformLabel: string
  mark: string
  imageUrl: string | null
  /** The merged matchup — server snapshot with the live poll laid over it. */
  m: RailMatchupSummary | null | undefined
  live: LiveRailScore | null
  /** A live poll row landed within the last 90 seconds: scores are moving right now. */
  isLive: boolean
  delayed: boolean
  freshMinutes: number | null
  /** "Wk 6" from the matchup when there is one, else the league's own week, else its phase. */
  weekLabel: string
}

const markOf = (name: string) =>
  (Array.from(name.trim() || '•')[0] ?? '•').toUpperCase()

/** Pure: one league's rail row, from the server snapshot, the live poll, and the client clock. */
export function leagueRailRowView(
  row: Pick<UserLeague, 'id' | 'name' | 'platform' | 'currentWeek' | 'lifecycleState' | 'status'>,
  rail: LeagueRailData | null | undefined,
  liveState: { scores: Record<string, LiveRailScore>; delayed: string[] },
  clock: number | null,
): LeagueRailRowView {
  const native = isNativePlatform(row.platform)
  const platform = native ? 'native' : String(row.platform ?? '').trim().toLowerCase()
  const saved = rail?.matchups?.[row.id] ?? null
  const live = liveState.scores[row.id] ?? null
  const m = mergeRailMatchup(saved, live)
  const liveAge = live && clock != null ? clock - Date.parse(live.updatedAt) : null
  const delayed = liveState.delayed.includes(row.id) || (liveAge != null && liveAge > 90_000)
  const freshAt = m?.freshAt ? Date.parse(m.freshAt) : Number.NaN
  const freshMinutes = clock != null && Number.isFinite(freshAt)
    ? Math.max(0, Math.floor((clock - freshAt) / 60_000))
    : null
  const week = m?.week ?? row.currentWeek ?? null
  const phase = nativeLeaguePhase(row)
  return {
    id: row.id,
    name: row.name,
    platform,
    platformLabel: native ? 'AF' : importedPlatformLabel(row.platform) ?? platform.toUpperCase(),
    mark: markOf(row.name),
    imageUrl: rail?.imageUrls?.[row.id] ?? null,
    m,
    live,
    isLive: Boolean(live && !delayed && m?.scored),
    delayed,
    freshMinutes,
    weekLabel: week != null && (phase === 'Regular season' || phase === 'Playoffs' || m) ? `Wk ${week}` : phase,
  }
}

/**
 * The live overlay for the rail, on /core's own cadence policy. `enabled` is the caller's "is the
 * expanded list on screen", the same gate /core uses (`railOpen`).
 */
export function useLeagueRail(leagues: UserLeague[], rail: LeagueRailData | null | undefined, enabled: boolean) {
  const railLeagues = useMemo<RailLeague[]>(
    () => leagues.map(l => ({ id: l.id, name: l.name, platform: String(l.platform ?? '').toLowerCase(), mark: markOf(l.name) })),
    [leagues],
  )
  const [clock, setClock] = useState<number | null>(null)
  useEffect(() => {
    setClock(Date.now())
    const tick = window.setInterval(() => setClock(Date.now()), 30_000)
    return () => window.clearInterval(tick)
  }, [])
  /*
   * /core decides "game day" from its own server reads; this page has none, so it asks the
   * snapshot: a live-cache row written in the last 15 minutes means scores are moving, and the
   * poll takes the 20s game-day cadence. Otherwise the idle cadence.
   */
  const gameDay = useMemo(() => {
    if (clock == null) return false
    return Object.values(rail?.matchups ?? {}).some(m =>
      m.source === 'live_cache' && m.scored && m.freshAt != null && clock - Date.parse(m.freshAt) < 15 * 60_000)
  }, [rail, clock])
  const liveState = useLiveRailScores(railLeagues, enabled, coreRefreshIntervalMs(gameDay, 0))
  return (row: UserLeague) => leagueRailRowView(row, rail, liveState, clock)
}

export function LeagueRailRow({
  view,
  href,
  active,
  expanded,
  isCommissioner,
  onClick,
}: {
  view: LeagueRailRowView
  href: string
  active: boolean
  /** False draws the crest alone — the collapsed rail. */
  expanded: boolean
  isCommissioner?: boolean
  onClick?: () => void
}) {
  return (
    <Link
      href={href}
      className="nl-rail-tile"
      data-platform={view.platform}
      data-active={active ? 'true' : undefined}
      data-live={view.isLive ? 'true' : undefined}
      aria-current={active ? 'page' : undefined}
      aria-label={`${view.name} on ${view.platformLabel}${view.isLive ? ', live' : ''}`}
      title={`${view.name} · ${view.platformLabel} · ${view.weekLabel}`}
      onClick={onClick}
    >
      <span className="af-rail-tile-art af-platform nl-rail-art" data-platform={view.platform}>
        <LeagueMark src={view.imageUrl} letter={view.mark} />
        {view.isLive ? <span className="nl-rail-live-dot" aria-hidden /> : null}
      </span>
      {expanded ? (
        <RailRowBody
          name={view.name}
          platform={view.platform}
          m={view.m}
          live={view.live}
          isCommissioner={isCommissioner}
          delayed={view.delayed}
          freshMinutes={view.freshMinutes}
          showScoreStatus={false}
          badges={
            <>
              {view.isLive ? <span className="af-rail-live-state">LIVE</span> : null}
              <span className="af-platform af-platform-chip nl-rail-chip" data-platform={view.platform}>{view.platformLabel}</span>
              <span className="nl-rail-week">{view.weekLabel}</span>
            </>
          }
        />
      ) : null}
    </Link>
  )
}
