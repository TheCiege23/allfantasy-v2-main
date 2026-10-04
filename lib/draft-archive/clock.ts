export type ArchiveClock = {
    version: 1;
    overall: number;
    owner: string | null;
    running: boolean;
    at: string;
    openedAt?: string | null;
    activeMs: number;
    byOwner: Record<string, number>;
    totalActiveMs: number;
    complete: boolean;
};
export type ClockEvent = 'start' | 'pause' | 'resume' | 'reset_timer' | 'ownership' | 'selection' | 'complete' | 'reset_draft' | 'auction_nomination' | 'auction_bid' | 'auction_pass';
export function advanceArchiveClock(previous: ArchiveClock | null, event: ClockEvent, at: Date, overall: number, owner: string | null, running: boolean) {
    const now = at.getTime(), oldAt = previous ? Date.parse(previous.at) : now;
    if (!Number.isFinite(now) || !Number.isFinite(oldAt) || now < oldAt)
        throw new Error('Non-monotonic draft clock');
    const base = event === 'start' ? null : previous;
    const elapsed = base?.running ? now - oldAt : 0;
    const byOwner = { ...(base?.byOwner ?? {}) };
    if (base?.owner && elapsed)
        byOwner[base.owner] = (byOwner[base.owner] ?? 0) + elapsed;
    const activeMs = (base?.activeMs ?? 0) + elapsed;
    const wallMs = typeof base?.openedAt === 'string' ? now - Date.parse(base.openedAt) : NaN;
    const elapsedMs = Number.isFinite(wallMs) && wallMs >= activeMs ? wallMs : null;
    const selected = event === 'selection' && base?.complete && base.overall === overall
        ? { openedAt: base.openedAt ?? null, elapsedMs, pausedMs: elapsedMs == null ? null : elapsedMs - activeMs, activeMs, byOwner } : null;
    const changed = base != null && base.overall !== overall;
    const moves = event === 'selection' || event === 'reset_draft' || event === 'auction_nomination' || event === 'auction_pass' || changed;
    const clock: ArchiveClock = { version: 1, overall, owner, running, at: at.toISOString(), openedAt: event === 'start' || moves ? at.toISOString() : base?.openedAt ?? null, activeMs: moves ? 0 : activeMs, byOwner: moves ? {} : byOwner, totalActiveMs: (base?.totalActiveMs ?? 0) + elapsed, complete: event === 'start' || (base?.complete === true && event !== 'reset_draft' && !changed) };
    return { clock, selected };
}
