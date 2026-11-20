import { toUtc } from '@/lib/timezone';
import { readLineupLockSettings } from '@/lib/redraft/lineupLock';
import { fingerprint, LineupEvidenceUnavailable, type EvidenceGame, type EvidencePlayer, type DecisionBoundary, type StoredFrame } from './nativeLineupEvidence';
export type PolicyEvent = {
    id: string;
    sequence: bigint;
    effectiveAtMs: number;
    observedWeek: number;
    beforePolicy: unknown;
    afterPolicy: unknown;
    evidenceBatchId: string | null;
    action: string;
    baseline: boolean;
};
export function evidencePolicy(settings: unknown, week: number) { const p = readLineupLockSettings(settings); const overrides = p.overrides.filter(o => o.week == null || Number(o.week) === week); return { mode: p.mode, manualLocked: p.manualLockedWeeks.has(week), overrides, blocked: p.mode === 'manual' || overrides.length > 0, fingerprint: fingerprint({ mode: p.mode, manualLocked: p.manualLockedWeeks.has(week), overrides }) }; }
function overridden(policy: ReturnType<typeof evidencePolicy>, rosterId: string, playerId: string) { return policy.overrides.some(o => (o.rosterId == null || o.rosterId === rosterId) && (o.playerId == null || o.playerId === playerId)); }
function locked(policy: ReturnType<typeof evidencePolicy>, natural: number, at: number, rosterId: string, playerId: string, inclusive: boolean) {
    if (overridden(policy, rosterId, playerId))
        return false;
    if (policy.mode === 'manual')
        return policy.manualLocked;
    return inclusive ? natural <= at : natural < at;
}
/** Replay actual policy transitions. Reopening invalidates the earlier deadline only for its scope. */
export function resolveDecisionBoundary(input: {
    events: PolicyEvent[];
    week: number;
    rosterId: string;
    playerId: string;
    game: EvidenceGame;
    games: EvidenceGame[];
    sport: string;
    nowMs: number;
    periodEditable?: boolean;
    playerKickoffMs?:number;
}): DecisionBoundary {
    const nextDay = new Date(Date.parse(input.game.day + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    const nowMs = input.sport === 'NFL' ? input.nowMs : Math.min(input.nowMs, toUtc(nextDay, '00:00', 'America/New_York').getTime() - 0.001);
    const events = input.events.filter(e => e.observedWeek <= input.week && e.effectiveAtMs <= nowMs).sort((a, b) => a.effectiveAtMs - b.effectiveAtMs || (a.sequence < b.sequence ? -1 : 1));
    if (!events.length || !events[0].baseline)
        throw new LineupEvidenceUnavailable('Verified lock-policy history has no prospective baseline');
    const first = Math.min(...input.games.map(g => Date.parse(g.startAt))), kickoff = input.playerKickoffMs??Date.parse(input.game.startAt);
    const natural = (policy: ReturnType<typeof evidencePolicy>) => policy.mode === 'first_game_of_week' ? first : kickoff;
    const momentList = [...new Set([...events.map(e => e.effectiveAtMs), first, kickoff])].filter(t => t >= events[0].effectiveAtMs && t <= nowMs).sort((a, b) => a - b);
    let policy = evidencePolicy(events[0].afterPolicy, input.week), decision: DecisionBoundary | null = null;
    for (const at of momentList) {
        const atEvents = events.filter(e => e.effectiveAtMs === at);
        // Each event is ordered by its database sequence even if two clocks share a timestamp.
        const transitions = at === events[0].effectiveAtMs ? atEvents : [null, ...atEvents];
        for (const event of transitions) {
            if (event === events[0])
                continue;
            if (event?.baseline) {
                policy = evidencePolicy(event.afterPolicy, input.week);
                decision = null;
                continue;
            }
            const before = policy, after = event ? evidencePolicy(event.afterPolicy, input.week) : before;
            const beforeLocked = locked(before, natural(before), at, input.rosterId, input.playerId, !!event);
            const afterLocked = locked(after, natural(after), at, input.rosterId, input.playerId, true);
            if (!afterLocked)
                decision = null;
            else if (!beforeLocked) {
                const kind = event ? (overridden(before, input.rosterId, input.playerId) ? 'override_relock' : after.mode === 'manual' ? 'manual_lock' : 'policy_lock') : 'scheduled';
                decision = { at, kind, mode: after.mode, observationMode: before.mode, policyFingerprint: before.fingerprint, evidenceBatchId: event?.evidenceBatchId ?? undefined, policyEventId: event?.id, unit: input.sport === 'NFL' || ['manual', 'first_game_of_week'].includes(after.mode) ? 'week' : 'day', benchUnlocked: (player: EvidencePlayer, games: EvidenceGame[]) => {
                        if (overridden(before, input.rosterId, player.playerId))
                            return true;
                        if (before.mode === 'manual')
                            return !before.manualLocked;
                        const times = games.filter(g => player.gameKeys.includes(g.key) && (input.sport === 'NFL' || before.mode === 'first_game_of_week' || g.day === input.game.day)).map(g => Date.parse(g.startAt));
                        return times.length > 0 && (before.mode === 'first_game_of_week' ? first : Math.min(...times)) >= at;
                    } };
            }
            policy = after;
        }
    }
    if (!decision)
        return { unresolvedCode: !locked(policy, natural(policy), nowMs, input.rosterId, input.playerId, true) && input.periodEditable !== false && nowMs === input.nowMs ? 'open' : 'history', at: nowMs, kind: 'unresolved', mode: policy.mode, observationMode: policy.mode, policyFingerprint: policy.fingerprint, unit: input.sport === 'NFL' || policy.mode === 'manual' || policy.mode === 'first_game_of_week' ? 'week' : 'day', unresolved: 'No verified final lock boundary; the lineup may still be open or the lock predates policy history' };
    if (decision.kind !== 'scheduled' && !decision.evidenceBatchId)
        return { ...decision, unresolvedCode: 'receipt', unresolved: 'The commissioner boundary has no atomic evidence receipt' };
    // An unrelated policy change does not erase authentic observations. Verify
    // the policy that actually existed at capture, then use the real deadline’s
    // bench eligibility and the roster-history fingerprint independently.
    decision.framePolicyMatches = (frame: StoredFrame) => {
        const capturedAt = frame.capturedAtMs ?? frame.capturedAt.getTime();
        const event = [...events].reverse().find(e => e.effectiveAtMs <= capturedAt);
        if (!event)
            return false;
        const observed = evidencePolicy(event.afterPolicy, input.week);
        return observed.fingerprint === frame.payload.policyFingerprint && observed.mode === frame.payload.mode;
    };
    return decision;
}
