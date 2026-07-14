/**
 * Reusable NFL redraft season harness.
 *
 * Pure DB seed/drive/cleanup helpers shared by the engine-level E2E runner
 * (`scripts/run-nfl-full-season-engine-e2e.ts`) and the Playwright browser spec
 * (`e2e/nfl-full-season.spec.ts`). All seeded rows are isolated under a unique
 * `mark` and removed via cascade on `cleanupSeededLeague` so the harness is safe
 * to run against staging without touching unrelated data.
 *
 * The functions take a PrismaClient so the caller owns connection lifecycle and
 * env loading (`loadDotEnv` is provided for standalone scripts).
 */
import fs from 'node:fs'

// Loosely-typed Prisma to avoid a hard generated-client dependency in helpers.
type Db = any // eslint-disable-line @typescript-eslint/no-explicit-any

export function loadDotEnv(files: string[] = ['.env', '.env.local']): void {
  for (const f of files) {
    try {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
        if (m && !process.env[m[1]]) {
          let v = m[2].trim()
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
          process.env[m[1]] = v
        }
      }
    } catch {
      /* file may not exist */
    }
  }
}

export type SeededLeague = {
  mark: string
  userId: string
  leagueId: string
  seasonId: string
  homeRosterId: string
  awayRosterId: string
  /** PlayerWeeklyScore rows are not FK-cascaded — tracked here for cleanup. */
  seededPlayerScoreIds: string[]
  /** SportsGame rows are not FK-cascaded — tracked here for cleanup. */
  seededSportsGameIds: string[]
}

export type SeedOptions = {
  season?: number
  totalWeeks?: number
  playoffStartWeek?: number
  faab?: number
}

/** Seed an isolated NFL redraft league: user → league → active season → 2 rosters. */
export async function seedNflRedraftLeague(prisma: Db, opts: SeedOptions = {}): Promise<SeededLeague> {
  const mark = `E2E-NFL-${Date.now()}-${Math.floor(Math.random() * 1e4)}`
  const season = opts.season ?? 2025
  const faab = opts.faab ?? 100

  const user = await prisma.appUser.create({ data: { email: `${mark}@e2e.local`, username: mark } })
  const league = await prisma.league.create({
    data: { userId: user.id, platform: 'native', platformLeagueId: mark, name: mark, sport: 'NFL', season },
  })
  const seasonRow = await prisma.redraftSeason.create({
    data: {
      leagueId: league.id,
      sport: 'NFL',
      season,
      status: 'active',
      currentWeek: 1,
      totalWeeks: opts.totalWeeks ?? 14,
      playoffStartWeek: opts.playoffStartWeek ?? 12,
    },
  })
  const home = await prisma.redraftRoster.create({
    data: { seasonId: seasonRow.id, leagueId: league.id, ownerId: `${mark}-home`, ownerName: 'Home Manager', teamName: 'Home', faabBalance: faab },
  })
  const away = await prisma.redraftRoster.create({
    data: { seasonId: seasonRow.id, leagueId: league.id, ownerId: `${mark}-away`, ownerName: 'Away Manager', teamName: 'Away', faabBalance: faab },
  })

  return {
    mark,
    userId: user.id,
    leagueId: league.id,
    seasonId: seasonRow.id,
    homeRosterId: home.id,
    awayRosterId: away.id,
    seededPlayerScoreIds: [],
    seededSportsGameIds: [],
  }
}

/** Seed an NFL SportsGame (schedule row the lineup-lock engine reads). */
export async function seedSportsGame(
  prisma: Db,
  seeded: SeededLeague,
  g: { homeTeam: string; awayTeam: string; startTime: Date; week: number; season: number },
): Promise<string> {
  const externalId = `${seeded.mark}-${g.homeTeam}-${g.awayTeam}-w${g.week}`
  const row = await prisma.sportsGame.create({
    data: {
      sport: 'NFL',
      externalId,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      startTime: g.startTime,
      week: g.week,
      season: g.season,
      source: 'e2e',
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  })
  seeded.seededSportsGameIds.push(row.id)
  return row.id
}

export async function addRosterPlayer(
  prisma: Db,
  rosterId: string,
  p: { playerId: string; name: string; position: string; slotType: string },
): Promise<void> {
  await prisma.redraftRosterPlayer.create({
    data: { rosterId, playerId: p.playerId, playerName: p.name, position: p.position, sport: 'NFL', slotType: p.slotType },
  })
}

export async function seedWeeklyScore(
  prisma: Db,
  seeded: SeededLeague,
  s: { playerId: string; week: number; season: number; stats: Record<string, number>; finalized?: boolean },
): Promise<void> {
  await prisma.playerWeeklyScore.create({
    data: { playerId: s.playerId, sport: 'NFL', week: s.week, season: s.season, fantasyPts: 0, isFinalized: s.finalized ?? true, stats: s.stats },
  })
  seeded.seededPlayerScoreIds.push(s.playerId)
}

export async function seedMatchup(
  prisma: Db,
  m: { seasonId: string; leagueId: string; week: number; homeRosterId: string; awayRosterId: string },
): Promise<string> {
  const row = await prisma.redraftMatchup.create({
    data: { seasonId: m.seasonId, leagueId: m.leagueId, week: m.week, homeRosterId: m.homeRosterId, awayRosterId: m.awayRosterId, status: 'scheduled' },
  })
  return row.id
}

/** Advance the season's current week (what a week transition does). */
export async function advanceWeek(prisma: Db, seasonId: string, toWeek: number): Promise<void> {
  await prisma.redraftSeason.update({ where: { id: seasonId }, data: { currentWeek: toWeek } })
}

export async function seedWaiverClaim(
  prisma: Db,
  c: {
    seasonId: string
    leagueId: string
    rosterId: string
    addPlayerId: string
    addPlayerName: string
    dropPlayerId?: string
    dropPlayerName?: string
    bidAmount?: number
  },
): Promise<string> {
  const row = await prisma.redraftWaiverClaim.create({
    data: {
      seasonId: c.seasonId,
      leagueId: c.leagueId,
      rosterId: c.rosterId,
      addPlayerId: c.addPlayerId,
      addPlayerName: c.addPlayerName,
      dropPlayerId: c.dropPlayerId ?? null,
      dropPlayerName: c.dropPlayerName ?? null,
      bidAmount: c.bidAmount ?? null,
      status: 'pending',
    },
  })
  return row.id
}

export async function seedTradeProposal(
  prisma: Db,
  t: { id: string; leagueId: string; seasonId: string; proposerRosterId: string; receiverRosterId: string; vetoMode?: string },
): Promise<string> {
  await prisma.redraftTradeProposal.create({
    data: {
      id: t.id,
      leagueId: t.leagueId,
      seasonId: t.seasonId,
      proposerRosterId: t.proposerRosterId,
      receiverRosterId: t.receiverRosterId,
      status: 'pending',
      vetoMode: t.vetoMode ?? 'commissioner',
    },
  })
  return t.id
}

/**
 * Seed a minimal single-round championship bracket (bracket + round + one
 * championship matchup + seeds) so `advancePlayoffWinners` →
 * `finalizeRedraftSeasonChampion` can be exercised. Mirrors the persistence the
 * generate route writes, scoped to a 2-team final. Returns the championship
 * matchup id.
 */
export async function seedChampionshipBracket(
  prisma: Db,
  b: {
    seasonId: string
    leagueId: string
    homeRosterId: string
    awayRosterId: string
    homeScore: number
    awayScore: number
    week: number
  },
): Promise<string> {
  const rid = () => `${b.seasonId.slice(0, 8)}-${Math.random().toString(36).slice(2, 12)}`
  const bracket = await prisma.redraftPlayoffBracket.create({
    data: { seasonId: b.seasonId, structure: {}, status: 'active' },
  })
  // RedraftPlayoffSeed / Round / Matchup ids have no @default — provide explicitly.
  await prisma.redraftPlayoffSeed.createMany({
    data: [
      { id: rid(), seasonId: b.seasonId, rosterId: b.homeRosterId, seed: 1 },
      { id: rid(), seasonId: b.seasonId, rosterId: b.awayRosterId, seed: 2 },
    ],
  })
  const round = await prisma.redraftPlayoffRound.create({
    data: { id: rid(), seasonId: b.seasonId, bracketId: bracket.id, roundNumber: 1, status: 'active', roundName: 'Championship' },
  })
  const matchup = await prisma.redraftPlayoffMatchup.create({
    data: {
      id: rid(),
      seasonId: b.seasonId,
      roundId: round.id,
      matchupNumber: 1,
      homeRosterId: b.homeRosterId,
      awayRosterId: b.awayRosterId,
      homeSeed: 1,
      awaySeed: 2,
      homeScore: b.homeScore,
      awayScore: b.awayScore,
      status: 'in_progress',
      nextMatchupId: null,
      metadata: {},
    },
  })
  return matchup.id
}

/**
 * Cascade-clean everything seeded. Deleting the AppUser removes League →
 * season → rosters → players → matchups → claims → proposals → playoff rows.
 * PlayerWeeklyScore rows (no FK) are deleted explicitly.
 */
export async function cleanupSeededLeague(prisma: Db, seeded: SeededLeague): Promise<void> {
  try {
    await prisma.appUser.delete({ where: { id: seeded.userId } })
  } catch {
    /* may already be gone */
  }
  if (seeded.seededPlayerScoreIds.length > 0) {
    await prisma.playerWeeklyScore.deleteMany({ where: { playerId: { in: seeded.seededPlayerScoreIds } } }).catch(() => undefined)
    // DEF box-score ingestion writes player_game_log_cache for nfl:def ids; clean those too.
    await prisma.playerGameLogCache.deleteMany({ where: { playerId: { in: seeded.seededPlayerScoreIds } } }).catch(() => undefined)
  }
  if (seeded.seededSportsGameIds.length > 0) {
    await prisma.sportsGame.deleteMany({ where: { id: { in: seeded.seededSportsGameIds } } }).catch(() => undefined)
  }
}
