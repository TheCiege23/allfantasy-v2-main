'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import type { RailLeague, RailMatchupSummary } from '@/components/core-app/AfCoreShell'
import { LeagueMark } from '@/components/core-app/LeagueMark'
import { RailRowBody, mergeRailMatchup, railTapTarget } from '@/components/core-app/RailRowBody'
import { useRailOdds } from '@/components/core-app/useRailOdds'
import type { useRailHold } from '@/components/core-app/RailLeagueMenu'
import type { RailRecord } from '@/lib/core-app/railRecordRank'
import { useLiveRailScores, type LiveRailScore } from '@/components/core-app/useLiveRailScores'
import { coreRefreshIntervalMs } from '@/lib/core-app/coreRefreshPolicy'
import { importedPlatformLabel, isNativePlatform } from '@/lib/dashboard/platform-label'
import { nativeLeaguePhase } from '@/lib/league/nativeLeagueNavigation'
import { leagueRailStatus, unreadBadgeText, type LeagueRailStatus } from '@/lib/league/leagueRailStatus'

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
  /** Your record and place per league — "6-3 · 2nd" (lib/core-app/railRecords.ts). */
  records?: Record<string, RailRecord>
  /** The account's favorites, pinned on top, and its saved order (leaguePreferences.ts). */
  favoriteIds?: string[]
  order?: string[]
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
  /** Handoff §2: ring colour, the mono line under the crest, and the switcher group. */
  status: LeagueRailStatus
  /** Your win chance this week, from the Matchup board (useRailOdds.ts). */
  pWin?: number | null
  /** An imported league's Matchup screen, for a tap on the head-to-head. Null for a native league. */
  matchupHref?: string | null
  /** Your record and place. Null in a field-race league, or before any game. */
  record?: RailRecord | null
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
  const weekLabel = week != null && (phase === 'Regular season' || phase === 'Playoffs' || m) ? `Wk ${week}` : phase
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
    weekLabel,
    status: leagueRailStatus({ m, phase, weekLabel }),
    matchupHref: !native && m && !m.unpaired && !m.guillotine ? `/core/matchup?league=${encodeURIComponent(row.id)}` : null,
    /* A field race's line is its place among the survivors; a W-L record says nothing there. */
    record: m?.guillotine || m?.standing?.elimination ? null : rail?.records?.[row.id] ?? null,
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
  /* Native rows (a guillotine line, a native head-to-head) poll the same route, answered from the database. */
  const nativeIds = useMemo(
    () => Object.entries(rail?.matchups ?? {}).filter(([, m]) => m.native).map(([id]) => id),
    [rail],
  )
  const liveState = useLiveRailScores(railLeagues, enabled, coreRefreshIntervalMs(gameDay, 0), nativeIds)
  const odds = useRailOdds(enabled)
  return (row: UserLeague) => ({ ...leagueRailRowView(row, rail, liveState, clock), pWin: odds[row.id] ?? null })
}

export function LeagueRailRow({
  view,
  href,
  active,
  expanded,
  isCommissioner,
  onClick,
  unread = 0,
  favorite,
  hold,
}: {
  view: LeagueRailRowView
  href: string
  active: boolean
  /** False draws the crest alone — the collapsed rail. */
  expanded: boolean
  isCommissioner?: boolean
  onClick?: () => void
  /** Unread league-chat messages (`/api/chat/unread` → byLeague). */
  unread?: number
  /** Pinned on top of the list — draws the star after the name. */
  favorite?: boolean
  /** Press-and-hold / right-click for Pin and Move (RailLeagueMenu.tsx). Absent: no menu. */
  hold?: ReturnType<typeof useRailHold>
}) {
  const badge = unreadBadgeText(unread)
  const { status } = view
  return (
    <Link
      href={href}
      className="nl-rail-tile"
      data-platform={view.platform}
      data-active={active ? 'true' : undefined}
      data-live={view.isLive ? 'true' : undefined}
      aria-current={active ? 'page' : undefined}
      data-ring={status.tone ?? undefined}
      aria-label={`${view.name} on ${view.platformLabel}, ${status.line}${badge ? `, ${badge} unread` : ''}${view.isLive ? ', live' : ''}`}
      title={`${view.name} · ${status.line} · ${status.mini}`}
      data-favorite={favorite ? 'true' : undefined}
      {...(hold ? hold.handlers(view.id) : {})}
      onClick={(event) => {
        if (hold?.swallowClick(event)) return
        /*
         * A tap on the head-to-head opens the Matchup screen; anywhere else, the league. One link
         * either way (see `railTapTarget`). The Matchup screen is /core's, so this is a full
         * navigation out of the workspace.
         */
        const target = expanded ? railTapTarget(event) : null
        if (target) event.preventDefault()
        onClick?.()
        if (target) window.location.assign(target)
      }}
    >
      <span className="nl-rail-crest">
        <span className="af-rail-tile-art af-platform nl-rail-art" data-platform={view.platform} data-ring={status.tone ?? undefined}>
          <LeagueMark src={view.imageUrl} letter={view.mark} />
          {view.isLive ? <span className="nl-rail-live-dot" aria-hidden /> : null}
          {badge ? <span className="nl-rail-unread" aria-hidden>{badge}</span> : null}
          {!expanded ? <span className="nl-rail-tag" data-platform={view.platform} aria-hidden>{view.platformLabel}</span> : null}
        </span>
        {!expanded ? <span className="nl-rail-mini" data-tone={status.tone ?? undefined} aria-hidden>{status.mini}</span> : null}
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
          pWin={view.pWin ?? null}
          matchupHref={view.matchupHref ?? null}
          record={view.record ?? null}
          badges={
            <>
              {view.isLive ? <span className="af-rail-live-state">LIVE</span> : null}
              <span className="af-platform af-platform-chip af-rail-row-plat nl-rail-chip" data-platform={view.platform}>{view.platformLabel}</span>
            </>
          }
        />
      ) : null}
    </Link>
  )
}
