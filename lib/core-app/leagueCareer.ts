import 'server-only'
import { leagueWeekProgress } from './leagueWeekProgress'

import { prisma } from '@/lib/prisma'
import { leagueDisplayName, type SectionState } from './leagueHome'
import { leagueContextFor, type LeagueContext, type LeagueContextRow } from './leagueContext'
import { letterFor, type GradeLetter } from '@/lib/trade-intel/gradeScale'
import { resolveLeagueCardTypeKey } from '@/lib/league-media/leagueTypeMedia'
import { buildWeeklyCareer, type WeeklyCareer } from './leagueWeeklyCareer'
import type { TradeGradesPayload, TradeSideGrade } from '@/lib/trade-intel/sleeperTradeGradeService'

/**
 * Cache key prefix owned by `sleeperTradeGradeService`.
 *
 * Duplicated as a constant rather than imported because that module is
 * server-only AND reaches the Sleeper API; importing it here to borrow one
 * string would drag a provider client into this file's graph and trip the
 * db-first boundary guard on a module that only ever reads Postgres.
 */
const TRADE_GRADES_CACHE_PREFIX = 'trade-grades:v2:'

/**
 * League Career — your record inside ONE league, across every season of it
 * (38a·6).
 *
 * ⚠ THE SOURCE IS `MatchupFact` (`dw_matchup_facts`), NOT `WeeklyMatchup`, AND
 * THAT IS NOT INTERCHANGEABLE. Sleeper league ids are per-season: a dynasty
 * league running six years is six different `platformLeagueId` values, so
 * `WeeklyMatchup` — which is keyed on the provider id — can only ever answer for
 * the current season. `MatchupFact` is keyed on OUR `League.id` with historical
 * roster ids already remapped, which makes it the only table in this repo that
 * can answer "how have I done in this league since 2019".
 *
 * ── Policies this file inherits from ADR F2.10 ───────────────────────────
 *
 * They are binding on every consumer, and three of them shape this file:
 *
 *   1. NO CONSUMER MAY RENDER ABSENCE AS 0 WINS AND 0 LOSSES. The ADR wrote this
 *      when three leagues had matchup facts; ⚠ THAT COUNT IS LONG STALE —
 *      measured on production 2026-10-01, 295 of 398 leagues render a career
 *      here. The policy stands; the "sparse is normal" premise does not. Most of
 *      what is still missing is leagues with no opponent at all (guillotine), now
 *      read from weekly team scores — see `getWeeklyCareer` below.
 *   3. Incomplete fixtures — `scoreA = 0 ∧ scoreB = 0 ∧ winnerTeamId IS NULL` —
 *      are EXCLUDED from every completed summary. They are scheduled games, not
 *      ties. 108 of the 1,186 rows are these.
 *   6. Opponent strength, strength of schedule, momentum and manager quality are
 *      never derived. Per-matchup projections were never stored, so accuracy is
 *      impossible rather than merely missing.
 *
 * The team bridge is also binding: `teamA`/`teamB` are provider roster-slot ids,
 * resolved to canonical teams through `(leagueId, externalId)` on `LeagueTeam` —
 * the scoring engine's own join. They are NOT canonical ids and joining them as
 * if they were silently matches nothing.
 */

export type CareerSeasonLine = {
  season: number
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  /** Completed games only — incomplete fixtures never count. */
  games: number
}

export type CareerRival = {
  name: string
  wins: number
  losses: number
  meetings: number
  /** Your average margin against them. Negative means they beat you. */
  averageMargin: number
}

export type LeagueGrade = {
  letter: GradeLetter
  /** What the letter is computed from — never rendered without it. */
  sample: string
  /** The number behind the letter, for anyone who wants it. */
  value: number
}

export type LeagueCareerData = {
  league: { id: string; name: string; platform: string }
  /** Seasons with at least one completed game, oldest first. */
  seasons: CareerSeasonLine[]
  totals: { wins: number; losses: number; pointsFor: number; games: number; winPct: number | null }
  firstSeason: number
  lastSeason: number
  /** The opponent who has beaten you most. Null until you have met someone twice. */
  toughestRival: CareerRival | null
  tradeGrade: SectionState<LeagueGrade>
  waiverGrade: SectionState<LeagueGrade>
  tradeStory: SectionState<CareerTradeStory>
}

export type CareerTradeMoment = {
  id: string
  date: string
  season: string
  week: number
  partner: string
  net: number
  initialGrade: GradeLetter
  currentGrade: GradeLetter
  received: string[]
  sent: string[]
}

export type CareerTradeJourneyPoint = { date: string; value: number }

export type CareerTradeAward = {
  key: 'partners' | 'active' | 'quiet' | 'frenemies'
  title: string
  subtitle: string
  winner: string
  countLabel: string
}

export type CareerTradeStory = {
  trades: CareerTradeMoment[]
  best: CareerTradeMoment
  worst: CareerTradeMoment
  journey: CareerTradeJourneyPoint[]
  finalValue: number
  awards: CareerTradeAward[]
}

/** A league with no head-to-head history, read from weekly team scores — see `leagueWeeklyCareer.ts`. */
export type LeagueWeeklyCareerData = {
  league: { id: string; name: string; platform: string }
  weekly: WeeklyCareer
  tradeGrade: SectionState<LeagueGrade>
  waiverGrade: SectionState<LeagueGrade>
  tradeStory: SectionState<CareerTradeStory>
}

export type LeagueCareerResult =
  | ({ available: true; mode?: 'h2h' } & LeagueCareerData)
  | ({ available: true; mode: 'weekly' } & LeagueWeeklyCareerData)
  | { available: false; leagueName: string; reason: string }

/** Below this a "rivalry" is one game, which is a result rather than a pattern. */
const MIN_RIVAL_MEETINGS = 2

/**
 * ⚠ INCOMPLETE FIXTURE, NOT A TIE. ADR F2.10 policy 3, stated as code so no
 * caller has to remember it. A 0-0 with a winner recorded IS a real completed
 * game (a double-forfeit, say) and counts normally — only the null-winner case
 * is a fixture that has not happened.
 */
function isCompleted(f: { scoreA: number; scoreB: number; winnerTeamId: string | null }): boolean {
  return !(f.scoreA === 0 && f.scoreB === 0 && f.winnerTeamId == null)
}

/** One played game, from either source. `teamA`/`teamB` are slot keys the caller's `mySlots` uses. */
type CareerFixture = {
  season: number | null
  weekOrPeriod: number
  teamA: string
  teamB: string
  scoreA: number
  scoreB: number
  winnerTeamId: string | null
}

/**
 * A native league's finished games, as fixtures keyed on `RedraftRoster.id`.
 *
 * ⚠ IDENTITY IS `RedraftRoster.ownerId`, NOT A CLAIMED `LeagueTeam`. Native rosters are owned by an
 * AppUser id directly; every other roster is a placeholder (`open-slot…`, `orphan…`, `local-…`,
 * measured on production 2026-10-01). A claim lookup would find no team for the owner of a league
 * they are plainly playing in.
 *
 * ⚠ BYES AND MEDIAN GAMES ARE NOT GAMES AGAINST A MANAGER. A null `awayRosterId` is a bye, and an
 * `isMedianMatchup` row is a game against the league median — counting either would hand you a
 * "rival" who does not exist. Only `status = 'final'`: a scheduled or live week is not a result.
 */
async function readNativeFixtures(
  leagueId: string,
  userId: string,
): Promise<{ fixtures: CareerFixture[]; mySlots: Set<string>; nameBySlot: Map<string, string> } | null> {
  const [matchups, rosters] = await Promise.all([
    prisma.redraftMatchup
      .findMany({
        where: { leagueId, status: 'final', isMedianMatchup: false, awayRosterId: { not: null } },
        select: {
          week: true,
          homeRosterId: true,
          awayRosterId: true,
          homeScore: true,
          awayScore: true,
          season: { select: { season: true } },
        },
      })
      .catch(() => []),
    prisma.redraftRoster
      .findMany({ where: { leagueId }, select: { id: true, ownerId: true, ownerName: true, teamName: true } })
      .catch(() => []),
  ])
  if (matchups.length === 0) return null

  const nameBySlot = new Map<string, string>()
  for (const r of rosters) {
    const label = r.teamName?.trim() || r.ownerName?.trim()
    if (label) nameBySlot.set(r.id, label)
  }
  return {
    fixtures: matchups.map((m) => ({
      season: m.season?.season ?? null,
      weekOrPeriod: m.week,
      teamA: m.homeRosterId,
      teamB: m.awayRosterId as string,
      scoreA: m.homeScore,
      scoreB: m.awayScore,
      winnerTeamId: null,
    })),
    mySlots: new Set(rosters.filter((r) => r.ownerId === userId).map((r) => r.id)),
    nameBySlot,
  }
}

/** League phases where no week can have been played — the honest answer is "not yet", not "missing". */
const NOT_STARTED_STATUSES = new Set(['pre_draft', 'drafting', 'draft', 'setup'])

/**
 * Weekly team scores for a league with no fixture history, shaped by `buildWeeklyCareer`.
 *
 * ⚠ FORMAT FROM THE CANONICAL RESOLVER. `resolveLeagueCardTypeKey` reads the column, the variant
 * AND the settings flag; the `leagueType` column alone misses older guillotine leagues (measured
 * 2026-09-08: 12 by column, 14 really). Only a guillotine is read as elimination — anything else
 * is reported as plain weekly scores, which makes no claim about being chopped.
 */
async function getWeeklyCareer(league: LeagueContextRow, mySlots: ReadonlySet<string>): Promise<WeeklyCareer | null> {
  const rows = await prisma.teamPerformance
    .findMany({
      where: { team: { leagueId: league.id }, points: { gt: 0 } },
      select: { season: true, week: true, points: true, team: { select: { externalId: true } } },
    })
    .catch(() => [])
  if (rows.length === 0) return null

  const typeKey = resolveLeagueCardTypeKey({
    leagueType: league.leagueType,
    leagueVariant: league.leagueVariant,
    settings: (league.settings ?? undefined) as Record<string, unknown> | undefined,
    isDynasty: league.isDynasty,
    guillotineMode: league.guillotineMode,
    bestBallMode: league.bestBallMode,
  })
  const progress = leagueWeekProgress(league)
  return buildWeeklyCareer({
    rows: rows.map((r) => ({ slot: String(r.team.externalId), season: r.season, week: r.week, points: r.points })),
    mySlots,
    format: typeKey === 'guillotine' ? 'elimination' : 'scores',
    isFinal: (season, week) => progress.currentWeek == null || progress.isFinal(season, week),
  })
}

export async function getLeagueCareer(
  leagueId: string,
  userId: string,
  /** The render's shared league context — see `leagueContext.ts`. */
  ctx?: LeagueContext | null,
): Promise<LeagueCareerResult> {
  const lc = leagueContextFor(leagueId, userId, ctx)
  const league = await lc.league()
  const leagueName = leagueDisplayName(league?.name)
  if (!league) {
    return { available: false, leagueName, reason: 'this league could not be read' }
  }

  /*
   * The ADR's port contract: two bounded find-only reads, joined in process.
   * Prisma cannot express the team bridge relationally, and the ADR measured the
   * worst-case league at 0.613 ms — this is not worth a view or a cache.
   */
  const [facts, teams] = await Promise.all([
    prisma.matchupFact
      .findMany({
        where: { leagueId },
        select: {
          season: true,
          weekOrPeriod: true,
          teamA: true,
          teamB: true,
          scoreA: true,
          scoreB: true,
          winnerTeamId: true,
        },
      })
      .catch(() => []),
    prisma.leagueTeam
      .findMany({
        where: { leagueId },
        select: {
          externalId: true, teamName: true, ownerName: true, claimedByUserId: true,
          platformUserId: true,
        },
      })
      .catch(() => []),
  ])

  let fixtures: CareerFixture[] = facts
  let mySlots = new Set(
    teams.filter((t) => t.claimedByUserId === userId).map((t) => String(t.externalId)),
  )
  const nameBySlot = new Map<string, string>()
  for (const t of teams) {
    const label = t.teamName?.trim() || t.ownerName?.trim()
    if (label) nameBySlot.set(String(t.externalId), label)
  }
  let progress: { currentWeek: number | null; isFinal(season: number, week: number): boolean } =
    leagueWeekProgress(league)

  /*
   * An AllFantasy-native league keeps its own fixtures — `redraft_matchups`, scored by our engine —
   * and never had a warehouse import to fill `MatchupFact`. Same summary, different source. Only
   * looked for when the warehouse is empty, so an imported league never pays for the read.
   */
  if (facts.length === 0) {
    const native = await readNativeFixtures(leagueId, userId)
    if (native) {
      fixtures = native.fixtures
      mySlots = native.mySlots
      for (const [slot, name] of native.nameBySlot) nameBySlot.set(slot, name)
      // `status = 'final'` is the engine's own verdict, already applied in the read.
      progress = { currentWeek: null, isFinal: () => true }
    }
  }

  if (fixtures.length === 0) {
    /*
     * ⚠ NO FIXTURES IS NOT NO HISTORY. The comment that used to stand here called this "the
     * normal path" on the strength of three leagues having matchup facts; measured on production
     * 2026-10-01, 295 of 398 leagues do. What is left here is mostly leagues with no opponent to
     * record — guillotine and elimination formats — whose every weekly score is in
     * `team_performances`. Read that before giving up, and say plainly when the league simply has
     * not played yet rather than blaming a backfill that has nothing to fetch.
     *
     * It still never renders absence as 0—0 (policy 1): every branch below either has real weeks
     * or says why there are none.
     */
    if (mySlots.size > 0) {
      const weekly = await getWeeklyCareer(league, mySlots)
      if (weekly) {
        const [tradeGrade, waiverGrade, tradeStory] = await Promise.all([
          gradeTrades(leagueId, league.platformLeagueId, userId, lc),
          gradeWaivers(leagueId, userId),
          loadTradeStory(league.platformLeagueId, userId, teams),
        ])
        return {
          available: true,
          mode: 'weekly',
          league: { id: league.id, name: leagueName, platform: String(league.platform ?? 'manual').toLowerCase() },
          weekly,
          tradeGrade,
          waiverGrade,
          tradeStory,
        }
      }
    }
    if (NOT_STARTED_STATUSES.has(String(league.status ?? '').toLowerCase())) {
      return {
        available: false,
        leagueName,
        reason:
          'this league has not played a week yet. Your career here starts once week 1’s games are final — every score after that lands on this screen.',
      }
    }
    if (mySlots.size > 0) {
      return {
        available: false,
        leagueName,
        reason:
          'no finished week is on file for this league yet — no head-to-head results and no weekly team scores. Once a week’s games are final and the league next syncs, your record here starts.',
      }
    }
  }

  if (mySlots.size === 0) {
    return {
      available: false,
      leagueName,
      reason:
        'we cannot tell which team in this league is yours, and every figure on this screen is about your team specifically',
    }
  }

  const bySeason = new Map<number, CareerSeasonLine>()
  const rivals = new Map<string, { wins: number; losses: number; meetings: number; marginSum: number }>()

  const seenGames = new Set<string>()
  for (const f of fixtures) {
    if (!isCompleted(f)) continue
    if (f.season == null) continue
    if (progress.currentWeek != null && !progress.isFinal(f.season, f.weekOrPeriod)) continue
    const key = `${f.season}:${f.weekOrPeriod}:${[String(f.teamA), String(f.teamB)].sort().join(':')}`
    if (seenGames.has(key)) continue
    seenGames.add(key)

    const aIsMine = mySlots.has(String(f.teamA))
    const bIsMine = mySlots.has(String(f.teamB))
    if (!aIsMine && !bIsMine) continue

    const myScore = aIsMine ? f.scoreA : f.scoreB
    const theirScore = aIsMine ? f.scoreB : f.scoreA
    const theirSlot = String(aIsMine ? f.teamB : f.teamA)

    const line = bySeason.get(f.season) ?? {
      season: f.season,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      games: 0,
    }
    line.games += 1
    line.pointsFor += myScore
    line.pointsAgainst += theirScore
    /*
     * The winner column is authoritative where it exists — it is what the
     * provider recorded, and a league with median-based or all-play scoring can
     * have a winner that comparing two totals would get wrong. Score comparison
     * is only the fallback.
     */
    const mySlotForRow = String(aIsMine ? f.teamA : f.teamB)
    const won =
      f.winnerTeamId != null ? String(f.winnerTeamId) === mySlotForRow : myScore > theirScore
    if (won) line.wins += 1
    else line.losses += 1
    bySeason.set(f.season, line)

    const r = rivals.get(theirSlot) ?? { wins: 0, losses: 0, meetings: 0, marginSum: 0 }
    r.meetings += 1
    r.marginSum += myScore - theirScore
    if (won) r.wins += 1
    else r.losses += 1
    rivals.set(theirSlot, r)
  }

  const seasons = [...bySeason.values()].sort((a, b) => a.season - b.season)

  if (seasons.length === 0) {
    return {
      available: false,
      leagueName,
      reason:
        'this league has matchup history on file, but none of it involves your team — either the roster was claimed after those seasons or the historical rows belong to a different manager slot',
    }
  }

  const totals = seasons.reduce(
    (acc, s) => ({
      wins: acc.wins + s.wins,
      losses: acc.losses + s.losses,
      pointsFor: acc.pointsFor + s.pointsFor,
      games: acc.games + s.games,
    }),
    { wins: 0, losses: 0, pointsFor: 0, games: 0 },
  )

  /*
   * Toughest rival is who has beaten you most, tie-broken by the margin they
   * beat you by. Not "closest record" and not "most meetings" — the question
   * this answers is which manager has actually cost you games.
   */
  const toughestRival: CareerRival | null =
    [...rivals.entries()]
      .filter(([, r]) => r.meetings >= MIN_RIVAL_MEETINGS)
      .map(([slot, r]) => ({
        name: nameBySlot.get(slot) ?? 'Unnamed team',
        wins: r.wins,
        losses: r.losses,
        meetings: r.meetings,
        averageMargin: r.marginSum / r.meetings,
      }))
      .sort((a, b) => b.losses - a.losses || a.averageMargin - b.averageMargin)[0] ?? null

  const [tradeGrade, waiverGrade, tradeStory] = await Promise.all([
    gradeTrades(leagueId, league.platformLeagueId, userId, lc),
    gradeWaivers(leagueId, userId),
    loadTradeStory(league.platformLeagueId, userId, teams),
  ])

  return {
    available: true,
    league: {
      id: league.id,
      name: leagueName,
      platform: String(league.platform ?? 'manual').toLowerCase(),
    },
    seasons,
    totals: {
      ...totals,
      winPct: totals.games > 0 ? totals.wins / totals.games : null,
    },
    firstSeason: seasons[0].season,
    lastSeason: seasons[seasons.length - 1].season,
    toughestRival,
    tradeGrade,
    waiverGrade,
    tradeStory,
  }
}

type CareerTeamIdentity = {
  teamName: string
  ownerName: string
  claimedByUserId: string | null
  platformUserId: string | null
}

function sideLabel(side: TradeSideGrade): string {
  return side.teamName?.trim() || side.managerName?.trim() || 'Unnamed team'
}

function assetLabels(side: TradeSideGrade, direction: 'in' | 'out'): string[] {
  const players = direction === 'in' ? side.playersIn : side.playersOut
  const picks = direction === 'in' ? side.picksIn : side.picksOut
  return [
    ...players.map((asset) => asset.name),
    ...picks.map((pick) => pick.label),
  ].filter(Boolean)
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('::')
}

async function loadTradeStory(
  platformLeagueId: string | null,
  userId: string,
  teams: CareerTeamIdentity[],
): Promise<SectionState<CareerTradeStory>> {
  if (!platformLeagueId) return { available: false, reason: 'Trade history has no provider league id.' }

  const cached = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey: `${TRADE_GRADES_CACHE_PREFIX}${platformLeagueId}` } })
    .catch(() => null)
  const payload = cached?.data as unknown as TradeGradesPayload | null
  if (!payload || payload.version !== 2 || !Array.isArray(payload.trades)) {
    return { available: false, reason: 'The historical trade grading pass has not run for this league yet.' }
  }

  const ownerId = teams.find((team) => team.claimedByUserId === userId)?.platformUserId ?? null
  if (!ownerId) return { available: false, reason: 'Your manager identity is not linked to this trade history.' }

  const chronological = [...payload.trades].sort(
    (a, b) => new Date(a.createdIso).getTime() - new Date(b.createdIso).getTime(),
  )
  const mine: CareerTradeMoment[] = []
  const journey: CareerTradeJourneyPoint[] = []
  let cumulative = 0

  for (const trade of chronological) {
    const side = trade.sides.find((candidate) => candidate.ownerId === ownerId)
    if (!side) continue
    const others = trade.sides.filter((candidate) => candidate.ownerId !== ownerId).map(sideLabel)
    const moment: CareerTradeMoment = {
      id: trade.id,
      date: trade.createdIso,
      season: trade.season,
      week: trade.week,
      partner: others.join(', ') || 'Unknown partner',
      net: side.cumulativeNet,
      initialGrade: side.initialGrade,
      currentGrade: side.currentGrade,
      received: assetLabels(side, 'in'),
      sent: assetLabels(side, 'out'),
    }
    mine.push(moment)
    cumulative += moment.net
    journey.push({ date: trade.createdIso, value: Math.round(cumulative) })
  }

  if (mine.length === 0) {
    return { available: false, reason: 'No completed trade involving your team is in this league history.' }
  }

  const managers = new Map<string, string>()
  for (const team of teams) {
    if (team.platformUserId) managers.set(team.platformUserId, team.teamName?.trim() || team.ownerName?.trim() || 'Unnamed team')
  }
  for (const trade of payload.trades) {
    for (const side of trade.sides) if (side.ownerId) managers.set(side.ownerId, sideLabel(side))
  }

  const managerCounts = new Map<string, number>([...managers.keys()].map((id) => [id, 0]))
  const pairCounts = new Map<string, number>()
  for (const trade of payload.trades) {
    const participants = [...new Set(trade.sides.map((side) => side.ownerId).filter((id): id is string => Boolean(id)))]
    for (const id of participants) managerCounts.set(id, (managerCounts.get(id) ?? 0) + 1)
    for (let i = 0; i < participants.length; i += 1) {
      for (let j = i + 1; j < participants.length; j += 1) {
        const key = pairKey(participants[i], participants[j])
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
      }
    }
  }

  const activity = [...managerCounts.entries()].sort((a, b) => b[1] - a[1])
  const frequent = [...pairCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  let zeroPair: [string, string] | null = null
  const ids = [...managers.keys()]
  for (let i = 0; i < ids.length && !zeroPair; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      if (!pairCounts.has(pairKey(ids[i], ids[j]))) { zeroPair = [ids[i], ids[j]]; break }
    }
  }

  const awards: CareerTradeAward[] = []
  if (frequent) {
    const names = frequent[0].split('::').map((id) => managers.get(id) ?? 'Unknown team')
    awards.push({ key: 'partners', title: 'Favorite trade partners', subtitle: 'Most deals together', winner: names.join(' & '), countLabel: `${frequent[1]} trades` })
  }
  if (activity[0]) awards.push({ key: 'active', title: 'The active desk', subtitle: 'Most trades completed', winner: managers.get(activity[0][0]) ?? 'Unknown team', countLabel: `${activity[0][1]} trades` })
  const quiet = [...activity].sort((a, b) => a[1] - b[1])[0]
  if (quiet) awards.push({ key: 'quiet', title: 'The quiet desk', subtitle: 'Fewest trades completed', winner: managers.get(quiet[0]) ?? 'Unknown team', countLabel: `${quiet[1]} trades` })
  if (zeroPair) awards.push({ key: 'frenemies', title: 'Frenemies', subtitle: 'Still waiting on their first deal', winner: zeroPair.map((id) => managers.get(id) ?? 'Unknown team').join(' & '), countLabel: '0 trades' })

  const byNet = [...mine].sort((a, b) => b.net - a.net)
  return {
    available: true,
    data: {
      trades: [...mine].reverse(),
      best: byNet[0],
      worst: byNet[byNet.length - 1],
      journey,
      finalValue: Math.round(cumulative),
      awards,
    },
  }
}

/**
 * Career trade grade for this league.
 *
 * ⚠ A LETTER NEVER SHIPS ALONE. `GRADE_THRESHOLDS` puts C across −40 to +40, so
 * a manager who has produced nothing at all lands mid-C — which means "C" and
 * "we have no data" are visually identical unless the absence is detected
 * separately. That is why this returns a `SectionState` and why `sample` is a
 * required field on the grade rather than an optional annotation.
 */
async function gradeTrades(
  leagueId: string,
  platformLeagueId: string | null,
  userId: string,
  lc: LeagueContext,
): Promise<SectionState<LeagueGrade>> {
  if (!platformLeagueId) {
    return {
      available: false,
      reason: 'this league has no platform id on file, and trade grades are keyed on it',
    }
  }

  /*
   * ⚠ READS THE CACHE, NEVER CALLS THE BUILDER. `getTradeGrades()` falls through
   * to the Sleeper API on a miss, and a provider call from a page render is
   * exactly what `scripts/check-db-first-api-boundary.mjs` exists to stop — it
   * also puts a multi-season scan on the critical path of a tab someone clicked.
   * The notifier and the trades surface populate this key; if they have not run
   * for this league, the honest answer is that it has not been graded yet.
   */
  const cached = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey: `${TRADE_GRADES_CACHE_PREFIX}${platformLeagueId}` } })
    .catch(() => null)

  const payload =
    cached?.data && typeof cached.data === 'object'
      ? (cached.data as unknown as {
          version?: number
          seasonsScanned?: string[]
          trades?: Array<{
            tie?: boolean
            sides?: Array<{ ownerId: string | null; cumulativeNet: number }>
          }>
        })
      : null

  if (!payload || payload.version !== 2 || !Array.isArray(payload.trades)) {
    return {
      available: false,
      reason:
        'this league’s trades have not been graded yet. Grading walks every season after each trade to see what the pieces actually did, and that pass has not run here.',
    }
  }

  // Which Sleeper owner is this user, in this league?
  const me = await lc.claimedTeam().catch(() => null)

  const ownerId = me?.platformUserId ?? null
  if (!ownerId) {
    return {
      available: false,
      reason: 'we cannot match your account to a manager in this league’s trade history',
    }
  }

  let net = 0
  let count = 0
  for (const t of payload.trades) {
    const side = (t.sides ?? []).find((sd) => sd.ownerId === ownerId)
    if (!side) continue
    count += 1
    net += side.cumulativeNet
  }

  if (count === 0) {
    /*
     * Graded league, no trades of yours in it. That is a real and rather
     * different fact from an ungraded league, and it is not a bad grade — it is
     * an absent one.
     */
    return {
      available: false,
      reason:
        'you have not made a trade in this league. There is nothing to grade, which is not the same as grading badly.',
    }
  }

  /*
   * ⚠ PER SEASON, NOT PER TRADE — the bands in `gradeScale.ts` are defined on
   * average net per season, and dividing by trade count instead would put the
   * same manager in a different band purely for trading more often.
   */
  const seasons = Math.max(1, payload.seasonsScanned?.length ?? 1)
  const avgPerSeason = net / seasons

  return {
    available: true,
    data: {
      letter: letterFor(avgPerSeason),
      value: avgPerSeason,
      sample: `${count} ${count === 1 ? 'trade' : 'trades'} across ${seasons} ${
        seasons === 1 ? 'season' : 'seasons'
      }`,
    },
  }
}

/**
 * Career waiver grade — claim value over the league's own median winning bid.
 *
 * ⚠ THE SCALE IS DELIBERATELY THE TRADE SCALE. A "B" on one card and a "B" on
 * the other sitting side by side have to mean comparable things, or the pair is
 * actively misleading. So the input is normalised to the same
 * average-net-per-season axis `letterFor` already bands, rather than inventing a
 * second set of cutoffs whose letters coincidentally share an alphabet.
 *
 * ⚠ AND IT IS MEASURED AGAINST THIS ROOM, NOT A NATIONAL AVERAGE. Spending $40
 * is shrewd in a league whose median winning bid is $12 and careless in one
 * where it is $90. The comparison only means anything inside one league's own
 * bidding history.
 */
async function gradeWaivers(leagueId: string, userId: string): Promise<SectionState<LeagueGrade>> {
  const settings = await prisma.leagueWaiverSettings
    .findUnique({ where: { leagueId }, select: { waiverType: true } })
    .catch(() => null)

  const kind = String(settings?.waiverType ?? '').toLowerCase()

  if (kind && kind !== 'faab') {
    /*
     * On a priority-order league there is no bid to compare. A claim either won
     * or it did not, and grading "spent nothing, got the player" against a
     * median of nothing is arithmetic on an empty concept.
     */
    return {
      available: false,
      reason:
        'this league does not run FAAB, so claims carry no bid to measure. A waiver grade compares what you paid against what the room pays, and there is no price here.',
    }
  }

  /*
   * ⚠ FAAB BID AMOUNTS ARE NOT STORED DURABLY ANYWHERE IN THIS REPO. The
   * imported-activity ingest records that a waiver happened — type, roster,
   * player — and drops the winning bid. Without the amounts there is no
   * distribution to take a median of and nothing to score a claim against.
   *
   * This is the honest state and it is stated rather than papered over with a
   * hit-rate that would render under the same letter and mean something else.
   */
  void userId
  return {
    available: false,
    reason:
      'winning FAAB bid amounts are not stored when waiver activity is ingested, so there is no bidding history to price your claims against. The scale is defined and waiting on the amounts.',
  }
}
