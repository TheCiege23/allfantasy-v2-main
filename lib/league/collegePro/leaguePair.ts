import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolvePairedHalf, type PairedHalf } from '@/lib/core-app/leaguePairing'
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { COLLEGE_PRO_TEAM_MAP_KEY } from './headToHead'
import { confidentTeamMatches, effectiveTeamMap, readTeamMap, type FantraxTeam, type SleeperTeam } from './teamMatch'

/**
 * A college + pro pair that belongs to the LEAGUE, so every manager sees one league.
 *
 * WHY. `FranchiseLink` is owned by one user (`resolvePairedHalf` filters on `ownerUserId`), so when the
 * commissioner linked Peach Bowl to Cream Bowl only the commissioner saw one league. Every other
 * manager saw two unrelated leagues until they linked the halves themselves — which they could not do
 * without a team in both. Owner direction 2026-11-22: the two leagues must feel like one league for
 * everyone, with nothing to set up.
 *
 * WHAT IS STORED. `League.settings.collegeProPair` on BOTH halves:
 * `{ role, otherLeagueId, linkedByUserId, linkedAt }`. It is AF-owned (lib/league/afOwnedLeagueSettings.ts),
 * so a re-import keeps it. `linkedByUserId` names whose `FranchiseLink` holds the pair's data (the
 * Fantrax snapshot ids live on its members), so a viewer's page is that link, described for them.
 *
 * WHO EACH VIEWER IS, in each half — never by guessing a person from a name across platforms:
 *  1. the team they claimed in that half (`LeagueTeam.claimedByUserId`);
 *  2. else the other half's claimed team, through the team map (`effectiveTeamMap`: the commissioner's
 *     saved choices, then the unambiguous automatic matches).
 * Inside one league a claimed team is tied to the platform's own team by NAME, which is safe because a
 * league's team names are its own and unique: a Fantrax `LeagueTeam.externalId` is the import's id, not
 * Fantrax's, so the name is the only key the two share.
 */

export const COLLEGE_PRO_PAIR_KEY = 'collegeProPair'

export type LeaguePairRecord = {
  role: 'pro' | 'college'
  otherLeagueId: string
  linkedByUserId: string
  linkedAt: string
}

export function readLeaguePair(settings: unknown): LeaguePairRecord | null {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[COLLEGE_PRO_PAIR_KEY] : null
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!r) return null
  const role = r.role === 'pro' || r.role === 'college' ? r.role : null
  const otherLeagueId = typeof r.otherLeagueId === 'string' && r.otherLeagueId ? r.otherLeagueId : null
  const linkedByUserId = typeof r.linkedByUserId === 'string' && r.linkedByUserId ? r.linkedByUserId : null
  if (!role || !otherLeagueId || !linkedByUserId) return null
  return { role, otherLeagueId, linkedByUserId, linkedAt: typeof r.linkedAt === 'string' ? r.linkedAt : '' }
}

/**
 * May this user make a pair the league's? The head commissioner of the pro half, or the user who
 * imported (owns) both halves' League rows — which is who links an imported pair today.
 */
export async function canRecordLeaguePair(proLeagueId: string, collegeLeagueId: string, userId: string): Promise<boolean> {
  const owned = await prisma.league
    .count({ where: { id: { in: [proLeagueId, collegeLeagueId] }, userId } })
    .catch(() => 0)
  if (owned === 2) return true
  return canCommissionerAct(proLeagueId, userId, 'head').catch(() => false)
}

/** Write the pair onto both halves. Idempotent: an identical pair is not rewritten. */
export async function recordLeaguePair(args: {
  proLeagueId: string
  collegeLeagueId: string
  linkedByUserId: string
  now?: Date
}): Promise<'recorded' | 'unchanged' | 'refused'> {
  if (args.proLeagueId === args.collegeLeagueId) return 'refused'
  if (!(await canRecordLeaguePair(args.proLeagueId, args.collegeLeagueId, args.linkedByUserId))) return 'refused'
  const rows = await prisma.league.findMany({
    where: { id: { in: [args.proLeagueId, args.collegeLeagueId] } },
    select: { id: true, settings: true },
  })
  if (rows.length !== 2) return 'refused'
  const linkedAt = (args.now ?? new Date()).toISOString()
  let changed = false
  for (const row of rows) {
    const role: LeaguePairRecord['role'] = row.id === args.proLeagueId ? 'pro' : 'college'
    const otherLeagueId = role === 'pro' ? args.collegeLeagueId : args.proLeagueId
    const current = readLeaguePair(row.settings)
    if (current && current.role === role && current.otherLeagueId === otherLeagueId && current.linkedByUserId === args.linkedByUserId) continue
    const settings = row.settings && typeof row.settings === 'object' ? (row.settings as Record<string, unknown>) : {}
    await prisma.league.update({
      where: { id: row.id },
      data: { settings: { ...settings, [COLLEGE_PRO_PAIR_KEY]: { role, otherLeagueId, linkedByUserId: args.linkedByUserId, linkedAt } } as never },
    })
    changed = true
  }
  return changed ? 'recorded' : 'unchanged'
}

type HalfRow = { id: string; platform: string | null; platformLeagueId: string | null; settings: unknown }

export type PairTeamRecord = { wins: number; losses: number; ties: number; pointsFor: number | null }
export type PairTeam = { key: string; name: string; ownerName: string | null; record: PairTeamRecord | null }
type PairTeams = { keyed: PairTeam[]; byLeagueTeamName: Map<string, string> }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const recordOf = (w: unknown, l: unknown, t: unknown, pf: unknown): PairTeamRecord | null =>
  num(w) == null && num(l) == null ? null : { wins: num(w) ?? 0, losses: num(l) ?? 0, ties: num(t) ?? 0, pointsFor: num(pf) }

/**
 * A half's teams as the team map keys them — Sleeper roster ids, or Fantrax team ids from its
 * snapshot — with each team's record: a Sleeper team's from its `LeagueTeam` row, a Fantrax team's
 * from the snapshot's standings.
 */
async function teamsOf(half: HalfRow): Promise<PairTeams> {
  const platform = String(half.platform ?? '').toLowerCase()
  const lower = (v: string) => v.trim().toLowerCase()
  if (platform === 'fantrax' && half.platformLeagueId) {
    const snap = await prisma.fantraxLeague.findUnique({ where: { id: half.platformLeagueId }, select: { standings: true } }).catch(() => null)
    const keyed = (Array.isArray(snap?.standings) ? (snap!.standings as Array<Record<string, unknown>>) : [])
      .filter((t) => typeof t.team === 'string' && typeof t.fantraxTeamId === 'string')
      .map((t) => ({
        key: t.fantraxTeamId as string,
        name: (t.team as string).trim(),
        ownerName: null,
        record: recordOf(t.wins, t.losses, t.ties, t.pointsFor),
      }))
    return { keyed, byLeagueTeamName: new Map(keyed.map((t) => [lower(t.name), t.key])) }
  }
  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId: half.id },
    select: { externalId: true, teamName: true, ownerName: true, wins: true, losses: true, ties: true, pointsFor: true },
  })
  const keyed = teams.map((t) => ({
    key: t.externalId,
    name: (t.teamName ?? '').trim(),
    ownerName: t.ownerName ?? null,
    record: recordOf(t.wins, t.losses, t.ties, t.pointsFor),
  }))
  return { keyed, byLeagueTeamName: new Map(keyed.filter((t) => t.name).map((t) => [lower(t.name), t.key])) }
}

/**
 * The pair's team map, strongest evidence first:
 *  1. the commissioner's saved choices;
 *  2. the SAME AllFantasy user's claimed team in each half — one person, two teams, no names involved;
 *  3. unambiguous name matches (`confidentTeamMatches`).
 * A later source never takes a team an earlier one already placed.
 */
function pairTeamMap(
  pro: HalfRow,
  proTeams: PairTeams,
  collegeTeams: PairTeams,
  sameUser: Record<string, string>,
): { map: Record<string, string>; auto: string[] } {
  const sleeper: SleeperTeam[] = proTeams.keyed.map((t) => ({ rosterId: t.key, teamName: t.name || null, ownerName: t.ownerName }))
  const fantrax: FantraxTeam[] = collegeTeams.keyed.map((t) => ({ teamId: t.key, name: t.name }))
  const saved = readTeamMap((pro.settings as Record<string, unknown> | null)?.[COLLEGE_PRO_TEAM_MAP_KEY])
  const withClaims = effectiveTeamMap(saved, sameUser)
  const map = effectiveTeamMap(withClaims, confidentTeamMatches(sleeper, fantrax, withClaims))
  return { map, auto: Object.keys(map).filter((k) => !(k in saved)) }
}

/** Pro key -> college key for every AllFantasy user who claimed a team in both halves. */
function sameUserPairs(
  claims: ReadonlyArray<{ leagueId: string; teamName: string | null; externalId: string; claimedByUserId: string | null }>,
  keyOf: (claim: { leagueId: string; teamName: string | null; externalId: string }) => string | null,
  proId: string,
  collegeId: string,
): Record<string, string> {
  const byUser = new Map<string, { pro?: string | null; college?: string | null }>()
  for (const c of claims) {
    if (!c.claimedByUserId) continue
    const entry = byUser.get(c.claimedByUserId) ?? {}
    if (c.leagueId === proId) entry.pro = keyOf(c)
    if (c.leagueId === collegeId) entry.college = keyOf(c)
    byUser.set(c.claimedByUserId, entry)
  }
  const out: Record<string, string> = {}
  const used = new Set<string>()
  for (const { pro, college } of byUser.values()) {
    if (!pro || !college || pro in out || used.has(college)) continue
    out[pro] = college
    used.add(college)
  }
  return out
}

export type PairContext = {
  pair: LeaguePairRecord
  pro: HalfRow
  college: HalfRow
  proTeams: PairTeam[]
  collegeTeams: PairTeam[]
  /** Pro team key -> college team key: saved choices, then unambiguous automatic matches. */
  map: Record<string, string>
  /** Pro team keys matched automatically rather than saved by the commissioner. */
  auto: string[]
  /** The viewer's team key in each half, or null when unknown. */
  proKey: string | null
  collegeKey: string | null
}

/**
 * Everything a one-league view needs about a league-wide pair, from the stored rows alone: both
 * halves, their teams and records, the team map, and which team in each half is the viewer's (their
 * claim, else the other half's claim through the map). Null when the league is in no recorded pair.
 */
export async function loadPairContext(leagueId: string, userId: string): Promise<PairContext | null> {
  const viewed = await prisma.league.findUnique({ where: { id: leagueId }, select: { id: true, platform: true, platformLeagueId: true, settings: true } })
  const pair = viewed ? readLeaguePair(viewed.settings) : null
  if (!viewed || !pair) return null
  const other = await prisma.league.findUnique({ where: { id: pair.otherLeagueId }, select: { id: true, platform: true, platformLeagueId: true, settings: true } })
  if (!other) return null
  const pro = pair.role === 'pro' ? viewed : other
  const college = pair.role === 'pro' ? other : viewed
  const [proTeams, collegeTeams, allClaims] = await Promise.all([
    teamsOf(pro),
    teamsOf(college),
    prisma.leagueTeam.findMany({
      where: { leagueId: { in: [pro.id, college.id] }, claimedByUserId: { not: null } },
      select: { leagueId: true, teamName: true, externalId: true, claimedByUserId: true },
    }),
  ])
  // A claimed row to its half's team key. Sleeper keys ARE the claimed row's externalId; a Fantrax
  // claim reaches its team by name, which is unique inside its own league.
  const keyOf = (claim: { leagueId: string; teamName: string | null; externalId: string }) => {
    const half = claim.leagueId === pro.id ? pro : college
    const teams = claim.leagueId === pro.id ? proTeams : collegeTeams
    if (String(half.platform ?? '').toLowerCase() !== 'fantrax') return claim.externalId
    return teams.byLeagueTeamName.get((claim.teamName ?? '').trim().toLowerCase()) ?? null
  }
  const { map, auto } = pairTeamMap(pro, proTeams, collegeTeams, sameUserPairs(allClaims, keyOf, pro.id, college.id))
  const mine = (half: HalfRow) => {
    const claim = allClaims.find((c) => c.leagueId === half.id && c.claimedByUserId === userId)
    return claim ? keyOf(claim) : null
  }
  let proKey = mine(pro)
  let collegeKey = mine(college)
  if (proKey && !collegeKey) collegeKey = map[proKey] ?? null
  if (collegeKey && !proKey) proKey = Object.entries(map).find(([, c]) => c === collegeKey)?.[0] ?? null
  return { pair, pro, college, proTeams: proTeams.keyed, collegeTeams: collegeTeams.keyed, map, auto, proKey, collegeKey }
}

/**
 * The pair as THIS viewer sees it: their own link if they made one, else the league's pair described
 * with their teams. Null when the league is in no pair the viewer can see.
 */
export async function resolveCollegeProPair(
  leagueId: string,
  userId: string,
  opts: { includeOperationalSummary?: boolean } = {},
): Promise<PairedHalf | null> {
  const own = await resolvePairedHalf(leagueId, userId, opts).catch(() => null)
  if (own) {
    await healLeaguePair(own, userId).catch(() => undefined)
    return own
  }
  const ctx = await loadPairContext(leagueId, userId)
  if (!ctx || ctx.pair.linkedByUserId === userId) return null
  if (!ctx.proKey && !ctx.collegeKey) return null // not a member of either half

  const nameOf = (teams: PairTeam[], key: string | null) => (key ? teams.find((t) => t.key === key)?.name ?? null : null)
  const teamFor = (member: { role: string; platform: string }) => {
    const isPro = member.role === 'pro'
    const fantrax = String(member.platform ?? '').toLowerCase() === 'fantrax'
    const key = isPro ? ctx.proKey : ctx.collegeKey
    // A Fantrax side picks its team by NAME; a League side by the team's externalId (the key itself).
    return fantrax ? nameOf(isPro ? ctx.proTeams : ctx.collegeTeams, key) : key
  }
  return resolvePairedHalf(leagueId, ctx.pair.linkedByUserId, { ...opts, viewer: { userId, teamFor } }).catch(() => null)
}

/**
 * A pair made before pairs were league-wide lives only on its owner's link. When that owner may make
 * it the league's, do so quietly, so existing pairs (Peach Bowl / Cream Bowl, Road To Glory) reach
 * every manager without anyone linking again.
 */
async function healLeaguePair(own: PairedHalf, userId: string): Promise<void> {
  const pro = own.sides.find((s) => s.role === 'pro')?.leagueId
  const college = own.sides.find((s) => s.role === 'college')?.leagueId
  if (!pro || !college) return
  const row = await prisma.league.findUnique({ where: { id: pro }, select: { settings: true } })
  const current = row ? readLeaguePair(row.settings) : null
  if (current?.otherLeagueId === college) return
  await recordLeaguePair({ proLeagueId: pro, collegeLeagueId: college, linkedByUserId: userId })
}
