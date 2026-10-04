import type { Prisma } from '@prisma/client';
/** Phase 4 foundation: preserve values, not IDs pointing at mutable projection rows. */
export async function captureDraftAnalysisBasis(tx: Prisma.TransactionClient, league: {
    sport: unknown;
    season: number | null;
} | null, at: Date) {
    const base = { version: 'draft-analysis-basis-v1', capturedAt: at.toISOString(), identitySpace: 'canonical_player_id', scoringBasis: 'generic_ppr' };
    if (String(league?.sport).toUpperCase() !== 'NFL' || !league?.season)
        return { ...base, state: 'unsupported', reason: 'A compatible season projection source is unavailable.', entries: [] };
    const rows = await tx.aFProjectionSnapshot.findMany({
        where: { sport: 'NFL', season: league.season, week: null, eventId: null, computedAt: { lte: at } },
        orderBy: [{ computedAt: 'desc' }, { id: 'desc' }], take: 5001,
        select: { id: true, playerId: true, playerName: true, position: true, rosProjection: true, rosWeeksRemaining: true, computedAt: true, confidenceLevel: true },
    });
    if (rows.length > 5000)
        return { ...base, state: 'unsupported', reason: 'Projection dataset exceeds the capture bound; no partial grade is permitted.', entries: [] };
    const players = new Map<string, typeof rows[number]>();
    for (const row of rows)
        if (!players.has(row.playerId))
            players.set(row.playerId, row);
    return {
        ...base, state: players.size ? 'captured' : 'empty', season: league.season,
        reason: 'Generic PPR season baselines are preserved. League adjustment, replacement levels and identity mapping must be verified before draft-day grading.',
        entries: [...players.values()],
    };
}
export const DRAFT_ANALYSIS_VERSION = 'draft-analysis-v1';
export function analysisReadiness(basis: unknown, totalPicks: number) {
    const raw = basis && typeof basis === 'object' ? basis as Record<string, unknown> : {};
    return {
        version: DRAFT_ANALYSIS_VERSION, totalPicks,
        draftDay: { state: 'insufficient_data', capturedBaselines: Array.isArray(raw.entries) ? raw.entries.length : 0, scoringBasis: typeof raw.scoringBasis === 'string' ? raw.scoringBasis : null },
        resultsToDate: { state: 'insufficient_data', coveredPicks: 0 },
    } as const;
}
