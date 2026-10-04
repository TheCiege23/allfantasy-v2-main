import type { Prisma } from '@prisma/client';
/** Phase 4 foundation: preserve values, not IDs pointing at mutable projection rows. */
export async function captureDraftAnalysisBasis(tx: Prisma.TransactionClient, league: {
    sport: unknown;
    season: number | null;
} | null, at: Date) {
    const base = { version: 'draft-analysis-basis-v2', capturedAt: at.toISOString(), identitySpace: 'canonical_with_verified_aliases', scoringBasis: 'league_rescored_stat_rates_per_game' };
    if (String(league?.sport).toUpperCase() !== 'NFL' || !league?.season)
        return { ...base, state: 'unsupported', reason: 'A compatible season projection source is unavailable.', entries: [] };
    const rows = await tx.aFProjectionSnapshot.findMany({
        where: { sport: 'NFL', season: league.season, week: null, eventId: null, computedAt: { lte: at } },
        orderBy: [{ computedAt: 'desc' }, { id: 'desc' }], take: 5001,
        select: { id: true, playerId: true, playerName: true, position: true, rosProjection: true, rosWeeksRemaining: true, afProjection: true, adjustmentFactors: true, computedAt: true, confidenceLevel: true },
    });
    if (rows.length > 5000)
        return { ...base, state: 'unsupported', reason: 'Projection dataset exceeds the capture bound; no partial grade is permitted.', entries: [] };
    const players = new Map<string, typeof rows[number]>();
    for (const row of rows)
        if (!players.has(row.playerId))
            players.set(row.playerId, row);
    const mappings = players.size ? await tx.playerIdentityMap.findMany({ where: { sport: 'NFL', id: { in: [...players.keys()] } }, select: { id: true, sleeperId: true } }) : [];
    const aliases = new Map(mappings.map(m => [m.id, m.sleeperId]));
    const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
    return {
        ...base, state: players.size ? 'captured' : 'empty', season: league.season,
        reason: 'Stat-rate baselines and verified aliases are frozen before selections. League rescoring is a per-game baseline, not a calibrated season forecast or win probability.',
        entries: [...players.values()].map(row => ({ playerId: row.playerId, sleeperId: aliases.get(row.playerId) ?? null, playerName: row.playerName, position: row.position, computedAt: row.computedAt.toISOString(), confidenceLevel: row.confidenceLevel,
            perGameRates: Object.fromEntries(Object.entries(object(object(row.adjustmentFactors).perGameRates)).filter(([,value]) => typeof value === 'number' && Number.isFinite(value))),
            genericAfPerGame: row.afProjection, genericRosPoints: row.rosProjection, rosWeeksRemaining: row.rosWeeksRemaining })),
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
