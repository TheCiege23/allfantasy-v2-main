/**
 * Why a starter (or, in best ball, any counted player) still has NO stat row when his week is about
 * to be sealed — and whether a 0 for him is TRUE or a feed gap wearing a 0's clothes.
 *
 * 🛑 THE FINALIZER USED TO SEAL EVERY MISSING PLAYER AT 0 ONCE COVERAGE CLEARED 80%. In a lineup league
 * that is a handful of starters; in BEST BALL the whole roster counts, so up to a fifth of a team with a
 * real feed gap was scored 0 permanently — and a Guilly chop runs on the sealed week, so a team could be
 * eliminated on a box score we never ingested. Coverage is a LEAGUE-WIDE ratio: it cannot see that the
 * 20% it forgives is one whole game.
 *
 * THE RULE. A missing player may be sealed at 0 only when there is evidence he did not play:
 *
 *   did_not_play      his team played, its game(s) in the week are final, and the feed HAS stat lines
 *                     for that team (another player of the same team holds a real, non-empty row this
 *                     week; daily sports: per Eastern day, via `loadDailyWindowParticipation`)  -> 0
 *   no_game           week-keyed sports (NFL, NCAAF): his team is not on the week's slate — a bye -> 0
 *   inactive          daily sports: his identity is `INACT`                                       -> 0
 *   game_box_missing  his team played and the game is final, but the feed holds NO stat line for
 *                     that team's game                                                    -> DO NOT SEAL
 *   game_not_final    daily sports: a game of his team in the window is not final yet     -> DO NOT SEAL
 *   unplaced          no team on his roster row (a free agent, an Exile pick), or a team the slate
 *                     cannot place. Nothing can be proved either way, so the pre-existing tolerance
 *                     stands (the 80% coverage floor still bounds it) — but he is REPORTED, never
 *                     silently folded into the zeros.
 *
 * ⚠ "ANOTHER PLAYER OF THE SAME TEAM" IS THE WHOLE TRICK, AND TWO KINDS OF ROW ARE NOT EVIDENCE:
 *   - an EMPTY row (`stats: {}`) is what this finalizer itself writes for a sealed non-appearance, and
 *     what the NCAAF/daily syncs write for a verified zero — counting it would let one zero vouch for
 *     the next;
 *   - a TEAM DEFENSE row: its points-allowed is derived from the final SCORE in `SportsGame`, not from
 *     a box score, so it exists the moment the game is final whether or not any box line arrived.
 *
 * Teammates are found through `RedraftRosterPlayer.team` across every roster (not only this league),
 * spelled as this league's rows spell it, and matched on the lineup lock's team keys
 * (`lockTeamLookupKeys`) — the same keys `buildWeekKickoffMap` places the slate under, so the lock, the
 * seal and this check cannot disagree about which team played.
 */
import type { PrismaClient } from '@prisma/client'
import { isTeamDefenseRow, teamAbbrevFromDefPlayerId } from '@/lib/scoring-runtime/nflStatNormalization'
import { buildWeekKickoffMap, lockTeamLookupKeys, type WeekKickoffs } from './lineupLock'
import { DAILY_NO_ROW_VERDICT_SPORTS, loadDailyWindowParticipation, type DailyNoRowVerdict } from './dailySportParticipation'

export type MissingStatVerdict =
  | 'did_not_play'
  | 'no_game'
  | 'inactive'
  | 'game_box_missing'
  | 'game_not_final'
  | 'unplaced'

/** Verdicts that mean the feed is missing data: the week must not seal (and a chop must not run). */
export const MISSING_STAT_BLOCKING_VERDICTS: ReadonlySet<MissingStatVerdict> = new Set(['game_box_missing', 'game_not_final'])

/** Bound on the teammate lookup; a week-keyed team has ~50 players, a full league slate a few thousand. */
const TEAMMATE_CAP = 6000

export type MissingStatPlayer = {
  playerId: string
  sport: string
  /** The roster row's team, as this league spells it. Null when the row carries none. */
  team: string | null
  position?: string | null
}

export type MissingStatClassification = {
  /** Keyed `${sport}::${playerId}`, as the finalizer keys its starters. */
  verdicts: Map<string, MissingStatVerdict>
  /** Teams (as spelled on the roster rows) whose game the feed is missing or has not finished. */
  gapTeams: string[]
}

type EvidenceDb = Pick<PrismaClient, 'redraftRosterPlayer' | 'playerWeeklyScore' | 'sportsGame'> &
  Partial<Pick<PrismaClient, 'playerIdentityMap' | 'playerGameStat' | 'sportsDataCache'>>

const keyOf = (p: { sport: string; playerId: string }) => `${p.sport}::${p.playerId}`

/** A real box line: a non-empty stat object. `{}` is a sealed (or verified) zero and proves nothing. */
export function isRealStatLine(stats: unknown): boolean {
  return !!stats && typeof stats === 'object' && !Array.isArray(stats) && Object.keys(stats as object).length > 0
}

function teamOf(p: MissingStatPlayer): string | null {
  const fromDef = teamAbbrevFromDefPlayerId(p.playerId)
  if (fromDef) return fromDef
  const t = String(p.team ?? '').trim()
  return t ? t : null
}

function mapDailyVerdict(v: DailyNoRowVerdict): MissingStatVerdict | null {
  switch (v) {
    case 'inactive':
      return 'inactive'
    case 'no_stat':
      return 'did_not_play'
    case 'not_ingested':
      return 'game_box_missing'
    case 'pending':
      return 'game_not_final'
    default:
      // no_games / unmatched / no_identity: the daily check cannot tell — fall through to the team check.
      return null
  }
}

export async function classifyMissingStatPlayers(
  db: EvidenceDb,
  args: {
    /** LeagueSport ("NFL", "NCAAF", "NBA", ...). */
    sport: string
    season: number
    week: number
    dateWindow?: { start: Date; end: Date } | null
    missing: readonly MissingStatPlayer[]
    /** Injectable for tests; defaults to the lineup lock's own schedule read. */
    kickoffs?: WeekKickoffs
    now?: Date
  },
): Promise<MissingStatClassification> {
  const verdicts = new Map<string, MissingStatVerdict>()
  const gapTeams = new Set<string>()
  if (args.missing.length === 0) return { verdicts, gapTeams: [] }
  const sport = args.sport.toUpperCase()
  const weekKeyed = sport === 'NFL' || sport === 'NCAAF'

  const undecided: MissingStatPlayer[] = []
  for (const p of args.missing) {
    if (!teamOf(p)) verdicts.set(keyOf(p), 'unplaced')
    else undecided.push(p)
  }

  // Daily sports first: the per-day participation check the weekly sync already writes zeros from.
  if (undecided.length > 0 && args.dateWindow && DAILY_NO_ROW_VERDICT_SPORTS.includes(sport) && db.playerIdentityMap && db.playerGameStat) {
    try {
      const sportKeys = [...new Set([sport, ...undecided.map((p) => p.sport.toUpperCase())])]
      const verdictFor = await loadDailyWindowParticipation(db as never, {
        sport,
        sportKeys,
        season: args.season,
        week: args.week,
        window: args.dateWindow,
        identityIds: undecided.map((p) => p.playerId),
        now: args.now,
      })
      for (let i = undecided.length - 1; i >= 0; i--) {
        const p = undecided[i]!
        const v = mapDailyVerdict(verdictFor(p.playerId))
        if (!v) continue
        verdicts.set(keyOf(p), v)
        if (MISSING_STAT_BLOCKING_VERDICTS.has(v)) gapTeams.add(teamOf(p)!)
        undecided.splice(i, 1)
      }
    } catch {
      // The daily read failed: the team check below still runs, so nothing is zeroed on a guess.
    }
  }
  if (undecided.length === 0) return { verdicts, gapTeams: [...gapTeams] }

  const kickoffs = args.kickoffs ?? (await buildWeekKickoffMap(db as never, { sport, season: args.season, week: args.week }))
  const hasGame = (team: string) => lockTeamLookupKeys(sport, team).some((k) => kickoffs.byTeam.has(k))

  const needEvidence = new Map<string, MissingStatPlayer[]>()
  for (const p of undecided) {
    const team = teamOf(p)!
    if (!hasGame(team)) {
      // A week-keyed team off the slate is on a bye. A daily team with no game in seven days is far more
      // likely a name the schedule did not match (dailySportParticipation.ts) — not provable either way.
      verdicts.set(keyOf(p), weekKeyed ? 'no_game' : 'unplaced')
      continue
    }
    needEvidence.set(team, [...(needEvidence.get(team) ?? []), p])
  }
  if (needEvidence.size === 0) return { verdicts, gapTeams: [...gapTeams] }

  // Teammates, as this league's rows spell the team (plus the bare club code a defence id carries).
  const missingIds = new Set(args.missing.map((p) => p.playerId))
  const sports = [...new Set(args.missing.map((p) => p.sport))]
  const teammates = (await db.redraftRosterPlayer.findMany({
    where: { sport: { in: sports }, team: { in: [...needEvidence.keys()] } },
    select: { playerId: true, team: true, position: true },
    distinct: ['playerId'],
    take: TEAMMATE_CAP,
  })) as Array<{ playerId: string; team: string | null; position: string | null }>
  const witnesses = teammates.filter((t) => !missingIds.has(t.playerId) && !isTeamDefenseRow(t.playerId, t.position))
  const evidenced = new Set<string>()
  if (witnesses.length > 0) {
    const rows = (await db.playerWeeklyScore.findMany({
      where: { week: args.week, season: args.season, sport: { in: sports }, playerId: { in: witnesses.map((w) => w.playerId) } },
      select: { playerId: true, stats: true },
    })) as Array<{ playerId: string; stats: unknown }>
    const real = new Set(rows.filter((r) => isRealStatLine(r.stats)).map((r) => r.playerId))
    for (const w of witnesses) {
      if (!real.has(w.playerId)) continue
      for (const k of lockTeamLookupKeys(sport, w.team)) evidenced.add(k)
    }
  }

  for (const [team, players] of needEvidence) {
    const covered = lockTeamLookupKeys(sport, team).some((k) => evidenced.has(k))
    for (const p of players) verdicts.set(keyOf(p), covered ? 'did_not_play' : 'game_box_missing')
    if (!covered) gapTeams.add(team)
  }
  return { verdicts, gapTeams: [...gapTeams] }
}
