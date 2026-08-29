import 'server-only'

import { prisma } from '@/lib/prisma'
import { describeAge } from '@/lib/sports-data/freshnessPolicy'
import type { SectionState, UnavailableSection } from './leagueHome'
import { latestProjectionWeek, lookupProjections, positionRanks } from './playerProjections'
import { normalizePosition } from './positionNormalization'
import { loadSnapShare } from './snapShare'
import { getPlayerImpact, type LeagueImpact } from './playerImpact'
export type { LeagueImpact, ReplacementOption } from './playerImpact'
// Re-exported so server callers keep one import site; the definitions live in a
// server-only-free module because the client link builder needs them too.
import { parsePlayerRef } from './playerRef'
export { playerRef, parsePlayerRef } from './playerRef'
// The Player Command Center's replacement engine — reused as-is for the
// "recommended moves" section rather than re-deriving free agents here.
import {
  resolveReplacementOptions,
  type ClaimTarget,
  type ReplacementCandidate,
} from '@/lib/shared-services/league-hub/replacementOptions'

/**
 * Player Finder — "one name in, every platform, league, slot, injury and the
 * move to make".
 *
 * The cross-league part is the whole point of this screen, and it works like
 * this: `Roster.playerData` stores platform player ids in `players`, `starters`,
 * `reserve` and `taxi` arrays, and `SportsPlayer.sleeperId` bridges our player
 * rows to those ids. So a player is resolved to a sleeper id once, then every
 * roster in the user's leagues is filtered on it.
 *
 * Verified before building on it: Dalton Kincaid resolves to sleeperId 10236 and
 * appears on 42 rosters, 27 of them as a starter, with a positive control on a
 * second id. A JSON path filter that silently matched nothing would have made
 * this screen quietly claim the user owns no one.
 *
 * ⚠ The identity bridge is NOT complete. sleeperId is populated on roughly
 * 15k of 96k player rows, and PlayerIdentityMap holds under 2k entries — it
 * missed a player that SportsPlayer resolved. So `identityResolved: false` is a
 * real outcome and the screen says "we cannot cross-reference this player"
 * rather than "you do not own him".
 */

export type PlayerMatch = {
  externalId: string
  sleeperId: string | null
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
  number: number | null
  /** How many of the user's leagues roster him, when identity resolved. */
  rosteredIn: number | null
  platforms: string[]
  /**
   * ⚠ REQUIRED, BECAUSE `externalId` IS ONLY UNIQUE WITHIN A SPORT. Measured on
   * production: externalId `340` is Nerlens Noel (NBA), Josh Allen (NCAAF), Leroy
   * Sané (SOCCER) and Paul Goldschmidt (MLB) simultaneously. Without the sport,
   * opening a search result returned an arbitrary one of them — a different
   * athlete each page load, with our projections attached to whoever came back.
   */
  sport: string
}

export type LeagueSlot = {
  leagueId: string
  leagueName: string
  platform: string
  format: string | null
  /** STARTER / BENCH / IR / TAXI / NOT YOURS */
  slot: string
  isYours: boolean
}

/**
 * One league's pickup answer, produced by the Player Command Center's engine
 * (lib/shared-services/league-hub/replacementOptions). Bench swaps are NOT
 * repeated here — `impact` already prices those under each league's own
 * scoring; this carries the outside-the-roster half of the move.
 */
export type RecommendedMove = {
  leagueId: string
  leagueName: string
  platform: string
  /** The projection week the options were priced against. */
  projectionWeek: number | null
  /** The searched player's own standard-scoring projection, when the feed carries him. */
  affectedProjection: number | null
  /** Best unrostered players at his position, projection desc, capped by the engine at 3. */
  freeAgents: ReplacementCandidate[]
  /** Where a claim actually happens: our waiver wire, or the provider's own page. */
  claimTarget: ClaimTarget
}

export type PlayerDetail = {
  player: PlayerMatch
  identityResolved: boolean
  bio: { height: string | null; weight: string | null; age: number | null; college: string | null }
  injury: SectionState<{ status: string | null; description: string | null; reportedAt: Date | null }>
  seasonStats: SectionState<Array<{ season: string; stats: Record<string, string> }>>
  leagues: SectionState<LeagueSlot[]>
  /**
   * This week's projected points.
   *
   * ⚠ NOT LEAGUE-SPECIFIC, AND THE UI MUST NOT IMPLY IT IS. The handoff asked for
   * a projection under "this league's own scoring settings"; what the feed carries
   * is one number per player per week. Labelling a generic projection as a
   * league-scored one would be a fabrication, so the season/week travel with it and
   * the copy says "standard scoring".
   */
  projection: SectionState<{ points: number; season: string; week: number }>
  /**
   * Share of his team's snaps, offensive or defensive as the position requires.
   *
   * ⚠ THIS WAS AN `UnavailableSection` AND ITS REASON WAS FALSE. It read "snap share is not
   * ingested by any current provider" on a page rendering real projections, real injuries and
   * real season stats beside it. The columns were on disk the whole time: `off_snp` on 77% of
   * game rows and `tm_off_snp` on 89%, `def_snp` on 58% and `tm_def_snp` on 70%. Nobody had
   * looked — the same miss that had the IDP projector telling every reader defensive snap data
   * did not exist.
   */
  snapShare: SectionState<{ share: number; snaps: number; teamSnaps: number; games: number; basis: 'offense' | 'defense' }>
  /**
   * ⚠ `outOf` IS PART OF THE ANSWER. "WR12" sounds absolute and is not — it means
   * twelfth among the WRs this feed projected, not among every WR alive. Shipping
   * the rank without the denominator would claim a completeness the feed lacks.
   */
  positionRank: SectionState<{ rank: number; outOf: number; position: string }>
  /**
   * The game-day answer: every league where you have him, whether he is starting,
   * what he is worth under THAT league's scoring, and who on your bench to play
   * instead.
   *
   * ⚠ THIS IS THE SECTION THE SCREEN EXISTS FOR. Everything else here is
   * reference; this is the decision. It is ordered starters-first and by the size
   * of the drop-off, because on a Sunday the question is not "tell me about this
   * player" — it is "which of my leagues needs me in the next four minutes".
   */
  impact: SectionState<LeagueImpact[]>
  /**
   * ⚠ These deltas are STANDARD scoring — the engine prices the open pool
   * against the one projection feed — and the UI must say so, because the
   * impact section directly above shows league-scored numbers.
   */
  recommendedMoves: SectionState<RecommendedMove[]>
  freshness: { label: string; stale: boolean }
}

const SLOT_ORDER = ['starters', 'reserve', 'taxi', 'players'] as const

/** Team strings vary too ("BUF" vs "Buffalo Bills"); compare on the first token. */
function teamKey(raw: string | null): string {
  if (!raw) return ''
  const t = raw.trim().toUpperCase()
  return t.length <= 4 ? t : t.split(/\s+/).slice(-1)[0] ?? t
}

function slotLabel(key: (typeof SLOT_ORDER)[number]): string {
  if (key === 'starters') return 'STARTER'
  if (key === 'reserve') return 'IR SLOT'
  if (key === 'taxi') return 'TAXI'
  return 'BENCH'
}

export async function searchPlayers(query: string, limit = 12): Promise<PlayerMatch[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const rows = await prisma.sportsPlayer.findMany({
    where: { name: { contains: q, mode: 'insensitive' } },
    /*
     * A player can exist under several sources; prefer rows that carry the
     * sleeper id, because those are the ones that can be cross-referenced.
     *
     * ⚠ `nulls: 'last'` IS THE WHOLE FIX — WITHOUT IT THIS DID THE EXACT OPPOSITE
     * OF ITS OWN COMMENT. Postgres sorts NULLS FIRST on DESC, so plain
     * `sleeperId: 'desc'` floated every UNIDENTIFIED row to the top and the take
     * limit could cut off the identified one entirely. Searching "Josh Allen"
     * returned a projection on some runs and "we hold no Sleeper id for this
     * player" on others, from the same query against the same data.
     *
     * `externalId` is the final tiebreak so the order is total: name and sleeperId
     * both repeat across source rows, and any remaining tie was being broken by
     * whatever the planner returned.
     */
    orderBy: [
      { sleeperId: { sort: 'desc', nulls: 'last' } },
      { name: 'asc' },
      { externalId: 'asc' },
    ],
    take: limit * 3,
    select: {
      externalId: true, sleeperId: true, name: true, position: true,
      team: true, imageUrl: true, number: true, sport: true,
    },
  })

  // Collapse duplicates across sources, keeping the richest row per name+position.
  const seen = new Map<string, (typeof rows)[number]>()
  for (const r of rows) {
    // Normalised so "Dalton Kincaid / TE / BUF" and "Dalton Kincaid / Tight End
    // / BUF" collapse to one entry instead of looking like two players.
    const key = `${r.name.trim().toLowerCase()}|${normalizePosition(r.position)}|${teamKey(r.team)}`
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, r)
      continue
    }
    const better =
      (r.sleeperId ? 2 : 0) + (r.imageUrl ? 1 : 0) >
      (existing.sleeperId ? 2 : 0) + (existing.imageUrl ? 1 : 0)
    if (better) seen.set(key, r)
  }

  return [...seen.values()].slice(0, limit).map((r) => ({
    externalId: r.externalId,
    sport: r.sport,
    sleeperId: r.sleeperId,
    name: r.name,
    position: r.position,
    team: r.team,
    imageUrl: r.imageUrl,
    number: r.number,
    rosteredIn: null,
    platforms: [],
  }))
}

/**
 * Which of the user's leagues roster this player ON THE USER'S OWN TEAM, and in
 * which slot.
 *
 * ⚠ YOUR ROSTER, NOT ANY ROSTER. This used to fetch every roster in each league
 * and report the first one containing the player — so any league where ANY
 * manager had him was listed as yours, wearing that manager's slot (searching
 * Josh Allen showed "STARTER" in 47 leagues the viewer didn't roster him in).
 * Ownership resolves through the claimed-team predicate — the same one
 * getPlayerImpact uses: LeagueTeam.claimedByUserId → the roster matched on
 * platformUserId, externalId OR our own User uuid. The third candidate is not
 * optional: without it only 38 of 106 claimed teams found their roster.
 *
 * Slot precedence matters: a player listed in both `players` and `starters` is a
 * STARTER, not a bench player. `players` is the catch-all, so it is checked last.
 */
async function resolveLeagueSlots(
  sleeperId: string,
  leagueIds: string[],
  userId: string | null | undefined
): Promise<LeagueSlot[]> {
  if (leagueIds.length === 0 || !userId) return []

  const teams = await prisma.leagueTeam.findMany({
    where: { claimedByUserId: userId, leagueId: { in: leagueIds } },
    select: { leagueId: true, platformUserId: true, externalId: true },
  })
  if (teams.length === 0) return []

  const candidatesByLeague = new Map<string, Set<string>>()
  for (const t of teams) {
    const set = candidatesByLeague.get(t.leagueId) ?? new Set<string>()
    for (const c of [t.platformUserId, t.externalId, userId]) if (c) set.add(c)
    candidatesByLeague.set(t.leagueId, set)
  }
  const claimedLeagueIds = [...candidatesByLeague.keys()]
  const allCandidates = [...new Set([...candidatesByLeague.values()].flatMap((s) => [...s]))]

  const leagues = await prisma.league.findMany({
    where: { id: { in: claimedLeagueIds } },
    select: { id: true, name: true, platform: true, leagueType: true },
  })
  const byId = new Map(leagues.map((l) => [l.id, l]))

  const rosters = await prisma.roster.findMany({
    where: { leagueId: { in: claimedLeagueIds }, platformUserId: { in: allCandidates } },
    select: { leagueId: true, platformUserId: true, playerData: true },
  })

  const out: LeagueSlot[] = []
  const claimed = new Set<string>()

  for (const r of rosters) {
    if (claimed.has(r.leagueId)) continue
    // The candidate union spans every claimed team; accept only a roster whose
    // platformUserId belongs to THIS league's own candidate set.
    if (!r.platformUserId || !candidatesByLeague.get(r.leagueId)?.has(r.platformUserId)) continue
    const pd = (r.playerData ?? {}) as Record<string, unknown>

    for (const key of SLOT_ORDER) {
      const arr = pd[key]
      if (!Array.isArray(arr)) continue
      if (!arr.map(String).includes(sleeperId)) continue

      const league = byId.get(r.leagueId)
      out.push({
        leagueId: r.leagueId,
        leagueName: league?.name ?? 'League',
        platform: String(league?.platform ?? 'manual').toLowerCase(),
        format: league?.leagueType ?? null,
        slot: slotLabel(key),
        isYours: true,
      })
      claimed.add(r.leagueId)
      break
    }
  }

  return out
}

export async function getPlayerDetail(
  playerReference: string,
  userLeagueIds: string[],
  /**
   * ⚠ REQUIRED FOR THE GAME-DAY SECTION, AND OPTIONAL SO NOTHING ELSE BREAKS.
   * Without it we can still say which leagues roster this player; we cannot say
   * which of them is YOURS to act on, because roster ownership resolves through
   * the claimed-team predicate, not through the league list.
   */
  userId?: string | null
): Promise<PlayerDetail | null> {
  const { sport: refSport, externalId } = parsePlayerRef(playerReference)

  /*
   * ⚠ SPORT-SCOPED AND EXPLICITLY ORDERED, BOTH FOR THE SAME REASON. `externalId`
   * is a provider id that only means anything inside one sport, so an unscoped
   * lookup can match several unrelated athletes; and an unordered findFirst then
   * picks between them on whatever order the planner happened to return, which is
   * why this page showed a different person run to run. Scoping fixes the ambiguity
   * and the ordering makes the remaining case (same sport, duplicated row) stable
   * rather than a coin flip.
   */
  /*
   * 🛑 `nulls: 'last'` IS LOAD-BEARING. Postgres sorts NULLS FIRST on a DESC order, so
   * `{ sleeperId: 'desc' }` alone returns the row WITHOUT a platform id in preference to
   * the one with it — the exact opposite of what the ordering is here to do.
   *
   * Measured on DeVonta Smith (WR, PHI): externalId `6503` exists twice, as a
   * rolling_insights row carrying sleeperId 7525 and as a `backfill` row carrying none.
   * The bare DESC picked the backfill row, so `identityResolved` was false, no sibling
   * externalIds were gathered, and the season-stats join collapsed to
   * `source: 'backfill'` — which owns no stat rows. His page reported "no season
   * statistics ingested for this player" while nine rows across five seasons sat in the
   * table. The name join used to paper over this by matching regardless of which row won.
   */
  const row = await prisma.sportsPlayer.findFirst({
    where: refSport ? { externalId, sport: refSport } : { externalId },
    orderBy: [{ sleeperId: { sort: 'desc', nulls: 'last' } }, { fetchedAt: 'desc' }],
    select: {
      externalId: true, sleeperId: true, name: true, position: true, team: true,
      imageUrl: true, number: true, height: true, weight: true, age: true,
      // `source` is required, not decorative: an externalId means nothing without
      // the provider that minted it. See the identity-pair note below.
      college: true, sport: true, fetchedAt: true, source: true,
    },
  })
  if (!row) return null

  const identityResolved = Boolean(row.sleeperId)

  const leagues: SectionState<LeagueSlot[]> = !identityResolved
    ? {
        available: false,
        reason:
          'we have no platform id for this player, so we cannot tell which of your leagues roster him',
      }
    : { available: true, data: await resolveLeagueSlots(row.sleeperId!, userLeagueIds, userId) }

  /*
   * 🛑 EVERY LOOKUP BELOW USED TO MATCH ON NAME, AND NAMES ARE NOT IDENTITIES.
   *
   * `playerName equals row.name` (case-insensitive) attached ANOTHER PLAYER'S career to
   * this page whenever two people share a name. Measured in production 2026-08-29: 218
   * NFL names are held by two or more distinct players (548 players), and 61 of those
   * names carry season stats. Worked example — "DeVonta Smith" is both the Eagles WR
   * (sleeperId 7525) and a Panthers CB (13977); all nine stat rows belong to the WR, so
   * the CB's page rendered the receiver's 2021-2025 seasons as his own.
   *
   * The identity set: this player's own externalId, plus every externalId belonging to a
   * SportsPlayer row that shares his sleeperId. One player has up to three rows here —
   * rolling_insights, sleeper and thesportsdb each mint their own externalId — and the
   * stats table is keyed on whichever the writer used, so gathering the set is what keeps
   * the cross-provider merge below working while binding it to one person.
   */
  /*
   * 🛑 THE PAIR IS (SOURCE, EXTERNALID). MATCHING ON THE ID ALONE IS A BUG I SHIPPED.
   *
   * Provider ids are bare integers with no namespace, so the SAME STRING NAMES
   * DIFFERENT PEOPLE in different feeds. Measured in production: `3167` is Kendrick
   * Bourne (WR) to rolling_insights and Adam Butler (DL) to api_sports. An id-only set
   * put Butler's 2025 defensive line — `defense.sacks 1` — on Bourne's page, which is
   * the same wrong-player defect this join was written to fix, arriving through a
   * different key.
   *
   * So the identity of a stat row is (source, playerId), and it only matches a
   * SportsPlayer row of the SAME source. api_sports has 168 stat rows and NO player
   * rows at all, so nothing there can be attributed this way — correctly, since the
   * only thing that ever "matched" it was a collision.
   */
  const identityPairs: Array<{ source: string; playerId: string }> = [
    { source: row.source, playerId: row.externalId },
  ]
  if (row.sleeperId) {
    const siblings = await prisma.sportsPlayer
      .findMany({
        where: { sport: row.sport, sleeperId: row.sleeperId },
        select: { externalId: true, source: true },
      })
      .catch(() => [] as Array<{ externalId: string; source: string }>)
    for (const s of siblings) {
      if (s.externalId && s.source) identityPairs.push({ source: s.source, playerId: s.externalId })
    }
  }

  /*
   * ⚠ INJURIES STAY ON THE NAME, BECAUSE THE ID DOES NOT EXIST TO JOIN ON.
   *
   * `SportsInjury.playerId` is populated by rolling_insights, api_sports and sleeper —
   * and by ESPN on ZERO of its 2,747 NFL rows, which is the writer this page depends on
   * ("Injuries come from the ESPN writer — TheSportsDB serves none at all"). An id join
   * here would drop the entire injury feed rather than bind it correctly.
   *
   * So guard the ambiguity instead of pretending it away: when the name belongs to more
   * than one player in this sport, REFUSE rather than guess. On this data that suppresses
   * 25 of 1,250 live NFL designations — a 2% cost to never tell a manager the wrong man
   * is out. An unresolved identity is also refused: without a sleeperId we cannot even
   * ask whether the name is shared.
   */
  const nameSharers = await prisma.sportsPlayer
    .findMany({
      where: { sport: row.sport, name: { equals: row.name, mode: 'insensitive' }, sleeperId: { not: null } },
      select: { sleeperId: true },
      distinct: ['sleeperId'],
      take: 5,
    })
    .catch(() => [] as Array<{ sleeperId: string | null }>)
  const nameIsAmbiguous = nameSharers.length > 1

  const injuryRow = nameIsAmbiguous
    ? null
    : await prisma.sportsInjury
        .findFirst({
          where: { sport: row.sport, playerName: { equals: row.name, mode: 'insensitive' } },
          orderBy: { fetchedAt: 'desc' },
          select: { status: true, description: true, date: true, fetchedAt: true },
        })
        .catch(() => null)

  const injury: SectionState<{ status: string | null; description: string | null; reportedAt: Date | null }> =
    injuryRow
      ? {
          available: true,
          data: { status: injuryRow.status, description: injuryRow.description, reportedAt: injuryRow.date },
        }
      : {
          available: false,
          reason: nameIsAmbiguous
            ? `more than one ${row.sport} player is named ${row.name}, and the injury feed carries no id to tell them apart — so we will not guess`
            : 'no injury designation on file — which is not the same as healthy',
        }

  /*
   * A NAME IS ONLY DANGEROUS WHEN IT IS SHARED — so drop it exactly then, and not before.
   *
   * ⚠ AN ID-ONLY JOIN WAS TRIED FIRST AND IS THE WRONG FIX. Measured against production:
   * matching solely on the identity set reaches 1,195 players where the name reached
   * 1,961 — it would have silently emptied the stats panel for 766 people. The cause is
   * that 4,026 of 9,875 resolvable stat rows are keyed on an externalId that exists only
   * on a SportsPlayer row with a NULL sleeperId, so nothing links them to the page. That
   * trades a wrong-data bug for a missing-data bug on six times as many pages.
   *
   * What actually distinguishes the two cases is ambiguity, which is already computed
   * above for injuries. When 218 NFL names are shared by two or more players, only those
   * names can contaminate; for the rest the name IS the player. So:
   *
   *   shared name  -> identity set ONLY. Narrow, occasionally empty, never someone else's.
   *   unique name  -> identity set OR name. Full coverage, and there is no one to confuse
   *                   him with.
   *
   * On the worked example that means the Panthers CB gets nothing (correct — he has no
   * ingested stats) instead of the Eagles receiver's five seasons, while the receiver
   * keeps all nine of his rows.
   */
  const stats = await prisma.playerSeasonStats
    .findMany({
      where: {
        sport: row.sport,
        OR: [
          ...identityPairs,
          ...(nameIsAmbiguous ? [] : [{ playerName: { equals: row.name, mode: 'insensitive' as const } }]),
        ],
      },
      orderBy: { season: 'desc' },
      take: 10,
      select: { season: true, stats: true },
    })
    .catch(() => [])

  /*
   * ONE ROW PER SEASON, MERGED ACROSS PROVIDERS.
   *
   * `playerSeasonStats` holds a row per (player, season, provider), and the
   * providers carry different stat vocabularies for the same year - measured on
   * Brock Purdy, 2024 arrives twice: `sacks / fumbles / completions /
   * games_played` from one and `Passing Yards / Rushing Yards / Passing
   * Touchdowns` from another. Rendered raw that printed "2024" twice with
   * different numbers under each, which reads as a bug, and it also threw
   * React's duplicate-key warning because the season was the list key.
   *
   * Merged rather than de-duplicated by picking a winner: both rows are real
   * statistics for that season, and choosing one would silently drop whichever
   * vocabulary the reader came for. Earlier rows win a key collision because the
   * query is `season desc` and provider rows are otherwise unordered - a stable
   * rule, so the same page renders the same way twice.
   *
   * `take` is 10 rather than 5 because the cap now counts provider rows, not
   * seasons; five seasons of a two-provider player needed ten.
   */
  /*
   * ⚠ ONE PROVIDER STORES AN ENVELOPE WHERE THE OTHERS STORE A STAT MAP.
   *
   * 168 NFL rows — every api_sports row, all season 2025 — hold the raw provider
   * payload rather than the stats: `{ sport, teams, season, provider, fetchedAt,
   * flattened }`. Rendered by the page's `Object.entries(stats).slice(0, 6)` that
   * printed the WRAPPER as though it were statistics, and because `teams` is an array
   * it came out as "teams [object Object] · provider api_sports · fetchedAt …" on a
   * public page.
   *
   * `flattened` is the real stat map, keyed `defense.sacks`, `rushing.yards`. The group
   * prefix is deliberately KEPT: rolling_insights writes bare `sacks` / `tackles`, and
   * stripping the prefix to match would merge `rushing.yards` and `receiving.yards` into
   * one `yards` and silently pick whichever landed first. A qualified key is uglier than
   * a bare one and is the only version that is true.
   */
  const unwrapStats = (raw: unknown): Record<string, string> => {
    if (!raw || typeof raw !== 'object') return {}
    const obj = raw as Record<string, unknown>
    const inner = obj.flattened
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return inner as Record<string, string>
    }
    return obj as Record<string, string>
  }

  const bySeason = new Map<string, Record<string, string>>()
  for (const s of stats) {
    const merged = bySeason.get(s.season) ?? {}
    for (const [k, v] of Object.entries(unwrapStats(s.stats))) {
      /*
       * Skip nested values outright. Only scalars belong in a stat line, and anything
       * else reaching the renderer becomes "[object Object]" — which is how this defect
       * presented in the first place.
       */
      if (v !== null && typeof v === 'object') continue
      if (!(k in merged)) merged[k] = v as string
    }
    bySeason.set(s.season, merged)
  }

  const seasonStats: SectionState<Array<{ season: string; stats: Record<string, string> }>> =
    bySeason.size > 0
      ? {
          available: true,
          data: [...bySeason.entries()].map(([season, stats]) => ({ season, stats })),
        }
      : { available: false, reason: 'no season statistics ingested for this player' }

  const age = describeAge('player_bio', row.fetchedAt)

  /*
   * ⚠ KEYED ON sleeperId, WHICH IS NULLABLE — the same bridge every other
   * cross-league feature here depends on. No Sleeper id means we cannot find him
   * on a roster at all, which is a different statement from "he is on none of
   * your teams" and must not be rendered as one.
   */
  const impactRows =
    userId && row.sleeperId ? await getPlayerImpact(row.sleeperId, userId).catch(() => null) : null

  const impact: PlayerDetail['impact'] = impactRows
    ? { available: true, data: impactRows }
    : {
        available: false,
        reason: !userId
          ? 'sign in to see which of your leagues this affects'
          : !row.sleeperId
            ? 'we hold no Sleeper id for this player, so we cannot locate him on your rosters'
            : 'we could not read your rosters for this player',
      }

  /*
   * ⚠ THE OUTSIDE HALF OF "THE MOVE TO MAKE". `impact` prices the bench swap
   * under each league's own scoring; this adds who is UNROSTERED and better,
   * with a real claim link, via the same engine the Player Command Center uses.
   * Bounded on purpose: only leagues where he is on YOUR roster, starters
   * first, capped — the engine scans a whole league's rosters per call, and
   * this is a page view, not a cron. A league the engine cannot answer for is
   * dropped rather than guessed at; if none survive, the section says so.
   */
  const MOVE_LEAGUE_CAP = 4
  const moveLeagues =
    userId && row.sleeperId && leagues.available
      ? [...leagues.data]
          .sort((a, b) => Number(b.slot === 'STARTER') - Number(a.slot === 'STARTER'))
          .slice(0, MOVE_LEAGUE_CAP)
      : []

  const moveRows = (
    await Promise.all(
      moveLeagues.map(async (l) => {
        const r = await resolveReplacementOptions({
          appUserId: userId!,
          leagueId: l.leagueId,
          affectedPlayerId: row.sleeperId!,
        }).catch(() => null)
        if (!r || r.freeAgentOptions.length === 0) return null
        return {
          leagueId: l.leagueId,
          leagueName: l.leagueName,
          platform: l.platform,
          projectionWeek: r.projectionWeek,
          affectedProjection: r.affectedProjection,
          freeAgents: r.freeAgentOptions,
          claimTarget: r.claimTarget,
        }
      })
    )
  ).filter((m): m is RecommendedMove => m !== null)

  const recommendedMoves: PlayerDetail['recommendedMoves'] =
    moveRows.length > 0
      ? { available: true, data: moveRows }
      : {
          available: false,
          reason: !userId
            ? 'sign in to see pickup options for your own leagues'
            : !row.sleeperId
              ? 'we hold no Sleeper id for this player, so we cannot weigh him against your rosters'
              : !leagues.available || leagues.data.length === 0
                ? 'he is not on any of your rosters, so there is no lineup hole to fill'
                : 'no unrostered player we can price would fill his slot in the leagues we checked',
        }

  /*
   * ⚠ EVERYTHING BELOW HANGS ON `sleeperId`, AND IT IS NULLABLE. The projection
   * feed is keyed by Sleeper id; a player we hold only under a TheSportsDB
   * external id cannot be joined to it at all. That is a real and common gap —
   * `sleeperId` is NFL-only and covers 87.2% of the table — so it produces an
   * explicit "we can't price this one", never a zero.
   */
  const projectionWeek = row.sleeperId ? await latestProjectionWeek() : null
  const projKey = row.sleeperId ?? ''

  const projRow = projectionWeek
    ? (await lookupProjections([projKey], projectionWeek)).get(projKey)
    : undefined

  const projection: PlayerDetail['projection'] = projRow
    ? {
        available: true,
        data: {
          points: Math.round(projRow.projectedPoints * 100) / 100,
          season: projectionWeek!.season,
          week: projectionWeek!.week,
        },
      }
    : {
        available: false,
        reason: row.sleeperId
          ? 'this week’s projection feed does not carry this player'
          : 'we hold no Sleeper id for this player, and the projection feed is keyed by one',
      }

  /*
   * ⚠ RANK IS COMPUTED ONLY WHEN THE PLAYER HIMSELF IS PROJECTED. Ranking a player
   * the feed never priced would place him last among everyone it did — a confident
   * "WR143 of 143" built entirely from his absence.
   */
  /*
   * Snap share, from the game logs rather than from a provider feed.
   *
   * The computation lives in `snapShare.ts` because the defence hub needs the same answer for a
   * whole roster at once. Inlined here it would have to be copied there, and two copies of a
   * derived number disagree eventually — on the same player, on the same afternoon.
   */
  const snapShare: PlayerDetail['snapShare'] = await loadSnapShare(prisma, {
    sleeperId: row.sleeperId,
    position: row.position,
    sport: row.sport,
  })

  const rankRow = projRow ? (await positionRanks([projKey], projectionWeek)).get(projKey) : undefined
  const rank: PlayerDetail['positionRank'] = rankRow
    ? {
        available: true,
        data: { rank: rankRow.rank, outOf: rankRow.outOf, position: rankRow.position },
      }
    : {
        available: false,
        reason: 'a rank needs this player to appear in the projection set, and he does not',
      }

  return {
    player: {
      externalId: row.externalId,
      sport: row.sport,
      sleeperId: row.sleeperId,
      name: row.name,
      position: row.position,
      team: row.team,
      imageUrl: row.imageUrl,
      number: row.number,
      rosteredIn: leagues.available ? leagues.data.length : null,
      platforms: leagues.available ? [...new Set(leagues.data.map((l) => l.platform))] : [],
    },
    identityResolved,
    bio: { height: row.height, weight: row.weight, age: row.age, college: row.college },
    injury,
    seasonStats,
    leagues,
    impact,
    projection,
    snapShare,
    positionRank: rank,
    recommendedMoves,
    freshness: { label: age.label, stale: age.stale },
  }
}

/**
 * Resolve a public `/players/{slug}` URL to a player we can render.
 *
 * The slug carries sport + sleeperId (see lib/core-app/playerSlug.ts for why
 * neither the name nor externalId can be the key). One athlete has one row per
 * ingest source, so this picks between them deterministically instead of letting
 * the planner decide: prefer a row that actually carries a team and a position
 * over a bare stub, then the freshest. Without the explicit order the same URL
 * rendered "Justin Jefferson, WR, MIN" and "Justin Jefferson, no team" on
 * alternating requests.
 *
 * `canonicalSlug` is returned so the page can redirect a URL whose name head has
 * gone stale — a player changing their listed name must not orphan an already
 * indexed link.
 */
export async function resolvePublicPlayer(
  sport: string,
  sleeperId: string
): Promise<{ playerReference: string; name: string; sport: string; sleeperId: string } | null> {
  const rows = await prisma.sportsPlayer
    .findMany({
      where: {
        sport,
        // The column stores `TB` for team defences while the slug is lowercased.
        sleeperId: { equals: sleeperId, mode: 'insensitive' },
      },
      orderBy: [{ fetchedAt: 'desc' }],
      select: {
        externalId: true,
        name: true,
        sport: true,
        sleeperId: true,
        team: true,
        position: true,
      },
    })
    .catch(() => [])

  if (rows.length === 0) return null

  const best =
    rows.find((r) => r.team != null && r.position != null) ??
    rows.find((r) => r.position != null) ??
    rows[0]
  if (!best || !best.sleeperId) return null

  return {
    playerReference: `${best.sport}:${best.externalId}`,
    name: best.name,
    sport: best.sport,
    sleeperId: best.sleeperId,
  }
}

/**
 * Teammates at the same position, for the public player page.
 *
 * ⚠ THIS IS AN SEO STRUCTURE PROBLEM BEFORE IT IS A UX ONE. Every
 * `/players/{slug}` page is otherwise a leaf: the sitemap points at it and
 * nothing else does, so the crawler reaches thousands of pages that link to no
 * other page. Same-team, same-position players are the genuinely related set —
 * they are the ones a reader comparing a start/sit decision actually wants — so
 * the internal link graph and the useful link are the same link.
 *
 * DISTINCT on sleeperId because one athlete has one row per ingest source; six
 * "Justin Jefferson" rows would render as six identical suggestions.
 */
export async function getRelatedPlayers(
  sport: string,
  team: string | null,
  position: string | null,
  excludeSleeperId: string,
  limit = 6
): Promise<Array<{ name: string; sport: string; sleeperId: string; position: string | null }>> {
  if (!team || !position) return []

  const rows = await prisma.sportsPlayer
    .findMany({
      where: {
        sport,
        team,
        position,
        sleeperId: { not: null },
        NOT: { sleeperId: { equals: excludeSleeperId, mode: 'insensitive' } },
      },
      distinct: ['sleeperId'],
      orderBy: [{ sleeperId: 'asc' }, { fetchedAt: 'desc' }],
      take: limit,
      select: { name: true, sport: true, sleeperId: true, position: true },
    })
    .catch(() => [])

  return rows.flatMap((r) =>
    r.sleeperId ? [{ name: r.name, sport: r.sport, sleeperId: r.sleeperId, position: r.position }] : []
  )
}
