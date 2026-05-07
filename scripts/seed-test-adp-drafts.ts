/**
 * D.5-test — seed controlled test drafts for AI ADP validation.
 *
 * Creates N fake Leagues, each with a completed DraftSession (sessionKind='test')
 * and a realistic round-by-round set of DraftPick rows using real NFL player
 * names. The recompute script picks these up via `draftMode='test'` and ONLY
 * aggregates them when `--include-test` is passed — production AI ADP stays
 * untouched.
 *
 * USAGE
 *   npm run seed:test-adp-drafts                            # dry-run
 *   npm run seed:test-adp-drafts -- --apply                 # write 25 drafts
 *   npm run seed:test-adp-drafts -- --apply --drafts=50
 *   npm run seed:test-adp-drafts -- --cleanup --apply       # remove prior seeds
 *
 * Each pick carries `source='test_seed'` for belt-and-suspenders filtering at
 * the recompute layer (some queries may not have access to the DraftSession
 * row, e.g. if a session is partially mock and partially test).
 *
 * NOTE: Picks are deterministic given a (player ADP target, jitter seed). Two
 * runs with the same `--seed=N` argument produce identical drafts — useful for
 * reproducible test snapshots.
 */

/** server-only stub is loaded by scripts/_audit-preload.cjs (node --require). */

import { PrismaClient, type Prisma } from '@prisma/client'
import { normalizeAdpPosition } from '@/lib/adp/playerKey'

const prisma = new PrismaClient()

interface Args {
  apply: boolean
  json: boolean
  cleanup: boolean
  sport: string
  season: string
  leagueType: string
  draftType: string
  scoringFormat: string
  rosterFormat: string
  teamCount: number
  drafts: number
  rounds: number
  seed: number
  /** 'curated' uses the hardcoded NFL board; 'db' samples SportsPlayer for any sport. */
  playersSource: 'curated' | 'db'
  /** Cap on pool size when playersSource='db' or curated (used for `--players=N`). */
  players: number
  /**
   * 'test' (default) → sessionKind='test', source='test_seed', recompute writes draftMode='test'.
   *   Production resolver excludes these (it filters draftMode='real'), so they're invisible
   *   to the live draft room — safe for repeated reseeds in shared dev DBs.
   * 'real' → sessionKind='live', source='auto', recompute writes draftMode='real' so the
   *   resolver overlays them onto the live pool. Use for end-to-end QA across sports
   *   that don't yet have organic real drafts. Cleanup still finds them via the
   *   `AF Test ADP` league name prefix and `allfantasy_test_adp_seed` platform marker.
   */
  mode: 'test' | 'real'
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    apply: false,
    json: false,
    cleanup: false,
    sport: 'NFL',
    season: '2025',
    leagueType: 'redraft',
    draftType: 'snake',
    scoringFormat: 'ppr',
    rosterFormat: 'standard',
    teamCount: 12,
    drafts: 25,
    rounds: 12,
    seed: 1,
    // Will be defaulted below based on sport (db for non-NFL, curated for NFL).
    playersSource: 'curated',
    players: 50,
    mode: 'test',
  }
  for (const raw of argv) {
    if (raw === '--apply') out.apply = true
    else if (raw === '--json') out.json = true
    else if (raw === '--cleanup') out.cleanup = true
    else if (raw.startsWith('--sport=')) out.sport = raw.slice('--sport='.length).toUpperCase()
    else if (raw.startsWith('--season=')) out.season = raw.slice('--season='.length)
    else if (raw.startsWith('--league-type=')) out.leagueType = raw.slice('--league-type='.length)
    else if (raw.startsWith('--draft-type=')) out.draftType = raw.slice('--draft-type='.length)
    else if (raw.startsWith('--scoring=')) out.scoringFormat = raw.slice('--scoring='.length)
    else if (raw.startsWith('--roster=')) out.rosterFormat = raw.slice('--roster='.length)
    else if (raw.startsWith('--team-count=')) {
      const n = Number(raw.slice('--team-count='.length))
      if (Number.isFinite(n) && n > 0) out.teamCount = n
    } else if (raw.startsWith('--drafts=')) {
      const n = Number(raw.slice('--drafts='.length))
      if (Number.isFinite(n) && n > 0) out.drafts = n
    } else if (raw.startsWith('--rounds=')) {
      const n = Number(raw.slice('--rounds='.length))
      if (Number.isFinite(n) && n > 0) out.rounds = n
    } else if (raw.startsWith('--seed=')) {
      const n = Number(raw.slice('--seed='.length))
      if (Number.isFinite(n)) out.seed = n
    } else if (raw.startsWith('--players-source=')) {
      const v = raw.slice('--players-source='.length).toLowerCase()
      if (v === 'curated' || v === 'db') out.playersSource = v
    } else if (raw.startsWith('--players=')) {
      const n = Number(raw.slice('--players='.length))
      if (Number.isFinite(n) && n > 0) out.players = n
    } else if (raw.startsWith('--mode=')) {
      const v = raw.slice('--mode='.length).toLowerCase()
      if (v === 'real' || v === 'test') out.mode = v
    }
  }
  // Default playersSource: curated for NFL (preserves existing behavior), db for other sports.
  // The existing curated board is NFL-only; non-NFL sports must read from SportsPlayer.
  const explicitlySetSource = argv.some((a) => a.startsWith('--players-source='))
  if (!explicitlySetSource) {
    out.playersSource = out.sport === 'NFL' ? 'curated' : 'db'
  }
  return out
}

/**
 * Realistic 2025 NFL ADP-target board — ordered by approximate redraft PPR
 * consensus. The seed script uses each player's index as their target overall
 * pick and adds gaussian-style jitter so the resulting draft volume produces
 * believable AI ADP numbers (not perfect 1.01s).
 */
const TARGET_ADP_BOARD: ReadonlyArray<{ name: string; position: string; team: string }> = [
  { name: 'Saquon Barkley', position: 'RB', team: 'PHI' },
  { name: 'Bijan Robinson', position: 'RB', team: 'ATL' },
  { name: "Ja'Marr Chase", position: 'WR', team: 'CIN' },
  { name: 'Jahmyr Gibbs', position: 'RB', team: 'DET' },
  { name: 'Justin Jefferson', position: 'WR', team: 'MIN' },
  { name: 'Christian McCaffrey', position: 'RB', team: 'SF' },
  { name: 'CeeDee Lamb', position: 'WR', team: 'DAL' },
  { name: 'Ashton Jeanty', position: 'RB', team: 'LV' },
  { name: 'Josh Jacobs', position: 'RB', team: 'GB' },
  { name: 'Bucky Irving', position: 'RB', team: 'TB' },
  { name: 'Kyren Williams', position: 'RB', team: 'LAR' },
  { name: 'Malik Nabers', position: 'WR', team: 'NYG' },
  { name: 'Nico Collins', position: 'WR', team: 'HOU' },
  { name: 'Brian Thomas Jr.', position: 'WR', team: 'JAX' },
  { name: 'Lamar Jackson', position: 'QB', team: 'BAL' },
  { name: 'Puka Nacua', position: 'WR', team: 'LAR' },
  { name: "De'Von Achane", position: 'RB', team: 'MIA' },
  { name: 'Drake London', position: 'WR', team: 'ATL' },
  { name: 'A.J. Brown', position: 'WR', team: 'PHI' },
  { name: 'Chase Brown', position: 'RB', team: 'CIN' },
  { name: 'Josh Allen', position: 'QB', team: 'BUF' },
  { name: 'James Cook', position: 'RB', team: 'BUF' },
  { name: 'Joe Burrow', position: 'QB', team: 'CIN' },
  { name: 'Jayden Daniels', position: 'QB', team: 'WAS' },
  { name: 'Amon-Ra St. Brown', position: 'WR', team: 'DET' },
  { name: 'Tee Higgins', position: 'WR', team: 'CIN' },
  { name: 'Mike Evans', position: 'WR', team: 'TB' },
  { name: 'Davante Adams', position: 'WR', team: 'LAR' },
  { name: 'James Conner', position: 'RB', team: 'ARI' },
  { name: 'Patrick Mahomes', position: 'QB', team: 'KC' },
  { name: 'Trey McBride', position: 'TE', team: 'ARI' },
  { name: 'Sam LaPorta', position: 'TE', team: 'DET' },
  { name: 'George Kittle', position: 'TE', team: 'SF' },
  { name: 'Travis Kelce', position: 'TE', team: 'KC' },
  { name: 'Brock Purdy', position: 'QB', team: 'SF' },
  { name: 'Jalen Hurts', position: 'QB', team: 'PHI' },
  { name: 'Aaron Jones Sr.', position: 'RB', team: 'MIN' },
  { name: 'Calvin Ridley', position: 'WR', team: 'TEN' },
  { name: 'Tony Pollard', position: 'RB', team: 'TEN' },
  { name: 'David Montgomery', position: 'RB', team: 'HOU' },
  { name: 'Zay Flowers', position: 'WR', team: 'BAL' },
  { name: 'Rome Odunze', position: 'WR', team: 'CHI' },
  { name: 'Tetairoa McMillan', position: 'WR', team: 'CAR' },
  { name: 'Xavier Worthy', position: 'WR', team: 'KC' },
  { name: 'Courtland Sutton', position: 'WR', team: 'DEN' },
  { name: 'TreVeyon Henderson', position: 'RB', team: 'NE' },
  { name: 'Dak Prescott', position: 'QB', team: 'DAL' },
  { name: 'Caleb Williams', position: 'QB', team: 'CHI' },
  { name: 'Jared Goff', position: 'QB', team: 'DET' },
  { name: 'Daniel Jones', position: 'QB', team: 'IND' },
  { name: 'Justin Herbert', position: 'QB', team: 'LAC' },
]

/** Mulberry32 — small deterministic PRNG so --seed produces reproducible drafts. */
function makePrng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Symmetric jitter around 0 — used to perturb a player's "true" ADP target. */
function jitter(rng: () => number, magnitude: number): number {
  return (rng() * 2 - 1) * magnitude
}

interface SeedSummary {
  mode: 'dry-run' | 'apply' | 'cleanup'
  args: Args
  contextHashPreview: string
  draftsRequested: number
  draftsCreated: number
  picksCreated: number
  cleanupLeaguesDeleted: number
  cleanupSessionsDeleted: number
  cleanupPicksDeleted: number
  sampleDrafts: Array<{
    leagueId: string
    sessionId: string
    pickCount: number
    headPicks: Array<{ overall: number; player: string; pos: string }>
  }>
  errors: string[]
}

const TEST_LEAGUE_NAME_PREFIX = 'AF Test ADP'
const TEST_USER_ID = 'af-test-adp-seed-user'

/**
 * Per-sport `League.starters` payloads. The resolver short-circuits with
 * `rosterConfigurationIncomplete: true` when `hasPersistedRosterSchema` is false,
 * which happens when this column is null/empty. Seeding a sport-appropriate
 * non-empty array satisfies `detectPersistedRosterSchema` so the resolver
 * proceeds to build the full pool and apply the AI ADP overlay.
 *
 * Slot keys follow the canonical short codes used by each sport's slot map
 * (NFL/NBA/MLB/NHL/NCAAF/NCAAB/SOCCER under lib/<sport>-roster/).
 */
const STARTERS_BY_SPORT: Record<string, string[]> = {
  NFL: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DST'],
  NBA: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'],
  MLB: ['C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'SP', 'RP', 'UTIL'],
  NHL: ['C', 'C', 'LW', 'RW', 'D', 'D', 'G', 'UTIL'],
  NCAAF: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DST'],
  NCAAB: ['G', 'G', 'F', 'F', 'C', 'UTIL'],
  SOCCER: ['GK', 'DEF', 'DEF', 'MID', 'MID', 'FWD', 'FWD', 'UTIL'],
}
function startersForSport(sport: string): string[] {
  return STARTERS_BY_SPORT[sport] ?? STARTERS_BY_SPORT.NFL
}

/**
 * Canonical short-code positions the seed should restrict to per sport.
 *
 * The resolver applies its own pool eligibility filter based on the league's
 * starter-eligible positions; if seeded picks live on positions outside that
 * set (e.g., NCAAF defensive positions when the league is offense-only), the
 * resolver excludes them BEFORE the ADP overlay runs and `aiAdp` shows 0.
 *
 * Values are matched against `normalizeAdpPosition(rawPosition)` from
 * @/lib/adp/playerKey, which canonicalizes provider drift (full forms,
 * mixed casing, etc.). For SOCCER, this also defends against sport-tag
 * contamination in `SportsPlayer` (rows incorrectly tagged sport=SOCCER
 * with baseball positions like "1B"/"OF").
 */
const ELIGIBLE_POSITIONS_BY_SPORT: Record<string, string[]> = {
  NFL: ['qb', 'rb', 'wr', 'te', 'k', 'dst', 'def'],
  NCAAF: ['qb', 'rb', 'wr', 'te', 'k', 'dst', 'def'],
  NBA: ['pg', 'sg', 'sf', 'pf', 'c', 'g', 'f'],
  NCAAB: ['pg', 'sg', 'sf', 'pf', 'c', 'g', 'f'],
  MLB: ['c', '1b', '2b', '3b', 'ss', 'of', 'sp', 'rp', 'p', 'lf', 'cf', 'rf'],
  NHL: ['c', 'lw', 'rw', 'd', 'g'],
  SOCCER: ['gk', 'd', 'mid', 'f', 'fwd', 'def'],
}
const TEST_USER_EMAIL = 'af-test-adp-seed@allfantasy.test'
const TEST_USER_USERNAME = 'af_test_adp_seed'

/** Ensure the synthetic AppUser exists so League/DraftSession FKs hold. Idempotent. */
async function ensureTestUser(): Promise<void> {
  await prisma.appUser.upsert({
    where: { id: TEST_USER_ID },
    update: {},
    create: {
      id: TEST_USER_ID,
      email: TEST_USER_EMAIL,
      username: TEST_USER_USERNAME,
      displayName: 'AF Test ADP Seed',
    },
  })
}

async function cleanup(report: SeedSummary): Promise<void> {
  const leagues = await prisma.league.findMany({
    where: { userId: TEST_USER_ID, name: { startsWith: TEST_LEAGUE_NAME_PREFIX } },
    select: { id: true },
  })
  if (!leagues.length) return
  const leagueIds = leagues.map((l) => l.id)
  const sessions = await prisma.draftSession.findMany({
    where: { leagueId: { in: leagueIds } },
    select: { id: true },
  })
  const sessionIds = sessions.map((s) => s.id)
  if (sessionIds.length) {
    const picks = await prisma.draftPick.deleteMany({ where: { sessionId: { in: sessionIds } } })
    report.cleanupPicksDeleted += picks.count
  }
  const sess = await prisma.draftSession.deleteMany({ where: { leagueId: { in: leagueIds } } })
  report.cleanupSessionsDeleted += sess.count
  const lg = await prisma.league.deleteMany({ where: { id: { in: leagueIds } } })
  report.cleanupLeaguesDeleted += lg.count
}

interface PoolEntry {
  name: string
  position: string
  team: string
  /** Target overall pick — the index in TARGET_ADP_BOARD plus 1. */
  target: number
}

function generateDraftPicks(
  rng: () => number,
  pool: readonly PoolEntry[],
  totalPicks: number,
  teamCount: number,
): Array<{ overall: number; player: PoolEntry; round: number; roundPick: number; slot: number }> {
  // Build a soft-ordered draft: each player gets a "score" of (target + jitter).
  // Sort by score, then assign overall picks in ascending order.
  const mag = 4 // jitter magnitude — produces realistic spread without scrambling tiers
  const scored = pool.slice(0, Math.max(totalPicks, pool.length)).map((p) => ({
    ...p,
    score: p.target + jitter(rng, mag),
  }))
  scored.sort((a, b) => a.score - b.score)
  // Take the top `totalPicks` entries; ignore overflow players.
  const taken = scored.slice(0, totalPicks)
  return taken.map((p, idx) => {
    const overall = idx + 1
    const round = Math.floor((overall - 1) / teamCount) + 1
    const roundPick = ((overall - 1) % teamCount) + 1
    // Snake slot: even rounds reverse direction.
    const slot = round % 2 === 1 ? roundPick : teamCount - roundPick + 1
    return { overall, player: p, round, roundPick, slot }
  })
}

/**
 * Build the player pool for a draft.
 *
 * - 'curated': hardcoded NFL TARGET_ADP_BOARD (existing behavior).
 * - 'db': sample real `SportsPlayer` rows for the requested sport, filtered to
 *   draftable shape (team set, not 'FA', position present). Position is run
 *   through the shared canonical helper so seeded picks recompute into keys
 *   the resolver can read.
 *
 * Cached per (sport, source, players) — re-used across drafts in a single run.
 */
const __dbPoolCache = new Map<string, PoolEntry[]>()
async function buildPoolForArgs(args: Args): Promise<PoolEntry[]> {
  if (args.playersSource === 'curated') {
    return TARGET_ADP_BOARD.slice(0, args.players).map((p, i) => ({ ...p, target: i + 1 }))
  }
  const cacheKey = `${args.sport}|db|${args.players}`
  const cached = __dbPoolCache.get(cacheKey)
  if (cached) return cached
  // Pull a wider slice and filter in JS. Prisma's `not: null` chain is finicky with
  // nullable strings, and 5000 candidate rows is plenty to land --players draftable
  // entries even on sports with mixed-quality ingestion.
  const rawRows = await prisma.sportsPlayer.findMany({
    where: { sport: { equals: args.sport, mode: 'insensitive' } },
    take: 5000,
    orderBy: [{ name: 'asc' }],
    select: { name: true, position: true, team: true },
  })
  const eligible = ELIGIBLE_POSITIONS_BY_SPORT[args.sport] ?? null
  const seen = new Set<string>()
  const rows: typeof rawRows = []
  for (const r of rawRows) {
    const team = (r.team ?? '').trim()
    const rawPos = (r.position ?? '').trim()
    const name = (r.name ?? '').trim()
    if (!team || !rawPos || !name) continue
    if (team === 'FA' || team.toUpperCase() === 'FA') continue
    // Restrict to positions the resolver will actually accept. Without this we seed
    // picks on positions like "1B"/"OL"/"DB" that the league's starter template
    // excludes — they get filtered out before the ADP overlay and aiAdp shows 0.
    const canonical = normalizeAdpPosition(rawPos)
    if (eligible && !eligible.includes(canonical)) continue
    const key = `${name.toLowerCase()}|${canonical}|${team.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ name, position: rawPos, team })
    if (rows.length >= args.players) break
  }
  const pool = rows
    .filter((r) => r.name && r.position && r.team)
    .map((r, i) => ({
      name: r.name as string,
      // Canonicalize at seed time: the recompute writer + resolver share this shape.
      position: normalizeAdpPosition(r.position as string).toUpperCase() || (r.position as string),
      team: r.team as string,
      target: i + 1,
    }))
  __dbPoolCache.set(cacheKey, pool)
  return pool
}

async function applyOneDraft(
  args: Args,
  draftIndex: number,
  rng: () => number,
  report: SeedSummary,
): Promise<void> {
  const pool: PoolEntry[] = await buildPoolForArgs(args)
  if (pool.length === 0) {
    report.errors.push(`draft ${draftIndex + 1}: empty player pool for sport=${args.sport} source=${args.playersSource}`)
    return
  }
  const totalPicks = Math.min(args.teamCount * args.rounds, pool.length)
  const picks = generateDraftPicks(rng, pool, totalPicks, args.teamCount)

  const leagueName = `${TEST_LEAGUE_NAME_PREFIX} #${String(draftIndex + 1).padStart(3, '0')}`
  const now = new Date()

  if (!args.apply) {
    report.draftsCreated++
    report.picksCreated += picks.length
    if (report.sampleDrafts.length < 3) {
      report.sampleDrafts.push({
        leagueId: '(would create)',
        sessionId: '(would create)',
        pickCount: picks.length,
        headPicks: picks.slice(0, 5).map((p) => ({
          overall: p.overall,
          player: p.player.name,
          pos: p.player.position,
        })),
      })
    }
    return
  }

  // Real write path — create League + DraftSession + DraftPick rows in one transaction.
  await prisma.$transaction(async (tx) => {
    const league = await tx.league.create({
      data: {
        userId: TEST_USER_ID,
        platform: 'allfantasy_test_adp_seed',
        // Sport-scoped so seeding multiple sports doesn't collide on the
        // (userId, platform, platformLeagueId, season) unique constraint.
        platformLeagueId: `af-test-adp-${args.sport.toLowerCase()}-${draftIndex + 1}`,
        name: leagueName,
        // Per-sport seeding: League.sport must reflect the actual sport so the recompute
        // context hash matches what the resolver computes for that league. Previously this
        // was hardcoded to 'NFL' which silently broke seeding for every other sport.
        sport: args.sport as Prisma.LeagueCreateInput['sport'],
        season: Number(args.season) || new Date().getUTCFullYear(),
        scoring: args.scoringFormat,
        leagueSize: args.teamCount,
        isDynasty: args.leagueType === 'dynasty',
        leagueVariant: args.leagueType,
        // Non-empty per-sport starters satisfy detectPersistedRosterSchema so the
        // resolver does not short-circuit with rosterConfigurationIncomplete=true.
        starters: startersForSport(args.sport) as Prisma.InputJsonValue,
        // Marker so cleanup can find these without ambiguity.
      },
    })

    const session = await tx.draftSession.create({
      data: {
        leagueId: league.id,
        status: 'completed',
        draftType: args.draftType,
        rounds: args.rounds,
        teamCount: args.teamCount,
        // sessionKind drives `deriveDraftMode`. 'test' → snapshots written as draftMode='test'
        // (resolver excludes them); 'live' → draftMode='real' (resolver includes them, used
        // for end-to-end QA). League name + platform marker still flag these as seeded.
        sessionKind: args.mode === 'real' ? 'live' : 'test',
        sportType: args.sport,
        startedAt: now,
        completedAt: now,
        nextOverallPick: picks.length + 1,
        currentRoundNum: args.rounds,
      },
    })

    const pickRows: Prisma.DraftPickCreateManyInput[] = picks.map((p) => ({
      sessionId: session.id,
      overall: p.overall,
      round: p.round,
      slot: p.slot,
      roundPick: p.roundPick,
      rosterId: `seed-roster-${p.slot}`,
      displayName: `Seed Manager ${p.slot}`,
      playerName: p.player.name,
      position: p.player.position,
      team: p.player.team,
      playerId: `name:${p.player.name}:${p.player.position}:${p.player.team}`,
      assetType: 'player',
      // Pick-level mode marker: 'test_seed' is also caught by deriveDraftMode → 'test'.
      // Use 'auto' for --mode=real so the recompute classifies these picks as 'real'.
      source: args.mode === 'real' ? 'auto' : 'test_seed',
      sportType: args.sport,
      pickedAt: new Date(now.getTime() - (picks.length - p.overall) * 30_000),
    }))
    await tx.draftPick.createMany({ data: pickRows })

    if (report.sampleDrafts.length < 3) {
      report.sampleDrafts.push({
        leagueId: league.id,
        sessionId: session.id,
        pickCount: pickRows.length,
        headPicks: picks.slice(0, 5).map((p) => ({
          overall: p.overall,
          player: p.player.name,
          pos: p.player.position,
        })),
      })
    }
  })
  report.draftsCreated++
  report.picksCreated += picks.length
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const report: SeedSummary = {
    mode: args.cleanup ? 'cleanup' : args.apply ? 'apply' : 'dry-run',
    args,
    // Lazy import to keep the constants module pure for tests.
    contextHashPreview: '(see output)',
    draftsRequested: args.drafts,
    draftsCreated: 0,
    picksCreated: 0,
    cleanupLeaguesDeleted: 0,
    cleanupSessionsDeleted: 0,
    cleanupPicksDeleted: 0,
    sampleDrafts: [],
    errors: [],
  }

  try {
    const { buildContextHash } = await import('../lib/adp/computeAllFantasyAdp')
    report.contextHashPreview = buildContextHash({
      sport: args.sport,
      leagueType: args.leagueType,
      draftType: args.draftType,
      scoringFormat: args.scoringFormat,
      rosterFormat: args.rosterFormat,
      teamCount: args.teamCount,
      season: args.season,
    })

    if (args.cleanup) {
      if (!args.apply) {
        const leagues = await prisma.league.findMany({
          where: { userId: TEST_USER_ID, name: { startsWith: TEST_LEAGUE_NAME_PREFIX } },
          select: { id: true },
        })
        report.cleanupLeaguesDeleted = leagues.length
      } else {
        await cleanup(report)
      }
    } else {
      if (args.apply) await ensureTestUser()
      const rng = makePrng(args.seed)
      for (let i = 0; i < args.drafts; i++) {
        try {
          await applyOneDraft(args, i, rng, report)
        } catch (err) {
          report.errors.push(`draft ${i + 1}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  } catch (err) {
    report.errors.push(err instanceof Error ? err.message : String(err))
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log('────────────────────────────────────────────────────────')
    console.log(' D.5-test — Seed AI ADP test drafts')
    console.log('────────────────────────────────────────────────────────')
    console.log(` Mode:                ${report.mode}`)
    console.log(` Sport / Season:      ${args.sport} / ${args.season}`)
    console.log(` Context:             ${args.leagueType} ${args.draftType} ${args.scoringFormat} ${args.rosterFormat} (${args.teamCount}-team)`)
    console.log(` Context hash:        ${report.contextHashPreview}`)
    if (args.cleanup) {
      console.log('')
      console.log(` Leagues found:       ${report.cleanupLeaguesDeleted}${args.apply ? '' : ' (would delete)'}`)
      if (args.apply) {
        console.log(` Sessions deleted:    ${report.cleanupSessionsDeleted}`)
        console.log(` Picks deleted:       ${report.cleanupPicksDeleted}`)
      }
    } else {
      console.log(` Drafts requested:    ${report.draftsRequested}`)
      console.log(` Drafts created:      ${report.draftsCreated}${args.apply ? '' : ' (would create)'}`)
      console.log(` Picks total:         ${report.picksCreated}`)
      if (report.sampleDrafts.length) {
        console.log('')
        console.log(' Sample drafts (first 3):')
        for (const s of report.sampleDrafts) {
          console.log(`   • league=${s.leagueId.slice(0, 8)}  session=${s.sessionId.slice(0, 8)}  picks=${s.pickCount}`)
          for (const h of s.headPicks) {
            console.log(`       ${String(h.overall).padStart(3)}. ${h.player.padEnd(24)} ${h.pos}`)
          }
        }
      }
    }
    if (report.errors.length) {
      console.log('')
      console.log(` Errors (${report.errors.length}):`)
      for (const e of report.errors.slice(0, 5)) console.log(`   ! ${e}`)
    }
    if (!args.apply && !args.cleanup) {
      console.log('')
      console.log(' [dry-run] Re-run with --apply to write to the database.')
    } else if (!args.apply && args.cleanup) {
      console.log('')
      console.log(' [dry-run cleanup] Re-run with --cleanup --apply to actually delete.')
    }
    console.log('────────────────────────────────────────────────────────')
  }

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('[seed-test-adp-drafts] failed:', err)
  await prisma.$disconnect()
  process.exit(1)
})
