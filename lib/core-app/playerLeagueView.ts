import 'server-only'

import { prisma } from '@/lib/prisma'
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
import { loadIdpProjections, mergeIdpStatLine } from '@/lib/idp-projections/loadIdpProjections'
import type { SectionState } from './leagueHome'
import { leagueDisplayName } from './leagueHome'
import { latestProjectionWeek } from './playerProjections'
import { normalizePosition } from './positionNormalization'
import { coverageReason, rosterIdCoverage, sampleRosterIds, type RosterIdCoverage } from './rosterIdCoverage'
import { hasIdpScoring, isIdpPosition } from './scoringNotes'
import { slotForStarterIndex, startingSlots } from './slotEligibility'

/**
 * Player Finder, scoped to ONE league: who has him here, and what he is worth here.
 *
 * Guap's call (2026-09-02): with a league in context the screen FILTERS to it.
 * This loader is then the whole answer — the ownership card is the header, the
 * table shows this league alone, and the projection and rank in the header are
 * this league's numbers. Without a league in context the cross-league loaders
 * run instead and this is not called.
 *
 * ⚠ OWNERSHIP RESOLVES FROM THE ROSTER, NOT FROM THE TEAM ROW. `LeagueTeam` is
 * the import's list of managers; `Roster.playerData` is who actually holds
 * whom. The team row is joined afterwards for a name and a face — and when the
 * join misses, the answer is "another manager" with the roster's slot, never a
 * guessed name and never a downgrade to "free agent".
 *
 * ⚠ FREE AGENT IS A CLAIM, AND IT IS ONLY MADE WHEN THE ROSTERS CAN BE READ.
 * Two ways they cannot: a league with zero imported rosters, and a league whose
 * rosters are keyed on the provider's own ids — the ESPN importer's header
 * records that ESPN rosters arrive as bare ESPN ids, so a Sleeper-id scan of
 * them finds nobody and would have called every player unrostered. Both are
 * `kind: 'unknown'` with the reason. A direct hit on such a roster is still a
 * hit; only a MISS is untrusted.
 */

export type PlayerLeagueOwner = {
  teamName: string
  ownerName: string
  avatarUrl: string | null
  /** "4-2" when the import carries results, else null. */
  record: string | null
  isCommissioner: boolean
}

export type PlayerLeagueOwnership =
  | { kind: 'yours'; slot: string; exactSlot: string | null; teamName: string | null }
  | { kind: 'other'; slot: string; owner: PlayerLeagueOwner | null }
  | { kind: 'free-agent' }
  | { kind: 'unknown'; reason: string }

export type PlayerLeagueView = {
  leagueId: string
  leagueName: string
  platform: string
  platformLeagueId: string | null
  season: number | null
  format: string | null
  ownership: PlayerLeagueOwnership
  /** Points under THIS league's scoring, whoever holds him. */
  afPoints: SectionState<{ points: number; matchedKeys: number; scoredKeys: number; week: number; season: string }>
  /**
   * His rank among projected players at his position, priced under THIS
   * league's scoring — the header's rank when a league is in context (Guap,
   * 2026-09-02). Standard-scoring rank is the cross-league header's job.
   */
  positionRank: SectionState<{ rank: number; outOf: number; position: string }>
  /** Your team in this league, when the claim predicate finds one. */
  yourTeam: { teamName: string } | null
  rosterCount: number
  /** Whether a Sleeper-id scan of this league's rosters can be trusted. */
  coverage: RosterIdCoverage
}

function asIds(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))).filter(Boolean) : []
}

/** Same precedence as everywhere else on this screen: a starter is a STARTER. */
function placementOf(
  pd: Record<string, unknown>,
  playerId: string
): { slot: string; starting: boolean; starterIndex: number; startersLength: number } | null {
  const starters = asIds(pd.starters)
  const idx = starters.indexOf(playerId)
  if (idx >= 0) return { slot: 'STARTER', starting: true, starterIndex: idx, startersLength: starters.length }
  const base = { starting: false, starterIndex: -1, startersLength: starters.length }
  if (asIds(pd.reserve).includes(playerId)) return { slot: 'IR SLOT', ...base }
  if (asIds(pd.taxi).includes(playerId)) return { slot: 'TAXI', ...base }
  if (asIds(pd.players).includes(playerId)) return { slot: 'BENCH', ...base }
  return null
}

function recordOf(t: { wins: number; losses: number; ties: number }): string | null {
  if (t.wins === 0 && t.losses === 0 && t.ties === 0) return null
  return t.ties > 0 ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`
}

/** The nested component line, or null when the row carries none. */
function statLineOf(stats: unknown): Record<string, unknown> | null {
  const s = (stats ?? {}) as Record<string, unknown>
  const inner = s.stats
  return inner && typeof inner === 'object' && !Array.isArray(inner) ? (inner as Record<string, unknown>) : null
}

export async function getPlayerLeagueView(
  leagueId: string,
  playerSleeperId: string,
  userId: string | null,
  player?: { position: string | null }
): Promise<PlayerLeagueView | null> {
  const league = await prisma.league
    .findUnique({
      where: { id: leagueId },
      select: {
        id: true,
        name: true,
        platform: true,
        platformLeagueId: true,
        season: true,
        settings: true,
        leagueType: true,
      },
    })
    .catch(() => null)
  if (!league) return null

  const [teams, rosters] = await Promise.all([
    prisma.leagueTeam
      .findMany({
        where: { leagueId },
        select: {
          externalId: true,
          platformUserId: true,
          claimedByUserId: true,
          ownerName: true,
          teamName: true,
          avatarUrl: true,
          wins: true,
          losses: true,
          ties: true,
          isCommissioner: true,
          isCoCommissioner: true,
        },
      })
      .catch(() => []),
    prisma.roster
      .findMany({
        where: { leagueId },
        select: { platformUserId: true, playerData: true },
      })
      .catch(() => []),
  ])

  /*
   * Can these rosters be searched by Sleeper id at all? One query: a sample of
   * the ids they hold, against our player table. See rosterIdCoverage.ts.
   */
  const sample = sampleRosterIds(rosters.map((r) => r.playerData))
  const knownRows =
    sample.length > 0
      ? await prisma.sportsPlayer
          .findMany({
            where: { sleeperId: { in: sample } },
            select: { sleeperId: true },
            distinct: ['sleeperId'],
          })
          .catch(() => [] as Array<{ sleeperId: string | null }>)
      : []
  const coverage = rosterIdCoverage(
    sample,
    new Set(knownRows.map((r) => r.sleeperId).filter((x): x is string => Boolean(x)))
  )

  const yours = userId ? (teams.find((t) => t.claimedByUserId === userId) ?? null) : null
  // The same three-candidate predicate every other ownership read here uses.
  const yourIds = new Set(
    [yours?.platformUserId, yours?.externalId, userId].filter((x): x is string => Boolean(x))
  )

  let holder: { platformUserId: string; placed: NonNullable<ReturnType<typeof placementOf>> } | null = null
  for (const r of rosters) {
    const placed = placementOf((r.playerData ?? {}) as Record<string, unknown>, playerSleeperId)
    if (placed) {
      holder = { platformUserId: r.platformUserId, placed }
      break
    }
  }

  const slots = startingSlots(league.settings)
  const platform = String(league.platform ?? 'manual').toLowerCase()

  let ownership: PlayerLeagueOwnership
  if (rosters.length === 0) {
    ownership = { kind: 'unknown', reason: 'no rosters have been imported for this league, so we cannot tell who has him' }
  } else if (!holder && !coverage.usable) {
    // A miss on rosters that do not speak Sleeper ids is not a free agent.
    ownership = { kind: 'unknown', reason: coverageReason(platform) }
  } else if (!holder) {
    ownership = { kind: 'free-agent' }
  } else if (yourIds.has(holder.platformUserId)) {
    ownership = {
      kind: 'yours',
      slot: holder.placed.slot,
      exactSlot: holder.placed.starting
        ? slotForStarterIndex(slots, holder.placed.startersLength, holder.placed.starterIndex)
        : null,
      teamName: yours?.teamName ?? null,
    }
  } else {
    const id = holder.platformUserId
    const team =
      teams.find((t) => t.platformUserId === id) ?? teams.find((t) => t.externalId === id) ?? null
    ownership = {
      kind: 'other',
      slot: holder.placed.slot,
      owner: team
        ? {
            teamName: team.teamName,
            ownerName: team.ownerName,
            avatarUrl: team.avatarUrl,
            record: recordOf(team),
            isCommissioner: Boolean(team.isCommissioner || team.isCoCommissioner),
          }
        : null,
    }
  }

  /*
   * Priced under THIS league's scoring, whoever holds him. The three failure
   * reasons are the same three `getPlayerImpact` distinguishes, for the same
   * reason: "no rules" and "no projection" send someone to different places.
   */
  const scoring = extractScoringSettings(league.settings)
  const at = await latestProjectionWeek().catch(() => null)
  const projRow =
    at
      ? await prisma.fantasyProjection
          .findFirst({
            where: {
              playerId: playerSleeperId,
              season: at.season,
              week: at.week,
              source: { not: 'allfantasy' },
            },
            orderBy: { fetchedAt: 'desc' },
            select: { stats: true },
          })
          .catch(() => null)
      : null

  let statLine = statLineOf(projRow?.stats)

  // Defensive component line for an IDP league, same gate as the impact loader.
  const position = player?.position ?? null
  const idpLeague = Boolean(scoring && hasIdpScoring(scoring))
  if (scoring && at && idpLeague && isIdpPosition(position) && Number.isFinite(Number(at.season))) {
    try {
      const { bySleeperId } = await loadIdpProjections({
        prisma,
        season: Number(at.season),
        week: at.week,
        players: [{ sleeperId: playerSleeperId, position }],
      })
      const outcome = bySleeperId.get(playerSleeperId)
      if (outcome?.ok) statLine = mergeIdpStatLine(statLine ?? undefined, outcome.statLine)
    } catch {
      // Unpriced defender, exactly as before; never take down the ownership answer.
    }
  }

  const priced = scoring && statLine ? computeLeagueProjectedPoints(statLine, scoring) : null

  const afPoints: PlayerLeagueView['afPoints'] =
    priced && at
      ? {
          available: true,
          data: {
            points: Math.round(priced.points * 100) / 100,
            matchedKeys: priced.coverage.matchedKeys,
            scoredKeys: priced.coverage.scoredKeys,
            week: at.week,
            season: at.season,
          },
        }
      : {
          available: false,
          reason: !scoring
            ? 'we hold no scoring settings for this league, and a generic projection would not be this league’s'
            : !at
              ? 'no projection week is loaded yet'
              : projRow
                ? 'we hold no usable scoring rules for this league — only a preset label, not the rules themselves'
                : 'this week’s projection feed does not carry this player',
        }

  /*
   * ── Rank under this league's scoring ────────────────────────────────────
   *
   * Every projected player at his position, priced with the same rules, and
   * his place among them. Same feed read the standard rank uses; the pricing
   * is what differs, and it is the whole point — a TE-premium league ranks
   * tight ends against each other on the premium, not on the feed's number.
   *
   * ⚠ ONLY WHEN HE HIMSELF IS PRICED. A rank built from his absence would be
   * "TE118 of 118" — confident and meaningless. Defenders in IDP leagues are
   * refused rather than ranked on an offensive line that says nothing about
   * them; the impact loader enriches one player, not a position.
   */
  let positionRank: PlayerLeagueView['positionRank'] = {
    available: false,
    reason: 'a rank needs this player priced under this league’s scoring first',
  }
  const pos = position ? normalizePosition(position) : null
  if (priced && at && scoring && pos && !isIdpPosition(pos)) {
    const rows = await prisma.fantasyProjection
      .findMany({
        where: { season: at.season, week: at.week, source: { not: 'allfantasy' } },
        select: { playerId: true, stats: true },
      })
      .catch(() => [] as Array<{ playerId: string; stats: unknown }>)

    let outOf = 0
    let above = 0
    let selfSeen = false
    for (const r of rows) {
      const meta = (r.stats ?? {}) as Record<string, unknown>
      const rowPos = typeof meta.position === 'string' ? normalizePosition(meta.position) : null
      if (rowPos !== pos) continue
      const line = statLineOf(r.stats)
      if (!line) continue
      const p = computeLeagueProjectedPoints(line, scoring)
      if (!p) continue
      outOf += 1
      if (r.playerId === playerSleeperId) {
        selfSeen = true
        continue
      }
      if (p.points > priced.points) above += 1
    }
    if (selfSeen && outOf > 0) {
      positionRank = { available: true, data: { rank: above + 1, outOf, position: pos } }
    } else if (outOf > 0) {
      positionRank = {
        available: false,
        reason: 'the projection feed does not list him at this position, so he cannot be ranked in it',
      }
    }
  } else if (pos && isIdpPosition(pos)) {
    positionRank = {
      available: false,
      reason: 'defensive players are not ranked here — the feed’s line for the rest of the position carries no defensive scoring',
    }
  }

  return {
    leagueId: league.id,
    leagueName: leagueDisplayName(league.name),
    platform,
    platformLeagueId: league.platformLeagueId ?? null,
    season: league.season ?? null,
    format: league.leagueType ?? null,
    ownership,
    afPoints,
    positionRank,
    yourTeam: yours ? { teamName: yours.teamName } : null,
    rosterCount: rosters.length,
    coverage,
  }
}
