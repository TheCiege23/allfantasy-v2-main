import { createHash } from 'node:crypto';
import { allowedPositionsForSlot, normalizeToken, redraftPlayerPositionTokens } from '@/lib/redraft/lineupValidation';
export const EVIDENCE_VERSION = 1;
export const FRAME_MAX_AGE_MS = 5 * 60000;
export const FACT_MAX_AGE_MS = 24 * 3600000;
export type EvidencePlayer = {
    id: string;
    rosterId: string;
    playerId: string;
    playerName: string;
    position: string;
    team: string | null;
    slotType: string;
    status: string | null;
    projection: number | null;
    projectionUnit: 'week' | 'day' | null;
    projectionDay: string | null;
    statusAt: string | null;
    projectionAt: string | null;
    statusExpiresAt: string | null;
    projectionExpiresAt: string | null;
    statusSource: string | null;
    projectionSource: string | null;
    gameKeys: string[];
};
export type EvidenceGame = {
    key: string;
    startAt: string;
    day: string;
    teams: string[];
};
export type EvidenceFrame = {
    boundaryId?: string;
    version: 1;
    sport: string;
    seasonId: string;
    rosterId: string;
    week: number;
    rulesFingerprint: string;
    policyFingerprint: string;
    mode: string;
    starterSlots: string[];
    players: EvidencePlayer[];
    games: EvidenceGame[];
};
export type StoredFrame = {
    id: string;
    capturedAt: Date;
    capturedAtMs?: number;
    payload: EvidenceFrame;
    stateFingerprint: string;
    source?: string;
};
export type DecisionPlayer = {
    playerId: string;
    playerName?: string;
    status?: string;
    proj?: number;
    slotPosition?: string;
    decisionAt?: string;
    decisionAtMs?: number;
    gameStartAt?: string;
    firstGameAt?: string;
    observationId?: string;
    evidenceSource?: string;
    decisionKind?: string;
    policyEventId?: string;
    alternatives?: Array<{
        playerId: string;
        playerName: string;
        proj?: number;
        status: string;
    }>;
};
export type DecisionCard = {
    lineupScoringProof?:import('@/lib/redraft/nativeLineupScoringContext').LineupScoringProof;
    rosterId: string;
    starters: DecisionPlayer[];
    bench: Array<{
        playerId: string;
        proj?: number;
    }>;
};
export class LineupEvidenceUnavailable extends Error {
    constructor(message: string) { super('Saved lineup evidence is incomplete: ' + message); }
}
export class LineupDecisionStillOpen extends LineupEvidenceUnavailable {
}
export function fingerprint(value: unknown): string {
    const stable = (v: any): any => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
    return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
export function stateFingerprint(players: readonly {
    id: string;
    rosterId: string;
    playerId: string;
    slotType: string;
    position: string;
    team: string | null;
}[]) {
    return fingerprint([...players].map(p => [p.id, p.rosterId, p.playerId, normalizeToken(p.slotType), p.position, p.team]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}
export function normalizeAvailability(value: unknown): string | null {
    const s = String(value ?? '').trim().toUpperCase().replace(/[ -]+/g, '_');
    if (['OUT', 'O', 'INJURED_RESERVE', 'IR', 'DOUBTFUL', 'D', 'SUSPENDED', 'INACTIVE'].includes(s))
        return ['O'].includes(s) ? 'OUT' : ['D'].includes(s) ? 'DOUBTFUL' : s === 'INJURED_RESERVE' ? 'IR' : s;
    if (['ACTIVE', 'HEALTHY', 'AVAILABLE', 'PROBABLE', 'P', 'QUESTIONABLE', 'Q', 'DAY_TO_DAY', 'DTD'].includes(s))
        return ['P'].includes(s) ? 'PROBABLE' : s === 'Q' ? 'QUESTIONABLE' : s === 'DTD' ? 'DAY_TO_DAY' : s;
    return null;
}
export function unavailable(status: string | null) { return status !== null && ['OUT', 'IR', 'DOUBTFUL', 'SUSPENDED', 'INACTIVE'].includes(status); }
export function fresh(at: string | null, now: number, expiresAt?: string | null) { const value = at ? Date.parse(at) : NaN; return Number.isFinite(value) && value <= now && now - value <= FACT_MAX_AGE_MS && (!expiresAt || Date.parse(expiresAt) > now); }
export type DecisionBoundary = {
    at: number;
    kind: string;
    mode: string;
    observationMode: string;
    policyFingerprint: string;
    evidenceBatchId?: string;
    policyEventId?: string;
    unit: 'week' | 'day';
    unresolved?: string;
    unresolvedCode?: 'open' | 'history' | 'receipt';
    framePolicyMatches?: (frame: StoredFrame) => boolean;
    benchUnlocked?: (player: EvidencePlayer, games: EvidenceGame[]) => boolean;
};
/** Every result is tied to its actual final deadline, policy and roster, never current facts. */
export function buildDecisionCards(input: {
    sport: string;
    games: EvidenceGame[];
    frames: StoredFrame[];
    rosterIds: string[];
    policyFingerprint: string;
    mode: string;
    historyAt: (cutoff: number) => Array<{
        id: string;
        rosterId: string;
        playerId: string;
        position: string;
        team: string | null;
        slotType: string;
    }>;
    checkIllegal: boolean;
    checkBench: boolean;
    candidateTimes?: number[];
    historyCoveredFrom?: number;
    boundaryFor?: (game: EvidenceGame, rosterId: string, playerId: string) => DecisionBoundary;
}): DecisionCard[] {
    if (!input.games.length)
        throw new LineupEvidenceUnavailable('No verified games in the period');
    if (!input.boundaryFor && !['per_player_kickoff', 'first_game_of_week'].includes(input.mode))
        throw new LineupEvidenceUnavailable('Manual or overridden deadlines require an explicit evidence boundary');
    const first = Math.min(...input.games.map(g => Date.parse(g.startAt)));
    const result = new Map(input.rosterIds.map(id => [id, { rosterId: id, starters: [] as DecisionPlayer[], bench: [] }]));
    const decisions = new Set<string>(), cache = new Map<number, ReturnType<typeof input.historyAt>>();
    const history = (time: number) => {
        if (!cache.has(time))
            cache.set(time, input.historyAt(time));
        return cache.get(time)!;
    };
    const starting = (slot: string) => !['BENCH', 'BN', 'IR', 'TAXI', 'DEVY', 'RESERVE', 'INACTIVE'].includes(normalizeToken(slot));
    const observedAt = (row: StoredFrame) => row.capturedAtMs ?? row.capturedAt.getTime();
    for (const game of input.games)
        for (const rosterId of input.rosterIds) {
            const automaticCutoff = input.mode === 'first_game_of_week' ? first : Date.parse(game.startAt);
            const candidates = new Set([...input.frames.flatMap(row => row.payload.rosterId === rosterId ? row.payload.players.filter(p => row.payload.starterSlots.includes(normalizeToken(p.slotType)) && p.gameKeys.includes(game.key)).map(p => p.playerId) : []), ...[automaticCutoff, ...(input.candidateTimes ?? [])].flatMap(t => history(t).filter(p => p.rosterId === rosterId && starting(p.slotType) && game.teams.includes(String(p.team))).map(p => p.playerId))]);
            for (const playerId of candidates) {
                const boundary: DecisionBoundary = input.boundaryFor?.(game, rosterId, playerId) ?? { at: automaticCutoff, kind: 'scheduled', mode: input.mode, observationMode: input.mode, policyFingerprint: input.policyFingerprint, unit: input.sport === 'NFL' || input.mode === 'first_game_of_week' ? 'week' : 'day' };
                if (input.historyCoveredFrom != null && boundary.at < input.historyCoveredFrom)
                    throw new LineupEvidenceUnavailable('Roster history begins after the decision');
                const cutoff = boundary.at, historical = history(cutoff).filter(p => p.rosterId === rosterId);
                const owned = historical.find(p => p.playerId === playerId && starting(p.slotType) && game.teams.includes(String(p.team)));
                if (!owned)
                    continue;
                if (boundary.unresolved)
                    throw new (boundary.unresolvedCode === 'open' ? LineupDecisionStillOpen : LineupEvidenceUnavailable)(boundary.unresolved);
                const key = rosterId + ':' + playerId + ':' + (boundary.unit === 'week' ? 'week:' + boundary.at : game.day);
                if (decisions.has(key))
                    continue;
                const frame = input.frames.filter(row => row.payload.rosterId === rosterId && row.payload.sport === input.sport && observedAt(row) < cutoff && cutoff - observedAt(row) <= FRAME_MAX_AGE_MS && (boundary.framePolicyMatches ? boundary.framePolicyMatches(row) : row.payload.mode === boundary.observationMode && row.payload.policyFingerprint === boundary.policyFingerprint) && (!boundary.evidenceBatchId || row.payload.boundaryId === boundary.evidenceBatchId) && row.payload.games.some(g => g.key === game.key && g.startAt === game.startAt)).sort((a, b) => observedAt(b) - observedAt(a) || b.id.localeCompare(a.id))[0];
                if (!frame || frame.payload.version !== EVIDENCE_VERSION || frame.stateFingerprint !== stateFingerprint(historical) || frame.stateFingerprint !== stateFingerprint(frame.payload.players))
                    throw new LineupEvidenceUnavailable('No matching pre-lock roster observation');
                const players = frame.payload.players, starter = players.find(p => p.playerId === playerId && frame.payload.starterSlots.includes(normalizeToken(p.slotType)));
                if (!starter)
                    throw new LineupEvidenceUnavailable('The observed starter does not match its historical slot');
                if (players.some(p => frame.payload.starterSlots.includes(normalizeToken(p.slotType)) && !p.gameKeys.length))
                    throw new LineupEvidenceUnavailable('A starting player has no verified game boundary');
                const alternatives = players.filter(p => ['BENCH', 'BN'].includes(normalizeToken(p.slotType)) && allowedPositionsForSlot(input.sport, starter.slotType).some(pos => redraftPlayerPositionTokens(p.position).includes(pos)) && p.gameKeys.some(k => frame.payload.games.some(g => g.key === k && (boundary.unit === 'week' || g.day === game.day))) && (boundary.benchUnlocked ? boundary.benchUnlocked(p, frame.payload.games) : p.gameKeys.some(k => frame.payload.games.some(g => g.key === k && Date.parse(g.startAt) >= cutoff && (boundary.unit === 'week' || g.day === game.day)))));
                if (alternatives.length && (input.checkIllegal || input.checkBench) && (!starter.status || !fresh(starter.statusAt, cutoff, starter.statusExpiresAt) || Date.parse(starter.statusAt!) > observedAt(frame)))
                    throw new LineupEvidenceUnavailable('Starter availability was not known before lock');
                if (alternatives.some(p => !p.status || !fresh(p.statusAt, cutoff, p.statusExpiresAt) || Date.parse(p.statusAt!) > observedAt(frame)))
                    throw new LineupEvidenceUnavailable('Alternative availability was not known before lock');
                const usable = alternatives.filter(p => !unavailable(p.status));
                if (usable.length && input.checkBench && [starter, ...usable].some(p => p.projection === null || !fresh(p.projectionAt, cutoff, p.projectionExpiresAt) || Date.parse(p.projectionAt!) > observedAt(frame) || p.projectionUnit !== boundary.unit || (boundary.unit === 'day' && p.projectionDay !== game.day)))
                    throw new LineupEvidenceUnavailable('Comparable league-scored projections were not known before lock');
                decisions.add(key);
                result.get(rosterId)!.starters.push({ playerId: starter.playerId, playerName: starter.playerName, status: starter.status ?? undefined, proj: starter.projection ?? undefined, slotPosition: starter.slotType, decisionAt: new Date(cutoff).toISOString(),decisionAtMs:cutoff,gameStartAt:game.startAt,firstGameAt:new Date(first).toISOString(), observationId: frame.id, evidenceSource: frame.source, decisionKind: boundary.kind, policyEventId: boundary.policyEventId, alternatives: usable.map(p => ({ playerId: p.playerId, playerName: p.playerName, status: p.status!, proj: p.projection ?? undefined })) });
            }
        }
    for (const rosterId of input.rosterIds)
        if (!result.get(rosterId)!.starters.length)
            throw new LineupEvidenceUnavailable('No assessed starting decisions for a roster');
    return [...result.values()];
}
