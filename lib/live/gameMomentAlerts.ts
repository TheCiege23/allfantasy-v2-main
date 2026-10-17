import 'server-only'

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import type { RunBudget } from '@/lib/cron/runBudget'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { listUserIdsPlayingSport } from '@/lib/notifications/sportAudience'
import { withinDailyCap } from '@/lib/follows/teamFollowAlerts'
import { getTeamIndex, isTeamFollowSport, listFollowerIdsForTeam } from '@/lib/follows/teamFollows'
import { resolveTeam } from '@/lib/follows/teamResolver'
import { TEAM_SCORE_ALERTS_PER_DAY } from '@/lib/follows/teamScoreAlerts'
import { detectGameMoments, momentText, type GameMoment, type MomentKind, type MomentRow } from '@/lib/live/gameMoments'

/**
 * Live game moment alerts (2026-10-15) — close finishes, overtime, halftime, the 7th inning, the end
 * of a hockey period and the final, for all seven sports.
 *
 * WHY THIS EXISTS. Live alerts were football-only: teamScoreAlerts sends NFL/NCAAF halftime and
 * final scores to followers, and big plays go to managers starting the player. A Knicks game, an
 * NHL or MLB playoff game, a tight college basketball finish — nothing, for anyone.
 *
 * WHO GETS WHAT
 *   - Followers of either team: every moment, under `followed_team_scores` (sharing that category's
 *     daily cap with teamScoreAlerts). For NFL and college football, halftime and final are left to
 *     teamScoreAlerts, which already sends them.
 *   - Everyone else who plays the sport (lib/notifications/sportAudience), under `live_game_alerts`:
 *     close finishes and overtime always; halftime / 7th inning / end of period / final only for a
 *     POSTSEASON game. Capped at LIVE_GAME_ALERTS_PER_DAY per person.
 *
 * DATA. `getLiveScoresForSport({ forceRefresh: true })` is the existing read-through: it fetches
 * ESPN's scoreboard and persists every row to `SportsGame`, so this run is also an ingestion tick
 * that keeps the live pages' cache warm. Only rows that came from ESPN's live feed are acted on —
 * a cached fallback row carries no clock or period.
 *
 * ⚠ A FINAL IS SENT ONLY FOR A GAME THIS JOB HAS SEEN LIVE. The scoreboard lists the day's finished
 * games all day long; without the "seen live" mark, a first deploy (or a worker restart after an
 * outage) would announce every final since breakfast.
 *
 * ⚠ ONE ALERT PER (game, moment), ATOMICALLY — each is claimed as a `SportsDataCache` primary key
 * before sending, so overlapping runs cannot both send it.
 */

export const MOMENT_SPORTS = ['NBA', 'NHL', 'MLB', 'NCAAB', 'SOCCER', 'NFL', 'NCAAF'] as const
export const LIVE_GAME_ALERTS_PER_DAY = 6
const LEDGER_TTL_MS = 3 * 24 * 60 * 60 * 1000

/** Moments everyone who plays the sport is told about, whatever the game. */
const ALWAYS_BROAD: ReadonlySet<MomentKind> = new Set(['close_late', 'overtime'])
/** Football halftime and final already go to followers through teamScoreAlerts. */
const FOOTBALL = new Set(['NFL', 'NCAAF'])

export function momentLedgerKey(m: GameMoment, period: number): string {
  const suffix = m.kind === 'end_period' ? `:${period}` : ''
  return `game-moment:${m.kind}:${m.sport}:${m.gameId}${suffix}`
}

function seenLiveKey(sport: string, gameId: string): string {
  return `game-moment:seen-live:${sport}:${gameId}`
}

/** Who should hear about this moment, split by the category it goes out under. */
export function audienceFor(
  m: GameMoment,
  followers: ReadonlySet<string>,
  players: readonly string[],
): { followers: string[]; broad: string[] } {
  const followerOk = !(FOOTBALL.has(m.sport) && (m.kind === 'halftime' || m.kind === 'final'))
  const broadOk = ALWAYS_BROAD.has(m.kind) || m.postseason
  const f = followerOk ? [...followers] : []
  // A follower is told once, as a follower — never again as a member of the sport audience.
  const broad = broadOk ? players.filter((id) => !followers.has(id)) : []
  return { followers: f, broad }
}

async function claim(key: string, now: Date, data: Record<string, unknown>): Promise<boolean> {
  try {
    await prisma.sportsDataCache.create({
      data: { cacheKey: key, expiresAt: new Date(now.getTime() + LEDGER_TTL_MS), data: data as Prisma.InputJsonValue },
    })
    return true
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false
    throw err
  }
}

type LiveRow = MomentRow & { startTime?: string }

export async function dispatchGameMomentAlerts(input: { now?: Date; budget?: RunBudget; sports?: readonly string[] } = {}): Promise<{
  sports: Record<string, { rows: number; live: number; moments: number; sent: number; recipients: number; error?: string }>
}> {
  const now = input.now ?? new Date()
  const report: Record<string, { rows: number; live: number; moments: number; sent: number; recipients: number; error?: string }> = {}
  const { getLiveScoresForSport } = await import('@/lib/sports-live-scores-service')

  // Sequential, and each sport isolated: one feed failing must not silence the other six.
  for (const sport of input.sports ?? MOMENT_SPORTS) {
    if (input.budget?.exhausted()) break
    const r = { rows: 0, live: 0, moments: 0, sent: 0, recipients: 0 } as (typeof report)[string]
    report[sport] = r
    try {
      const res = await getLiveScoresForSport({ sport, forceRefresh: true })
      if (res.source !== 'espn_live') continue
      const rows = res.scores as LiveRow[]
      r.rows = rows.length

      // Mark every live game as seen, in one write.
      const live = rows.filter((g) => !g.completed && g.status !== 'STATUS_SCHEDULED' && g.status !== 'STATUS_POSTPONED' && g.status !== 'STATUS_CANCELED' && (g.homeScore != null || g.period > 0))
      r.live = live.length
      if (live.length > 0) {
        await prisma.sportsDataCache
          .createMany({
            data: live.map((g) => ({
              cacheKey: seenLiveKey(sport, g.gameId),
              expiresAt: new Date(now.getTime() + LEDGER_TTL_MS),
              data: { at: now.toISOString() } as Prisma.InputJsonValue,
            })),
            skipDuplicates: true,
          })
          .catch(() => {})
      }

      const index = isTeamFollowSport(sport) ? await getTeamIndex(sport) : null
      let players: string[] | null = null

      for (const row of rows) {
        if (input.budget?.exhausted()) break
        const moments = detectGameMoments(sport, row)
        if (moments.length === 0) continue
        for (const m of moments) {
          if (m.kind === 'final') {
            const seen = await prisma.sportsDataCache
              .findUnique({ where: { cacheKey: seenLiveKey(sport, row.gameId) }, select: { cacheKey: true } })
              .catch(() => null)
            if (!seen) continue
          }
          r.moments++

          const followers = new Set<string>()
          if (index) {
            for (const name of [row.homeTeamFull, row.awayTeamFull]) {
              const abbr = resolveTeam(index, name, { exactNames: true })
              if (!abbr) continue
              for (const id of (await listFollowerIdsForTeam(sport, abbr).catch(() => null)) ?? []) followers.add(id)
            }
          }
          const wantsBroad = ALWAYS_BROAD.has(m.kind) || m.postseason
          if (wantsBroad && players === null) players = await listUserIdsPlayingSport(sport)
          const aud = audienceFor(m, followers, players ?? [])
          if (aud.followers.length === 0 && aud.broad.length === 0) continue

          const key = momentLedgerKey(m, row.period)
          if (!(await claim(key, now, { homeScore: row.homeScore, awayScore: row.awayScore, detail: row.statusDetail }).catch(() => false))) continue

          const { title, body } = momentText(m, row)
          const meta = {
            sport,
            gameId: row.gameId,
            kind: m.kind,
            postseason: m.postseason,
            home: row.homeTeam,
            away: row.awayTeam,
            homeScore: row.homeScore,
            awayScore: row.awayScore,
          }
          const actionHref = `/live?sport=${encodeURIComponent(sport)}`

          if (aud.followers.length > 0) {
            const allowed = await withinDailyCap(aud.followers, { provider: 'team_score_alerts', limit: TEAM_SCORE_ALERTS_PER_DAY })
            if (allowed.length > 0) {
              await dispatchNotification({
                userIds: allowed,
                category: 'followed_team_scores',
                type: `game_moment_${m.kind}`,
                title,
                body,
                actionHref,
                actionLabel: 'Open live scores',
                leagueId: null,
                severity: 'medium',
                dedupePrefix: key,
                meta,
              }).catch((err) => console.error('[game-moments] follower dispatch failed:', err instanceof Error ? err.message : err))
              r.recipients += allowed.length
            }
          }
          if (aud.broad.length > 0) {
            const allowed = await withinDailyCap(aud.broad, { provider: 'live_game_alerts', limit: LIVE_GAME_ALERTS_PER_DAY })
            if (allowed.length > 0) {
              await dispatchNotification({
                userIds: allowed,
                category: 'live_game_alerts',
                type: `game_moment_${m.kind}`,
                title,
                body,
                actionHref,
                actionLabel: 'Open live scores',
                leagueId: null,
                severity: 'medium',
                dedupePrefix: key,
                meta,
              }).catch((err) => console.error('[game-moments] dispatch failed:', err instanceof Error ? err.message : err))
              r.recipients += allowed.length
            }
          }
          r.sent++
        }
      }
    } catch (err) {
      r.error = (err instanceof Error ? err.message : String(err)).slice(0, 200)
      console.error(`[game-moments] ${sport} failed:`, r.error)
    }
  }
  return { sports: report }
}
