/**
 * The settings that decide what a league IS — sport, season, team count, format, dynasty — are
 * fixed once its draft has started.
 *
 * 🛑 THEY WERE PATCHABLE AT ANY TIME. The lifecycle gate ran only when a caller supplied a
 * `section`, the section-less `PATCH /api/league/settings` never does, and
 * `CommissionerSettingsService` had no gate at all — so a drafted NFL redraft league could be
 * turned into an NBA dynasty league mid-season. Changing the sport re-scores existing rosters
 * against another sport's categories; raising the team count reopens invites into a drafted
 * league. Nothing here can be undone by changing it back once a week has been scored on it.
 */
import { prisma } from '@/lib/prisma'

export const STRUCTURAL_LEAGUE_KEYS = ['sport', 'season', 'leagueSize', 'leagueType', 'isDynasty'] as const
export type StructuralLeagueKey = (typeof STRUCTURAL_LEAGUE_KEYS)[number]

const NOT_STARTED_DRAFT_STATUSES = new Set(['pre_draft', 'configuring', 'configured'])

/** The structural keys a patch would actually change (same value = not a change). */
export function changedStructuralKeys(
  body: Record<string, unknown>,
  current: Partial<Record<StructuralLeagueKey, unknown>>,
): StructuralLeagueKey[] {
  return STRUCTURAL_LEAGUE_KEYS.filter(
    (key) => body[key] !== undefined && String(body[key]) !== String(current[key] ?? ''),
  )
}

/** Why the league's structure is locked, or null while it can still change. */
export async function structuralSettingsLockReason(leagueId: string): Promise<string | null> {
  const [started, season] = await Promise.all([
    prisma.draftSession.findFirst({
      where: { leagueId, status: { notIn: [...NOT_STARTED_DRAFT_STATUSES] } },
      select: { id: true },
    }),
    prisma.redraftSeason.findFirst({ where: { leagueId }, select: { id: true } }),
  ])
  if (started) return 'after the draft has started'
  if (season) return 'once the season exists'
  return null
}

/** A user-facing refusal for a patch, or null when it may proceed. */
export async function structuralPatchRefusal(
  leagueId: string,
  body: Record<string, unknown>,
  current: Partial<Record<StructuralLeagueKey, unknown>>,
): Promise<string | null> {
  const changed = changedStructuralKeys(body, current)
  if (changed.length === 0) return null
  const reason = await structuralSettingsLockReason(leagueId)
  return reason ? `${changed.join(', ')} cannot change ${reason}.` : null
}
