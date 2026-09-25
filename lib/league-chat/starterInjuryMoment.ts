import 'server-only'

import type { PrismaClient } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  buildWeekKickoffMap,
  computeLineupLock,
  normalizeLockTeam,
  readLineupLockSettings,
  type WeekKickoffs,
} from '@/lib/redraft/lineupLock'
import { isNflRedraftScoringStarterSlot } from '@/lib/scoring-runtime/canonicalNflRedraftScoringRuntime'
import { isBestBallLeague } from '@/lib/autocoach/bestBallShared'
import { safeDisplayName } from '@/lib/chat-notifications/displayName'
import { readChimmySpeaksUp } from '@/lib/league-chat/chimmyIdentity'
import { postChimmyMoment, type ChimmyMomentSkipReason } from '@/lib/league-chat/chimmyMoments'
import { newsTopicId, normalizeNewsName, ruledOutTag } from '@/lib/notifications/playerNewsRepeatGuard'

/**
 * STARTER INJURIES — when a player sitting in a STARTING lineup is ruled out before his game, Chimmy
 * says so in that league's chat, naming the team it hits (`kind: 'starter_injury'`).
 *
 * 🛑 NOT A SECOND INJURY DETECTOR. This is called from inside the injury-news pipeline
 * (`dispatchPendingPlayerNewsNotifications` in lib/notifications/PlayerNewsNotificationService.ts),
 * with the news row it is already dispatching and the roster rows it already read. "Ruled out" is the
 * repeat guard's own status reading (`ruledOutTag` over `injuryStatusTag`: OUT or IR — doubtful and
 * questionable are uncertainty, the same line lib/core-app/injuryStatus.ts draws), and "the same news"
 * is the repeat guard's own topic identity (`newsTopicId`: sport, player, category, status). Five
 * outlets repeating "ruled out" are one post; "questionable" → "ruled out" is a new one.
 *
 * WHO. Native AllFantasy leagues — the rosters the pipeline reaches (`RedraftRosterPlayer`). A player
 * counts only in a slot that scores: the native scoring engine's own starter test
 * (`isNflRedraftScoringStarterSlot`, the rule that decides whether his points count). Bench, IR,
 * taxi and an empty slot never post. A best-ball league has no lineup at all, so it never posts.
 *
 * WHEN. Before HIS game kicks off, from the same `SportsGame` kickoff map the lineup lock reads
 * (lib/redraft/lineupLock.ts) for the league's current week. No kickoff on file (a bye, an unknown
 * team) is no post: "before kickoff" cannot be claimed without a kickoff.
 *
 * ONCE. Per league, per player, per status, per week — the dedupe key is
 * `<season>:w<week>:<newsTopicId>` inside `postChimmyMoment`, which also applies the daily cap (this
 * kind is NOT exempt) and the league's "Chimmy speaks up" switch. Postgres only; never throws.
 */

export type StarterInjuryNews = {
  sport: string
  playerName: string
  team: string | null
  headline: string
}

/** A `RedraftRosterPlayer` row as the pipeline reads it. Every field is optional: older selects carry less. */
export type StarterInjuryRosterPlayer = {
  playerName?: string | null
  position?: string | null
  team?: string | null
  slotType?: string | null
  sport?: string | null
  roster?: {
    id?: string | null
    leagueId?: string | null
    seasonId?: string | null
    teamName?: string | null
    ownerName?: string | null
  } | null
}

export type StarterInjurySkip =
  | 'not_ruled_out'
  | 'other_player'
  | 'not_starter'
  | 'no_season'
  | 'best_ball'
  | 'disabled'
  | 'no_kickoff'
  | 'kicked_off'
  | 'no_team_name'
  | ChimmyMomentSkipReason

export type StarterInjuryResult = {
  posted: number
  skipped: Partial<Record<StarterInjurySkip, number>>
}

function starterSlot(slotType: string | null | undefined): boolean {
  // An empty slot is not a lineup spot, whatever the scoring default does with it.
  return typeof slotType === 'string' && slotType.trim() !== '' && isNflRedraftScoringStarterSlot(slotType.trim())
}

/** "Sun 1:00 PM ET" — the kickoff in the time zone NFL schedules are published in. */
export function kickoffLabelEt(at: Date): string {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(at)
  return `${s} ET`
}

/** Deterministic, so a retry says the same thing. */
function pick<T>(pool: readonly T[], seed: string): T {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return pool[h % pool.length]!
}

/** What Chimmy says. PURE. Real names, the week, the kickoff — and a nudge, not a lecture. */
export function starterInjuryText(input: {
  playerName: string
  position: string | null
  team: string | null
  status: 'out' | 'ir'
  fantasyTeam: string
  week: number
  kickoff: Date
  seed: string
  /**
   * Whether the manager can still move him. False when the league locks the whole lineup at the
   * week's first kickoff (or by hand) and that lock has passed — then "make the swap" would be a lie.
   */
  canSwap?: boolean
}): string {
  const tag = [input.position, input.team].filter((v) => typeof v === 'string' && v.trim()).join(', ')
  const who = tag ? `${input.playerName} (${tag})` : input.playerName
  const what = input.status === 'ir' ? 'is headed to IR' : `is ruled out for Week ${input.week}`
  const starter = input.status === 'ir' ? `one of your Week ${input.week} starters` : 'one of your starters'
  const closer =
    input.canSwap === false
      ? 'Lineups are already locked for this one, so the rest of the roster has to carry it.'
      : pick(
          ['There is still time to make the swap.', 'Check the bench before lock.', 'Find a replacement before kickoff.'],
          `${input.seed}:closer`,
        )
  return `🚑 ${who} ${what}. ${input.fantasyTeam}, that is ${starter} — kickoff is ${kickoffLabelEt(input.kickoff)}. ${closer}`
}

function bump(result: StarterInjuryResult, reason: StarterInjurySkip): void {
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1
}

/**
 * Post the starter-injury moment in every league where this ruled-out player is starting this week
 * and has not kicked off. Returns counts; never throws.
 */
export async function postStarterInjuryMoments(input: {
  news: StarterInjuryNews
  rosterPlayers: readonly StarterInjuryRosterPlayer[]
  now?: Date
}): Promise<StarterInjuryResult> {
  const result: StarterInjuryResult = { posted: 0, skipped: {} }
  const now = input.now ?? new Date()
  try {
    const status = ruledOutTag(input.news.headline)
    if (!status) {
      bump(result, 'not_ruled_out')
      return result
    }
    const newsName = normalizeNewsName(input.news.playerName)
    const newsSport = String(input.news.sport ?? '').toUpperCase()

    // One starter per league: the player is on at most one roster there.
    const byLeague = new Map<string, StarterInjuryRosterPlayer & { roster: NonNullable<StarterInjuryRosterPlayer['roster']> }>()
    for (const rp of input.rosterPlayers) {
      const roster = rp.roster
      if (!roster?.leagueId || !roster.seasonId) continue
      /*
       * The pipeline's roster read is a case-insensitive CONTAINS on the name, which is right for "who
       * might care" and wrong for a public post: "Josh Allen" contains in "Josh Allen Jr.", and there
       * are two NFL Josh Allens. Same normalised name, same sport, and — when both sides carry one —
       * the same team.
       */
      if (normalizeNewsName(rp.playerName ?? '') !== newsName) {
        bump(result, 'other_player')
        continue
      }
      if (rp.sport && String(rp.sport).toUpperCase() !== newsSport) {
        bump(result, 'other_player')
        continue
      }
      if (
        input.news.team &&
        rp.team &&
        normalizeLockTeam(newsSport, input.news.team) !== normalizeLockTeam(newsSport, rp.team)
      ) {
        bump(result, 'other_player')
        continue
      }
      if (!starterSlot(rp.slotType)) {
        bump(result, 'not_starter')
        continue
      }
      if (!byLeague.has(roster.leagueId)) byLeague.set(roster.leagueId, { ...rp, roster })
    }
    if (byLeague.size === 0) return result

    const seasonIds = [...new Set([...byLeague.values()].map((rp) => rp.roster.seasonId as string))]
    const seasons = await prisma.redraftSeason.findMany({
      where: { id: { in: seasonIds } },
      select: {
        id: true,
        season: true,
        sport: true,
        status: true,
        currentWeek: true,
        league: { select: { settings: true, bestBallMode: true, leagueVariant: true, leagueType: true } },
      },
    })
    const seasonById = new Map(seasons.map((s) => [s.id, s]))
    const kickoffMaps = new Map<string, Promise<WeekKickoffs>>()
    const kickoffsFor = (sport: string, season: number, week: number) => {
      const key = `${sport}:${season}:${week}`
      let hit = kickoffMaps.get(key)
      if (!hit) {
        hit = buildWeekKickoffMap(prisma as unknown as PrismaClient, { sport, season, week })
        kickoffMaps.set(key, hit)
      }
      return hit
    }

    for (const [leagueId, rp] of byLeague) {
      const season = seasonById.get(rp.roster.seasonId as string)
      const week = season?.currentWeek ?? 0
      if (!season || week < 1 || season.status === 'complete') {
        bump(result, 'no_season')
        continue
      }
      const league = season.league
      if (league && (isBestBallLeague(league.leagueVariant, league.bestBallMode) || isBestBallLeague(league.leagueType))) {
        bump(result, 'best_ball')
        continue
      }
      // Cheapest refusal before the schedule read; postChimmyMoment checks it again.
      if (league && !readChimmySpeaksUp(league.settings)) {
        bump(result, 'disabled')
        continue
      }
      const sport = String(season.sport || newsSport || 'NFL').toUpperCase()
      const kickoffs = await kickoffsFor(sport, season.season, week)
      const kickoff = kickoffs.byTeam.get(normalizeLockTeam(sport, rp.team ?? input.news.team)) ?? null
      if (!kickoff) {
        bump(result, 'no_kickoff')
        continue
      }
      if (now.getTime() >= kickoff.getTime()) {
        bump(result, 'kicked_off')
        continue
      }
      const fantasyTeam = safeDisplayName([rp.roster.teamName, rp.roster.ownerName], '')
      if (!fantasyTeam) {
        bump(result, 'no_team_name')
        continue
      }
      // The league's own lock rule decides whether "make the swap" is still true (lineupLock.ts).
      const lock = readLineupLockSettings(league?.settings)
      const locked = computeLineupLock({
        mode: lock.mode,
        now,
        playerKickoffUtc: kickoff,
        firstKickoffUtc: kickoffs.firstKickoff,
        manualLocked: lock.manualLockedWeeks.has(week),
      })

      const topic = newsTopicId({
        sport: input.news.sport,
        playerName: input.news.playerName,
        headline: input.news.headline,
        category: 'injury',
      })
      const posted = await postChimmyMoment({
        leagueId,
        kind: 'starter_injury',
        dedupeKey: `${season.season}:w${week}:${topic}`,
        text: starterInjuryText({
          playerName: rp.playerName?.trim() || input.news.playerName,
          position: rp.position ?? null,
          team: rp.team ?? input.news.team,
          status,
          fantasyTeam,
          week,
          kickoff,
          seed: `${leagueId}:${topic}`,
          canSwap: !locked,
        }),
        card: {
          starterInjury: {
            v: 1,
            player: rp.playerName?.trim() || input.news.playerName,
            position: rp.position ?? null,
            team: rp.team ?? input.news.team,
            status,
            fantasyTeam,
            season: season.season,
            week,
            kickoffAt: kickoff.toISOString(),
          },
        },
        messageType: 'system',
        now,
      })
      if (posted.posted) result.posted += 1
      else bump(result, posted.reason)
    }
  } catch (e) {
    console.warn('[starterInjuryMoment] failed', {
      error: e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : typeof e,
    })
  }
  return result
}
