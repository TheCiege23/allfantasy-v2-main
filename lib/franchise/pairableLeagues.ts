/**
 * Which of a user's already-imported leagues could be halves of one franchise.
 *
 * 🛑 THE FEATURE EXISTED AND HAD NO WAY IN. `FranchiseLink` /
 * `FranchiseLeagueMember` model exactly this — two leagues, roles `pro` and
 * `college`, unique per league and per role — and `loadFranchiseDetail` already
 * renders both halves as one team. What was missing was any way to say "these
 * two are connected" about leagues that are ALREADY imported:
 *
 *   - `/api/legacy/franchise` `connect-league` hardcodes `role: 'college'` and
 *     `platform: 'fantrax'`, and IMPORTS a league from a Fantrax Secret ID. So a
 *     franchise could only ever acquire a college half, and only by importing it
 *     again. There was no action that attaches the PRO side at all.
 *   - Nothing in the app calls that route. Zero UI, on either half.
 *
 * So a user with a Sleeper dynasty league and a Fantrax college league already
 * imported — the ordinary case — had no route to pairing them, which is what
 * "give the user the opportunity to connect 2 leagues you don't know are
 * connected" is asking for.
 *
 * ⚠ THIS PROPOSES, IT NEVER PAIRS. Same rule `identityInference` already keeps
 * for managers: a wrong pairing shows someone another team's roster as their
 * own, so every candidate carries its reasoning and a human confirms. Nothing
 * here writes.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import type { FranchiseRole } from './franchiseLink'

export type PairableLeague = {
  /** `League.id` for a pro league, `FantraxLeague.id` for a college snapshot. */
  id: string
  platform: string
  name: string
  season: number | null
  /**
   * Which half this league would be.
   *
   * ⚠ INFERRED FROM THE SPORT, NOT FROM THE PLATFORM. Fantrax hosts NFL leagues
   * too — `importFantraxLeague` measures which player map names more of the
   * roster precisely because hardcoding CFB made every NFL Fantrax league look
   * empty. Reading "fantrax ⇒ college" here would repeat that mistake one layer
   * up, and would silently refuse to pair two Fantrax leagues.
   */
  role: FranchiseRole
  /** Why we think it is that half — shown to the user, never just applied. */
  roleReason: string
  /** Already part of a franchise; named so the UI can say which. */
  linkedTo: string | null
  /**
   * The franchise it is already part of, when there is one.
   *
   * ⚠ CARRIED SO PAIRING CAN MERGE INTO IT RATHER THAN BUILD A SECOND ONE. A
   * league already filed as the pro half of a half-built franchise must gain its
   * college side inside THAT link — creating a new one and re-parenting the
   * league would empty the first and leave an orphan named after it.
   */
  linkId: string | null
}

export type PairableLeagues = {
  pro: PairableLeague[]
  college: PairableLeague[]
  /** Leagues in a COMPLETE franchise, so the UI can say so instead of hiding them. */
  alreadyLinked: PairableLeague[]
}

const COLLEGE_SPORTS = new Set(['cfb', 'ncaaf', 'ncaafb', 'ncaab', 'ncaabb', 'college'])

function roleForSport(sport: string, isDevy: boolean): { role: FranchiseRole; reason: string } {
  const s = String(sport ?? '').trim().toLowerCase()
  if (COLLEGE_SPORTS.has(s)) return { role: 'college', reason: `sport is ${s.toUpperCase()}` }
  /*
   * ⚠ DEVY IS NOT THE SAME AS COLLEGE, and this is the one that is easy to get
   * wrong. A devy league is a PRO league that also rosters college prospects —
   * its scoring, matchups and championship are NFL. Filing it as the college
   * half would pair two pro leagues and call one of them college.
   */
  if (isDevy) return { role: 'pro', reason: 'devy league — rosters prospects but scores as a pro league' }
  return { role: 'pro', reason: s ? `sport is ${s.toUpperCase()}` : 'no college sport on file' }
}

/**
 * Every league the user could pair, split by which half it would be.
 *
 * ⚠ BOTH ID SPACES, BECAUSE `FranchiseLeagueMember.leagueId` HOLDS BOTH.
 * The schema says so in its own comment: "League.id for the pro side,
 * FantraxLeague.id for the college side." Reading only `League` would make every
 * Fantrax snapshot unpairable, and reading only ids without the platform would
 * let a `League.id` collide with a `FantraxLeague.id` in the membership check.
 */
export async function listPairableLeagues(ownerUserId: string): Promise<PairableLeagues> {
  const [leagues, fantrax, members] = await Promise.all([
    prisma.league.findMany({
      where: { userId: ownerUserId },
      select: { id: true, name: true, platform: true, season: true, sport: true, isDynasty: true, leagueType: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.fantraxLeague.findMany({
      where: { appUserId: ownerUserId },
      select: { id: true, leagueName: true, season: true, sport: true, isDevy: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.franchiseLeagueMember.findMany({
      where: { link: { ownerUserId } },
      select: { platform: true, leagueId: true, linkId: true, link: { select: { name: true } } },
    }),
  ])

  /* Keyed on (platform, leagueId) — the same pair the schema makes unique. */
  const linked = new Map(
    members.map((m) => [
      `${m.platform}:${m.leagueId}`,
      { name: m.link?.name ?? 'a franchise', linkId: m.linkId },
    ]),
  )

  /*
   * ⚠ A HALF-BUILT FRANCHISE IS THE CASE THIS SCREEN EXISTS FOR, and treating it
   * as "already connected" was a dead end. LeagueHome sends a one-sided league
   * here under "Add the other half"; if that same league is then filtered out of
   * its own list, the user cannot name the half they arrived to complete, and
   * the only leagues left to pick are two OTHER ones — which is how a pairing
   * attempt ends on "that league is already part of another franchise".
   *
   * So: a league in an INCOMPLETE franchise stays a candidate, carrying its
   * link id so pairing merges into that franchise. A league in a complete one is
   * reported as context, because re-pairing it would empty the franchise it is
   * in — the thing the uniqueness rule is protecting.
   */
  const memberCountByLink = new Map<string, number>()
  for (const m of members) memberCountByLink.set(m.linkId, (memberCountByLink.get(m.linkId) ?? 0) + 1)

  const out: PairableLeagues = { pro: [], college: [], alreadyLinked: [] }

  const push = (row: PairableLeague) => {
    const complete = row.linkId != null && (memberCountByLink.get(row.linkId) ?? 0) >= 2
    if (row.linkedTo && complete) out.alreadyLinked.push(row)
    else if (row.role === 'college') out.college.push(row)
    else out.pro.push(row)
  }

  for (const l of leagues) {
    const platform = String(l.platform ?? '').toLowerCase()
    const { role, reason } = roleForSport(String(l.sport ?? ''), false)
    const member = linked.get(`${platform}:${l.id}`) ?? null
    push({
      id: l.id,
      platform,
      name: l.name?.trim() || 'Untitled league',
      season: l.season ?? null,
      role,
      roleReason: reason,
      linkedTo: member?.name ?? null,
      linkId: member?.linkId ?? null,
    })
  }

  for (const f of fantrax) {
    const { role, reason } = roleForSport(String(f.sport ?? ''), Boolean(f.isDevy))
    const member = linked.get(`fantrax:${f.id}`) ?? null
    push({
      id: f.id,
      platform: 'fantrax',
      name: f.leagueName?.trim() || 'Untitled Fantrax league',
      season: f.season ?? null,
      role,
      roleReason: reason,
      linkedTo: member?.name ?? null,
      linkId: member?.linkId ?? null,
    })
  }

  return out
}

/**
 * ⚠ A FANTRAX LEAGUE CAN APPEAR TWICE AND THEY ARE NOT THE SAME ROW.
 *
 * Importing a Fantrax league writes BOTH a `FantraxLeague` snapshot AND a
 * `League` whose `platformLeagueId` is that snapshot's uuid. So the same real
 * league surfaces once from each query above, under two different ids, and a
 * user offered both would have no way to tell which to pick — worse, pairing the
 * `League` row and the `FantraxLeague` row to each other would "connect" a league
 * to itself and pass every uniqueness check in the schema.
 *
 * Collapsed to the snapshot id, because that is what `FranchiseLeagueMember`
 * stores for the college side and what `loadFranchiseDetail` reads back.
 */
export function collapseFantraxDuplicates(
  rows: PairableLeagues,
  leagueRows: Array<{ id: string; platform: string; platformLeagueId: string | null }>,
): PairableLeagues {
  const snapshotIdByLeagueId = new Map<string, string>()
  for (const l of leagueRows) {
    if (String(l.platform ?? '').toLowerCase() !== 'fantrax') continue
    if (l.platformLeagueId) snapshotIdByLeagueId.set(l.id, l.platformLeagueId)
  }
  if (snapshotIdByLeagueId.size === 0) return rows

  const drop = (list: PairableLeague[]) =>
    list.filter((r) => !(r.platform === 'fantrax' && snapshotIdByLeagueId.has(r.id)))

  return {
    pro: drop(rows.pro),
    college: drop(rows.college),
    alreadyLinked: drop(rows.alreadyLinked),
  }
}
