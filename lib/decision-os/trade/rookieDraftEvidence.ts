import 'server-only'

import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/league/isNativeLeague'

export type RookieDraftEvidence = { name: string; round: number; overall: number; teams: number }
type Draft = { teamCount: number; picks: Array<{ playerId: string | null; playerName: string; round: number; overall: number }> }

export function rookieEvidenceFromDrafts(drafts: readonly Draft[]): Map<string, RookieDraftEvidence> {
  const out = new Map<string, RookieDraftEvidence>()
  for (const { teamCount: teams, picks } of drafts) {
    if (!Number.isInteger(teams) || teams < 2) continue
    const counts = new Map<string, number>()
    for (const p of picks) if (p.playerId) counts.set(p.playerId, (counts.get(p.playerId) ?? 0) + 1)
    for (const { playerId, playerName, overall, round } of picks) {
      if (!playerId || !playerName.trim() || out.has(playerId) || counts.get(playerId) !== 1 ||
          !Number.isInteger(round) || !Number.isInteger(overall) || round < 1 ||
          overall <= (round - 1) * teams || overall > round * teams) continue
      out.set(playerId, { name: playerName, round, overall, teams })
    }
  }
  return out
}

/** Same league and native ID namespace. Exclude mock, startup, and auction results. */
export async function loadRookieDraftEvidence(league: { id: string; platform?: string | null }, now: Date) {
  if (!isNativePlatform(league.platform)) return new Map<string, RookieDraftEvidence>()
  try {
    const drafts = await prisma.draftSession.findMany({
      where: {
        leagueId: league.id, status: 'completed', sessionKind: 'live', draftModeLabel: 'rookie',
        playerPool: 'rookies_only', draftType: { in: ['snake', 'linear', 'snake_3rr'] },
        completedAt: { gte: new Date(now.getTime() - 730 * 86_400_000), lte: now },
      },
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      take: 2,
      select: {
        teamCount: true,
        picks: {
          where: { playerId: { not: null }, assetType: 'player' },
          select: { playerId: true, playerName: true, round: true, overall: true },
        },
      },
    })
    return rookieEvidenceFromDrafts(drafts)
  } catch {
    return new Map<string, RookieDraftEvidence>()
  }
}
