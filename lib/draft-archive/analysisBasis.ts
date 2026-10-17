import {DRAFT_POINTS_SPORTS} from './sportEvidence';
import type { Prisma } from '@prisma/client';
/** Phase 4 foundation: preserve values, not IDs pointing at mutable projection rows. */
export async function captureDraftAnalysisBasis(tx: Prisma.TransactionClient, league: {
    sport: unknown;
    season: number | null;
} | null, at: Date, playerPool='all', sourcePlayerIds?:string[]) {
    const sport=String(league?.sport).toUpperCase();
    const base = { version: 'draft-analysis-basis-v2', capturedAt: at.toISOString(), sport, identitySpace: 'canonical_with_verified_aliases', scoringBasis: 'league_rescored_stat_rates_per_game' };
    if (!DRAFT_POINTS_SPORTS.some(s=>s===sport) || !league?.season)
        return { ...base, state: 'unsupported', reason: 'A compatible season projection source is unavailable.', entries: [] };
    // C2C uses a verified college identity pool; unrelated college rows must not exhaust its bound.
    if(sourcePlayerIds!==undefined&&(sport!=='NCAAF'||!Array.isArray(sourcePlayerIds)||sourcePlayerIds.length>5000||new Set(sourcePlayerIds).size!==sourcePlayerIds.length||sourcePlayerIds.some(id=>typeof id!=='string'||!id||id.length>64)))
        return {...base,state:'unsupported',reason:'Verified college projection identities are required.',entries:[]};
    if(sourcePlayerIds?.length===0)return {...base,state:'empty',reason:'No verified college projection IDs are available.',entries:[]};
    const rows = await tx.aFProjectionSnapshot.findMany({
        where: { sport, ...(sourcePlayerIds?{playerId:{in:sourcePlayerIds}}:{}), season: league.season, week: null, eventId: null, computedAt: { lte: at } },
        orderBy: [{ computedAt: 'desc' }, { id: 'desc' }], take: 5001,
        select: { id: true, playerId: true, playerName: true, position: true, rosProjection: true, rosWeeksRemaining: true, afProjection: true, adjustmentFactors: true, computedAt: true, confidenceLevel: true },
    });
    if (rows.length > 5000)
        return { ...base, state: 'unsupported', reason: 'Projection dataset exceeds the capture bound; no partial grade is permitted.', entries: [] };
    const players = new Map<string, typeof rows[number]>();
    for (const row of rows)
        if (!players.has(row.playerId))
            players.set(row.playerId, row);
    const mappings = players.size && sport==='NFL' ? await tx.playerIdentityMap.findMany({ where: { sport: 'NFL', id: { in: [...players.keys()] } }, select: { id: true, sleeperId: true } }) : [];
    const aliases = new Map(mappings.map(m => [m.id, m.sleeperId]));
    const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
    let eligibility: unknown = null;
    if (sport==='NFL' && players.size && ['rookies_only','veterans_only'].includes(playerPool)) {
        const cached = await tx.sportsDataCache.findUnique({where:{cacheKey:'sleeper:nfl:yearsexp:compact:v1'},select:{data:true,expiresAt:true}});
        const data=object(cached?.data),years=object(data.bySleeperId),observed=typeof data.observedAt==='string'?Date.parse(data.observedAt):NaN;
        const classified=[...players.keys()].map(playerId=>({playerId,years:years[aliases.get(playerId)??'']}));
        if(data.v===1&&data.season===league.season&&Number.isFinite(observed)&&observed<=at.getTime()&&at.getTime()-observed<=86400000&&cached!.expiresAt>at&&classified.every(p=>typeof p.years==='number'&&Number.isInteger(p.years)&&p.years>=0))
            eligibility={version:'draft-pool-eligibility-v1',pool:playerPool,season:league.season,capturedAt:at.toISOString(),observedAt:data.observedAt,source:'Sleeper years_exp by verified ID',playerIds:classified.filter(p=>playerPool==='rookies_only'?p.years===0:Number(p.years)>0).map(p=>p.playerId)};
    }
    return {
        eligibility, ...base, state: players.size ? 'captured' : 'empty', season: league.season,
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
