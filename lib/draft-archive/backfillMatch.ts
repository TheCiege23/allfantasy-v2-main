export type HistoricalSelection = {
    sourceDraftId: string;
    season: number;
    round: number;
    overall: number;
    playerId: string;
    metadata: unknown;
};
export function uniqueHistoricalSelection(fact: {
    season: number | null;
    round: number;
    pickNumber: number;
    playerId: string;
}, candidates: HistoricalSelection[]) {
    const matches = candidates.filter(c => c.season === fact.season && c.round === fact.round && c.overall === fact.pickNumber && c.playerId === fact.playerId);
    const drafts = new Set(matches.map(c => c.sourceDraftId));
    return drafts.size === 1 ? matches[0] : null;
}
