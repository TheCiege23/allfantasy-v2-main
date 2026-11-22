/**
 * Database half of the import review: player matching and the league as AF holds it now.
 *
 * Reads Postgres only — no provider call — so it sits inside the DB-first boundary. Both reads are
 * best-effort and time-boxed: a review that could not check something says so ("not checked"),
 * and never blocks the preview the commissioner is waiting on.
 */

import { prisma } from '@/lib/prisma'
import { withTimeout } from '@/lib/async-utils'
import { resolvePlayers } from '@/lib/shared-services/player-identity/PlayerIdentityResolver'
import type { ImportProvider } from '@/lib/league-import/types'
import type { ImportReviewPreviewInput, PreviousImportSnapshot } from './types'

/** Name fallback runs one query per player; past this many it costs more than it is worth. */
const MAX_NAME_FALLBACK = 80
const PLAYER_MATCH_BUDGET_MS = 6_000
const SNAPSHOT_BUDGET_MS = 4_000

const TEAM_UNIT_POSITIONS = new Set(['DEF', 'DST', 'D/ST', 'TEAM', 'TQB', 'HC'])

/**
 * source player id → found in AF's database. `null` when the check could not run in time.
 */
export async function matchImportedPlayers(input: {
  provider: ImportProvider
  sport: string
  preview: Pick<ImportReviewPreviewInput, 'managers' | 'playerMap'>
}): Promise<Record<string, boolean> | null> {
  const ids = [...new Set(input.preview.managers.flatMap((m) => m.players ?? []))].filter(
    (id) => !TEAM_UNIT_POSITIONS.has(String(input.preview.playerMap[id]?.position ?? '').toUpperCase()),
  )
  if (ids.length === 0) return {}

  const work = (async () => {
    // Pass 1: id-only. Batched by the resolver into one query per provider column.
    const direct = await resolvePlayers(
      ids.map((sourceId) => ({ provider: input.provider, sourceId, sport: input.sport })),
    )
    const out: Record<string, boolean> = {}
    const misses: string[] = []
    direct.forEach((r, i) => {
      out[ids[i]] = Boolean(r?.player)
      if (!r?.player) misses.push(ids[i])
    })
    // Pass 2: name fallback for the misses, bounded. Yahoo has no id column at all, so for a
    // Yahoo league this is the whole match.
    const named = misses.slice(0, MAX_NAME_FALLBACK).filter((id) => input.preview.playerMap[id]?.name)
    if (named.length > 0) {
      const byName = await resolvePlayers(
        named.map((id) => ({
          provider: input.provider,
          nameHint: input.preview.playerMap[id]?.name,
          positionHint: input.preview.playerMap[id]?.position,
          teamHint: input.preview.playerMap[id]?.team,
          sport: input.sport,
        })),
      )
      byName.forEach((r, i) => {
        if (r?.player) out[named[i]] = true
      })
    }
    return out
  })()

  try {
    const res = await withTimeout(work, PLAYER_MATCH_BUDGET_MS)
    return res.ok ? res.value : null
  } catch {
    return null
  }
}

function asStringArray(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.map((x) => String(x)) : undefined
}

function asNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * The league as AF holds it now, for this user and source league. `null` on a first import.
 */
export async function loadPreviousImportSnapshot(input: {
  userId: string
  provider: ImportProvider
  sourceLeagueId: string
  season: number | null
}): Promise<PreviousImportSnapshot | null> {
  const work = (async (): Promise<PreviousImportSnapshot | null> => {
    const league = await prisma.league.findFirst({
      where: {
        userId: input.userId,
        platform: input.provider,
        platformLeagueId: input.sourceLeagueId,
        ...(input.season ? { season: input.season } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, settings: true, leagueSize: true, importedAt: true, lastSyncedAt: true },
    })
    if (!league) return null

    const [teams, rosters] = await Promise.all([
      prisma.leagueTeam.findMany({
        where: { leagueId: league.id, NOT: { lifecycleState: 'ARCHIVED' } },
        select: { externalId: true, teamName: true, ownerName: true },
      }),
      prisma.roster.findMany({ where: { leagueId: league.id }, select: { playerData: true } }),
    ])

    const rosterMap: Record<string, string[]> = {}
    for (const r of rosters) {
      const pd = (r.playerData ?? {}) as Record<string, unknown>
      const teamId = typeof pd.source_team_id === 'string' ? pd.source_team_id : null
      const players = asStringArray(pd.players)
      if (teamId && players) rosterMap[teamId] = players
    }

    const s = (league.settings ?? {}) as Record<string, unknown>
    const at = league.lastSyncedAt ?? league.importedAt
    return {
      lastImportedAt: at ? at.toISOString() : null,
      teams: teams.map((t) => ({ teamId: t.externalId, teamName: t.teamName, ownerName: t.ownerName })),
      rosters: rosterMap,
      settings: {
        teamCount: league.leagueSize ?? asNumber(s.leagueSize),
        rosterPositions: asStringArray(s.roster_positions),
        // From the stored normalized-league spread, so it is the same vocabulary the new
        // payload's `reviewFacts.leagueScoring` uses; the `League.scoring` column is mapped
        // differently and comparing across the two would report a change on every re-import.
        scoringFormat: typeof s.scoring === 'string' ? s.scoring : null,
        playoffTeamCount: asNumber(s.playoff_team_count),
        regularSeasonLength: asNumber(s.regular_season_length),
        isDynasty: typeof s.isDynasty === 'boolean' ? s.isDynasty : null,
      },
    }
  })()

  try {
    const res = await withTimeout(work, SNAPSHOT_BUDGET_MS)
    return res.ok ? res.value : null
  } catch {
    return null
  }
}
