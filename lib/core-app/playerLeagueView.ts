import 'server-only'

import { prisma } from '@/lib/prisma'
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
import { loadIdpProjections, mergeIdpStatLine } from '@/lib/idp-projections/loadIdpProjections'
import type { SectionState } from './leagueHome'
import { leagueDisplayName } from './leagueHome'
import { latestProjectionWeek } from './playerProjections'
import { hasIdpScoring, isIdpPosition } from './scoringNotes'
import { slotForStarterIndex, startingSlots } from './slotEligibility'

/**
 * Player Finder, scoped to ONE league: who has him here, and what he is worth here.
 *
 * The cross-league screen answers "where is he across everything I play". This
 * answers the question a manager asks with a league already open — "in THIS
 * league, is he mine, is he someone's, or is he free" — and it is the only path
 * on the screen that looks at every roster in a league rather than only yours.
 *
 * ⚠ IT DOES NOT REPLACE THE CROSS-LEAGUE VIEW. The 38a·4 rule stands: a held
 * league promotes and marks, it does not filter. This card sits ABOVE the
 * cross-league table when a league is in context; the table stays.
 *
 * ⚠ OWNERSHIP RESOLVES FROM THE ROSTER, NOT FROM THE TEAM ROW. `LeagueTeam` is
 * the import's list of managers; `Roster.playerData` is who actually holds
 * whom. The team row is joined afterwards for a name and a face — and when the
 * join misses, the answer is "another manager" with the roster's slot, never a
 * guessed name and never a downgrade to "free agent".
 *
 * ⚠ FREE AGENT IS A CLAIM, AND IT IS ONLY MADE WHEN ROSTERS EXIST. A league
 * with zero imported rosters cannot tell you he is unrostered; it can only tell
 * you it has not looked. That is `kind: 'unknown'` with the reason.
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
  /** Your team in this league, when the claim predicate finds one. */
  yourTeam: { teamName: string } | null
  rosterCount: number
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

  let ownership: PlayerLeagueOwnership
  if (rosters.length === 0) {
    ownership = { kind: 'unknown', reason: 'no rosters have been imported for this league, so we cannot tell who has him' }
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

  let statLine = ((projRow?.stats ?? {}) as Record<string, unknown>).stats as Record<string, unknown> | null | undefined
  if (statLine && typeof statLine !== 'object') statLine = null

  // Defensive component line for an IDP league, same gate as the impact loader.
  const position = player?.position ?? null
  if (scoring && at && hasIdpScoring(scoring) && isIdpPosition(position) && Number.isFinite(Number(at.season))) {
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

  return {
    leagueId: league.id,
    leagueName: leagueDisplayName(league.name),
    platform: String(league.platform ?? 'manual').toLowerCase(),
    platformLeagueId: league.platformLeagueId ?? null,
    season: league.season ?? null,
    format: league.leagueType ?? null,
    ownership,
    afPoints,
    yourTeam: yours ? { teamName: yours.teamName } : null,
    rosterCount: rosters.length,
  }
}
