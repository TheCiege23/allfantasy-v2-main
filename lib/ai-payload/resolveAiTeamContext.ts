import { findRosterForTeam } from '@/lib/leagues/rosterForTeam'
import 'server-only'

import { prisma } from '@/lib/prisma'
import { sleeperIdWhere } from '@/lib/player-identity/externalIdNamespace'
import { selectAuthoritativePlayerRow } from '@/lib/player-match/authoritativePlayerRow'
import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { loadEspnToSleeperMap, rosterIdSpaceOf } from '@/lib/core-app/rosterIdSpace'
import { bridgeColumnFor, loadBridgedLeagues } from '@/lib/core-app/bridgedRosterIds'
import { resolveRosterPlayerIdentities } from '@/lib/player-identity/resolveRosterPlayerIdentities'
import type { AiRosterPlayerRef, AiTeamContextPayload } from '@/lib/ai-payload/types'

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  return null
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) {
    if (typeof x === 'string' && x.trim()) out.push(x.trim())
  }
  return out
}

/**
 * Parses Sleeper-style `playerData` JSON for starters / reserve / taxi.
 */
function bucketPlayerIds(playerData: unknown): {
  starters: string[]
  reserve: string[]
  taxi: string[]
  allIds: string[]
} {
  const allIds = getRosterPlayerIds(playerData)
  const pd = asRecord(playerData) ?? {}
  const starters = stringList(pd.starters)
  const reserve = stringList(pd.reserve ?? pd.reserve_list)
  const taxi = stringList(pd.taxi ?? pd.taxi_list)
  return { starters, reserve, taxi, allIds }
}

function benchIds(allIds: string[], starters: string[], reserve: string[], taxi: string[]): string[] {
  const used = new Set([...starters, ...reserve, ...taxi])
  return allIds.filter((id) => !used.has(id))
}

/**
 * Roster player id → name/position/team/injury, from `sportsPlayerRecord`, then `sportsPlayer`.
 *
 * Exported so the Chimmy trade and lineup scenarios name a whole league's rosters through the SAME
 * lookup that names the viewer's own — `limit` is the only thing that differs (one roster vs. all of
 * them). Every id up to `limit` is looked up; none is dropped by a row cap.
 */
export async function resolveNames(
  sport: SupportedSport,
  ids: string[],
  limit = 80,
): Promise<Map<string, { name: string | null; position: string | null; team: string | null; injury: string | null }>> {
  const uniq = [...new Set(ids)].filter(Boolean).slice(0, limit)
  const out = new Map<string, { name: string | null; position: string | null; team: string | null; injury: string | null }>()
  if (uniq.length === 0) return out

  const rows = await prisma.sportsPlayerRecord.findMany({
    where: {
      sport,
      id: { in: uniq },
    },
    select: {
      id: true,
      name: true,
      position: true,
      team: true,
      injuryStatus: true,
    },
  })

  for (const r of rows) {
    out.set(r.id, {
      name: r.name,
      position: r.position,
      team: r.team,
      injury: r.injuryStatus,
    })
  }

  const missing = uniq.filter((id) => !out.has(id))
  if (missing.length === 0) return out

  /*
   * ── 🛑 THE FALLBACK USED TO LOSE A LEAGUE AND NAME STRANGERS ─────────────────────────────────
   *
   * It was one read — `externalId IN missing OR sleeperId IN missing`, `take: 120` — and it wrote
   * every row under BOTH keys. Two defects, measured on staging 2026-09-17 in a real 12-team Sleeper
   * league (192 rostered ids), where a rostered Adam Thielen came back "not on any roster":
   *
   *   1. THE CAP. The Chimmy trade and lineup scenarios name a whole league here (`limit` 800). The
   *      first pass rarely matches a roster id — `SportsPlayerRecord.id` is written `${sport}:${raw}` —
   *      so nearly every id lands here, and 120 rows cannot hold a league.
   *   2. THE ID SPACES. A bare Sleeper id matched against `externalId` reaches a Rolling Insights row
   *      for somebody else: 42,031 of the 42,032 bare numbers that are also a Sleeper id are a
   *      different person (`lib/player-identity/externalIdNamespace.ts`). Writing that row under its
   *      own `externalId` as well also filled keys nobody asked for.
   *
   * So, in order, and only ever under a key that was asked for:
   *   - the SLEEPER space, through `sleeperIdWhere` (the `sleeperId` column and the `sleeper:`
   *     spelling), freshest row first;
   *   - the PROVIDER space, only for ids whose format names their namespace (`tsdb_…`, slugs). A bare
   *     number the Sleeper space did not claim stays UNNAMED: across the provider spaces it is not
   *     weak evidence, it is none, and an unnamed player is honest where a stranger's name is not.
   */
  const asked = new Set(missing)
  const put = (key: string | null | undefined, r: { name: string; position: string | null; team: string | null; status: string | null }) => {
    if (!key || !asked.has(key) || out.has(key)) return
    out.set(key, { name: r.name, position: r.position, team: r.team, injury: r.status })
  }
  const playerSelect = {
    externalId: true,
    sleeperId: true,
    name: true,
    position: true,
    team: true,
    status: true,
    source: true,
    fetchedAt: true,
  } as const

  const bySleeper = await prisma.sportsPlayer.findMany({
    where: sleeperIdWhere(missing, sport),
    orderBy: { fetchedAt: 'desc' },
    select: playerSelect,
  })
  /*
   * 🛑 NOT THE FRESHEST ROW — THE SLEEPER ROW (2026-10-12). Every source stamps the same
   * `sleeperId`, and TheSportsDB's rows got theirs by NAME, so "freshest wins" handed Chimmy
   * whichever feed ran last: a rostered E.J. Jenkins (TE, PHI, 11304) was described to the model
   * as "Elgton Jenkins, G, Cleveland Browns". `selectAuthoritativePlayerRow` keeps the Sleeper
   * row's identity and ignores a row that contradicts it (`lib/player-match/authoritativePlayerRow.ts`).
   * A row still answers to either spelling it was reached by, and only under a key that was asked.
   */
  const rowsByAsked = new Map<string, typeof bySleeper>()
  for (const r of bySleeper) {
    const spelled = r.externalId.startsWith(SLEEPER_EXTERNAL_PREFIX)
      ? r.externalId.slice(SLEEPER_EXTERNAL_PREFIX.length)
      : null
    for (const key of new Set([r.sleeperId, spelled])) {
      if (!key || !asked.has(key)) continue
      const bucket = rowsByAsked.get(key)
      if (bucket) bucket.push(r)
      else rowsByAsked.set(key, [r])
    }
  }
  for (const [key, rows] of rowsByAsked) {
    const picked = selectAuthoritativePlayerRow(rows)?.row
    if (picked) put(key, picked)
  }

  const namespaced = missing.filter((id) => !out.has(id) && !BARE_NUMBER.test(id))
  if (namespaced.length > 0) {
    const byProvider = await prisma.sportsPlayer.findMany({
      // externalid-audited: bare numbers are filtered out above; a self-describing token names its own space
      where: { sport, externalId: { in: namespaced } },
      orderBy: { fetchedAt: 'desc' },
      select: playerSelect,
    })
    for (const r of byProvider) put(r.externalId, r)
  }

  return out
}

const SLEEPER_EXTERNAL_PREFIX = 'sleeper:'
/** A bare number is written by three provider sources and by Sleeper; its shape names no namespace. */
const BARE_NUMBER = /^\d+$/

function toRefs(ids: string[], nameMap: Map<string, { name: string | null; position: string | null; team: string | null; injury: string | null }>): AiRosterPlayerRef[] {
  return ids.map((playerId) => {
    const m = nameMap.get(playerId)
    return {
      playerId,
      name: m?.name ?? null,
      position: m?.position ?? null,
      team: m?.team ?? null,
      injuryStatus: m?.injury ?? null,
    }
  })
}

const PLATFORM_LABEL: Record<string, string> = {
  espn: 'ESPN',
  mfl: 'MFL',
  fleaflicker: 'Fleaflicker',
  fantrax: 'Fantrax',
  yahoo: 'Yahoo',
}

function platformLabel(platform: string | null | undefined): string {
  const p = String(platform ?? '').trim().toLowerCase()
  return PLATFORM_LABEL[p] ?? (p ? p.charAt(0).toUpperCase() + p.slice(1) : 'this platform')
}

/**
 * A provider id that is NOT a Sleeper id gets its platform's prefix, so nothing downstream that
 * looks ids up in Sleeper's space (kickoff checks, injury joins, projections) can ever read it as
 * whichever Sleeper player shares the number.
 */
function namespacedId(platform: string | null | undefined, rawId: string): string {
  return rawId === '0' ? '0' : `${String(platform ?? 'provider').trim().toLowerCase() || 'provider'}:${rawId}`
}

function unnamedRef(platform: string | null | undefined, rawId: string): AiRosterPlayerRef {
  return { playerId: namespacedId(platform, rawId), name: null, position: null, team: null, injuryStatus: null }
}

/**
 * A non-Sleeper roster's ids → refs, keyed by the RAW roster id.
 *
 *   1. An id with a specific translation to a Sleeper id — ESPN's identity map, or the
 *      Fleaflicker / MFL bridge for NFL (`bridgedRosterIds.ts`) — becomes that Sleeper id and gets
 *      the full lookup, injury status included.
 *   2. Every other id is NAMED through `resolveRosterPlayerIdentities` (Fantrax through the player
 *      registry, the rest through provider identity rows), under a platform-prefixed id. A name
 *      and position, never a guessed Sleeper identity.
 *   3. What could not be done is said in `gaps`, with counts, because a roster that is partly read
 *      looks complete to a model unless it is told otherwise.
 *
 * ⚠ The bridge's 80% "readable" rule decides whether a MISS can be trusted as "not on this
 * roster" (the Player Finder's question). Here each translation is one-to-one and is used per id,
 * so it applies at any coverage; the untranslated rest is named, not dropped.
 */
async function foreignRosterRefs(args: {
  platform: string | null | undefined
  sport: SupportedSport
  leagueId: string
  rawIds: string[]
}): Promise<{ refs: Map<string, AiRosterPlayerRef>; gaps: string[] }> {
  const refs = new Map<string, AiRosterPlayerRef>()
  const gaps: string[] = []
  const ids = [...new Set(args.rawIds)].filter((id) => id && id !== '0')
  if (ids.length === 0) return { refs, gaps }
  const label = platformLabel(args.platform)

  let toSleeper = new Map<string, string>()
  try {
    if (rosterIdSpaceOf(args.platform) === 'espn') {
      toSleeper = await loadEspnToSleeperMap(ids)
    } else if (bridgeColumnFor(args.platform) && args.sport === 'NFL') {
      const bridged = await loadBridgedLeagues([{ id: args.leagueId, platform: args.platform }])
      toSleeper = new Map(bridged.get(args.leagueId)?.map ?? [])
    }
  } catch {
    toSleeper = new Map()
  }

  const translated = ids.filter((id) => toSleeper.has(id))
  const sleeperNames = translated.length
    ? await resolveNames(args.sport, translated.map((id) => toSleeper.get(id)!), 200).catch(() => new Map())
    : new Map()
  for (const id of translated) {
    const sid = toSleeper.get(id)!
    const m = sleeperNames.get(sid)
    refs.set(id, { playerId: sid, name: m?.name ?? null, position: m?.position ?? null, team: m?.team ?? null, injuryStatus: m?.injury ?? null })
  }

  // Translated but unnamed by the Sleeper lookup, plus everything untranslated: name what we can.
  const toName = ids.filter((id) => !refs.get(id)?.name)
  const identities = toName.length
    ? await resolveRosterPlayerIdentities(args.platform, args.sport, toName).catch(() => new Map())
    : new Map()
  let namedFromProvider = 0
  for (const id of toName) {
    const hit = identities.get(id)
    const existing = refs.get(id)
    if (existing) {
      if (hit?.name) refs.set(id, { ...existing, name: hit.name, position: existing.position ?? hit.position ?? null, team: existing.team ?? hit.team ?? null })
      continue
    }
    if (!hit?.name) continue
    namedFromProvider += 1
    refs.set(id, { playerId: namespacedId(args.platform, id), name: hit.name, position: hit.position ?? null, team: hit.team ?? null, injuryStatus: null })
  }

  const unnamed = ids.filter((id) => !refs.get(id)?.name).length
  if (namedFromProvider > 0) {
    gaps.push(
      `${namedFromProvider} of ${ids.length} players are named from ${label}'s own player ids — their injury status and projections are not on file here`,
    )
  }
  if (unnamed > 0) {
    gaps.push(`${unnamed} of ${ids.length} players on this ${label} roster could not be identified`)
  }
  return { refs, gaps }
}

/**
 * Real roster + record + standings slice for the user's team in a league.
 */
export async function resolveAiTeamContext(args: {
  userId: string
  leagueId: string
  sport: string
  season: number
  currentPeriod: number
  teamExternalId?: string | null
}): Promise<AiTeamContextPayload | null> {
  const sport = normalizeToSupportedSport(String(args.sport))

  let leagueTeam = await prisma.leagueTeam.findFirst({
    where: { leagueId: args.leagueId, claimedByUserId: args.userId },
    select: {
      id: true,
      teamName: true,
      platformUserId: true,
      wins: true,
      losses: true,
      ties: true,
      pointsFor: true,
      currentRank: true,
      league: { select: { platform: true } },
    },
  })

  if (args.teamExternalId?.trim()) {
    const lt = await prisma.leagueTeam.findFirst({
      where: { leagueId: args.leagueId, externalId: args.teamExternalId.trim() },
      select: {
        id: true,
        teamName: true,
        platformUserId: true,
        wins: true,
        losses: true,
        ties: true,
        pointsFor: true,
        currentRank: true,
        league: { select: { platform: true } },
      },
    })
    if (lt) leagueTeam = lt
  }

  if (!leagueTeam) {
    return null
  }

  /*
   * ⚠ Contract-aware. The old OR keyed on LeagueTeam.platformUserId, which is
   * the RAW Sleeper id, while Roster.platformUserId holds the AF id for a LINKED
   * manager — so it resolved the signed-in user by luck (their AF id is the
   * second branch) and missed every OTHER manager with an account. See
   * lib/leagues/rosterForTeam.ts.
   */
  const byTeam = leagueTeam.platformUserId
    ? await findRosterForTeam(args.leagueId, leagueTeam.platformUserId)
    : null
  const roster = byTeam
    ? { playerData: byTeam.playerData as any, platformUserId: leagueTeam.platformUserId }
    : await prisma.roster.findFirst({
        where: { leagueId: args.leagueId, platformUserId: args.userId },
        select: { playerData: true, platformUserId: true },
      })

  if (!roster) {
    return {
      schemaVersion: 1,
      teamId: leagueTeam.id,
      teamName: leagueTeam.teamName,
      platformUserId: leagueTeam.platformUserId ?? args.userId,
      record: {
        wins: leagueTeam.wins,
        losses: leagueTeam.losses,
        ties: leagueTeam.ties,
      },
      standingRank: leagueTeam.currentRank ?? null,
      pointsFor: leagueTeam.pointsFor,
      rosterPlayerCount: 0,
      starters: [],
      bench: [],
      injuredReserve: [],
      taxi: [],
      opponentThisPeriod: null,
      dataGaps: ['No roster row synced for this team — player list unavailable.'],
    }
  }

  const platform = leagueTeam.league?.platform
  const { starters, reserve, taxi, allIds } = bucketPlayerIds(roster.playerData)
  const bench = benchIds(allIds, starters, reserve, taxi)
  const dataGaps: string[] = []
  if (allIds.length === 0) dataGaps.push('Roster playerData has no player IDs yet.')

  /*
   * 🛑 A NON-SLEEPER ROSTER USED TO CONTRIBUTE NO PLAYERS AT ALL (Fleaflicker, MFL, Fantrax, Yahoo),
   * or silently lose every ESPN id the map could not place — so Chimmy reported "player list
   * unavailable", or a roster quietly missing a fifth of its players, and advised on it anyway.
   * Measured 2026-10-11: ESPN 1,231 of 1,477 roster ids translate; Fleaflicker 222 of 253; Fantrax
   * 465 of 466 carry a registry id. The ids are never read raw as Sleeper ids (a raw Fleaflicker or
   * ESPN number names a stranger) — see `foreignRosterRefs`.
   */
  const space = rosterIdSpaceOf(platform)
  let refsFor: (ids: string[]) => AiRosterPlayerRef[]
  if (space === 'sleeper') {
    const nameMap = await resolveNames(sport, [...starters, ...bench, ...reserve, ...taxi])
    refsFor = (ids) => toRefs(ids, nameMap)
  } else {
    const foreign = await foreignRosterRefs({ platform, sport, leagueId: args.leagueId, rawIds: allIds })
    refsFor = (ids) => ids.map((id) => foreign.refs.get(id) ?? unnamedRef(platform, id))
    dataGaps.push(...foreign.gaps)
  }

  let opponentThisPeriod: AiTeamContextPayload['opponentThisPeriod'] = null
  try {
    const perf = await prisma.teamPerformance.findUnique({
      where: {
        teamId_season_week: {
          teamId: leagueTeam.id,
          season: args.season,
          week: args.currentPeriod,
        },
      },
      select: { opponent: true, week: true },
    })
    if (perf?.opponent) {
      opponentThisPeriod = { label: perf.opponent, week: perf.week ?? args.currentPeriod }
    }
  } catch {
    /* non-fatal */
  }

  return {
    schemaVersion: 1,
    teamId: leagueTeam.id,
    teamName: leagueTeam.teamName,
    platformUserId: roster.platformUserId,
    record: {
      wins: leagueTeam.wins,
      losses: leagueTeam.losses,
      ties: leagueTeam.ties,
    },
    standingRank: leagueTeam.currentRank ?? null,
    pointsFor: leagueTeam.pointsFor,
    rosterPlayerCount: allIds.length,
    starters: refsFor(starters),
    bench: refsFor(bench),
    injuredReserve: refsFor(reserve),
    taxi: refsFor(taxi),
    opponentThisPeriod,
    dataGaps,
  }
}
