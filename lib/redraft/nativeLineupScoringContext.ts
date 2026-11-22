import type { Prisma } from '@prisma/client';
import { fingerprint, LineupEvidenceUnavailable, type DecisionBoundary, type EvidenceGame } from '@/lib/integrity/nativeLineupEvidence';
import { resolveDecisionBoundary, type PolicyEvent } from '@/lib/integrity/nativeLineupPolicy';
import { historicalStartersAt, type HistoricalPlayerState, type PlayerStateEvent } from './lineupHistory';
import { NON_SCORING_LINEUP_SLOTS } from './nonScoringLineupSlots';
export type ScoringDecision = {
    gameKey: string;
    rosterId: string;
    playerId: string;
    playerRowId: string;
    slot: string;
    at: number;
    policyEventId: string | null;
};
export type LineupScoringProof = {
    version: 1;
    policyRevision: string;
    selectionRevision: string;
    historySequence: string;
    rulesFingerprint: string;
    closed: boolean;
    decisions: ScoringDecision[];
};
export async function readScoringPolicy(db: Pick<Prisma.TransactionClient, '$queryRaw'>, input: {
    leagueId: string;
    season: number;
    week: number;
}) {
    const [{ nowMs }] = await db.$queryRaw<Array<{
        nowMs: number;
    }>> `SELECT (extract(epoch from clock_timestamp())*1000)::double precision AS "nowMs"`;
    const events = await db.$queryRaw<PolicyEvent[]> `SELECT id,sequence,(extract(epoch from "effectiveAt")*1000)::double precision AS "effectiveAtMs","observedWeek","beforePolicy","afterPolicy","evidenceBatchId",action,baseline FROM native_lineup_policy_events WHERE "leagueId"=${input.leagueId} AND season=${input.season} AND "observedWeek"<=${input.week} AND "effectiveAt"<=clock_timestamp() ORDER BY "effectiveAt",sequence`;
    return { nowMs, events, policyRevision: fingerprint(events.map(e => [e.id, e.sequence.toString(), e.effectiveAtMs, e.afterPolicy])) };
}
/** Shared authority for scoring and integrity. No injury/projection facts are needed to score. */
export function createScoringLineupContext(input: {
    sport: string;
    week: number;
    games: EvidenceGame[];
    events: PolicyEvent[];
    nowMs: number;
    policyRevision: string;
    history: PlayerStateEvent[];
    coveredFrom: number;
    settings: unknown;
    seasonStatus: string;
    currentWeek: number;
    team: (value: string | null) => string;
}) {
    const boundaryCache = new Map<string, DecisionBoundary>();
    const cache = new Map<number, HistoricalPlayerState[]>(), decisions = new Map<string, ScoringDecision>();
    let closed = true;
    const states = (at: number) => { if (at < input.coveredFrom)
        throw Error('LINEUP_HISTORY_BEFORE_BASELINE'); if (!cache.has(at))
        cache.set(at, historicalStartersAt(input.history, at, true, true)); return cache.get(at)!; };
    const candidates = [...new Map(input.history.flatMap(e => e.afterState ? [[e.afterState.rosterId + ':' + e.afterState.playerId, { rosterId: e.afterState.rosterId, playerId: e.afterState.playerId }] as const] : [])).values()];
    const boundaryFor = (game: EvidenceGame, rosterId: string, playerId: string, team?: string): DecisionBoundary => {
        if (!team && boundaryCache.has(game.key + ':' + rosterId + ':' + playerId))
            return boundaryCache.get(game.key + ':' + rosterId + ':' + playerId)!;
        const teamKickoff = input.sport === 'NFL' || !team ? undefined : Math.min(...input.games.filter(g => g.day === game.day && g.teams.includes(team)).map(g => Date.parse(g.startAt)));
        return resolveDecisionBoundary({ events: input.events, week: input.week, rosterId, playerId, game, games: input.games, sport: input.sport, nowMs: input.nowMs, playerKickoffMs: Number.isFinite(teamKickoff) ? teamKickoff : undefined, periodEditable: input.seasonStatus !== 'complete' && input.week >= Math.max(1, input.currentWeek) });
    };
    const select = (game: EvidenceGame, team?: string) => candidates.flatMap(candidate => {
        const boundary = boundaryFor(game, candidate.rosterId, candidate.playerId, team);
        const player = states(boundary.at).find(p => p.rosterId === candidate.rosterId && p.playerId === candidate.playerId);
        if (!player)
            return [];
        const relevant = game.teams.includes(input.team(player.team)) && (!team || input.team(player.team) === team);
        if (boundary.unresolved && boundary.unresolvedCode !== 'open') {
            if (relevant)
                throw new LineupEvidenceUnavailable(boundary.unresolved);
            return [];
        }
        if (relevant && boundary.unresolved)
            closed = false;
        if (relevant)
            boundaryCache.set(game.key + ':' + player.rosterId + ':' + player.playerId, boundary);
        if (relevant && !NON_SCORING_LINEUP_SLOTS.has(player.slotType.toUpperCase())) {
            if (boundary.unresolved)
                closed = false;
            decisions.set(game.key + ':' + player.rosterId + ':' + player.id, { gameKey: game.key, rosterId: player.rosterId, playerId: player.playerId, playerRowId: player.id, slot: player.slotType, at: boundary.at, policyEventId: boundary.policyEventId ?? null });
        }
        return relevant ? [{ player, boundary }] : [];
    });
    for (const game of input.games)
        for (const team of game.teams)
            select(game, team);
    const proof = (): LineupScoringProof => {
        const list = [...decisions.values()].sort((a, b) => (a.gameKey + ':' + a.rosterId + ':' + a.playerRowId).localeCompare(b.gameKey + ':' + b.rosterId + ':' + b.playerRowId)), owners = new Map<string, string>();
        for (const d of list) {
            const key = d.gameKey + ':' + d.playerId;
            if (owners.has(key) && owners.get(key) !== d.rosterId)
                throw Error('LINEUP_POLICY_DUPLICATE_GAME_OWNERSHIP');
            owners.set(key, d.rosterId);
        }
        return { version: 1, policyRevision: input.policyRevision, selectionRevision: fingerprint(list), historySequence: input.history.reduce((n, e) => e.sequence > n ? e.sequence : n, 0n).toString(), rulesFingerprint: fingerprint(input.settings), closed, decisions: list };
    };
    return { states, select, boundaryFor, proof };
}
