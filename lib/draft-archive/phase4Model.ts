import { computeLeagueProjectedPoints } from '@/lib/projections/leagueScoring';
import { fillLineup, type ImpactPlayer } from '@/lib/decision-os/trade/rosterImpact';
import type { PreparationContext } from '@/lib/core-app/draftPreparationModel';
import type { AnalysisSelection, DraftAnalysisReport } from './analysisModel';

export const PHASE4_VERSION = 'draft-decision-v1';
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const id = (v: unknown) => typeof v === 'string' && v ? v : null;
export type DecisionPick = AnalysisSelection & { overall: number; amount?: number | null; auctionEvidence?: unknown; selectedAt?: string | null; adpDifference?: number | null };
export type FrozenPlayer = ImpactPlayer & { name: string; aliases: string[] };
/** Frozen identity evidence remains useful even when projection scoring is incomplete. */
export function frozenIdentities(basis:unknown,start:string|null):Array<{playerId:string;sleeperId:string|null}>{
  const b=obj(basis),seen=new Set<string>();
  if(!start||!Number.isFinite(Date.parse(start))||b.version!=='draft-analysis-basis-v2'||b.state!=='captured'||typeof b.capturedAt!=='string'||!Number.isFinite(Date.parse(b.capturedAt))||Date.parse(b.capturedAt)>Date.parse(start)||!Array.isArray(b.entries)||b.entries.length>5000)return [];
  const result:Array<{playerId:string;sleeperId:string|null}>=[];
  for(const raw of b.entries){const e=obj(raw),playerId=id(e.playerId),sleeperId=id(e.sleeperId),at=typeof e.computedAt==='string'?Date.parse(e.computedAt):NaN;
    const aliases=[...new Set([playerId,sleeperId].filter((v):v is string=>!!v))];
    if(!playerId||!Number.isFinite(at)||at>Date.parse(start)||aliases.some(a=>seen.has(a)))return [];
    aliases.forEach(a=>seen.add(a));result.push({playerId,sleeperId});
  }
  return result;
}
export type ReplayData = {
  version: typeof PHASE4_VERSION; state: 'ready' | 'unavailable'; reason: string;
  players: FrozenPlayer[]; picks: DecisionPick[]; existing: AnalysisSelection[]; slots: string[]; auction?: boolean; eligiblePlayerIds?: string[];
};
/** No mutable identity or projection lookup is permitted here. */
export function frozenUniverse(basis: unknown, context: PreparationContext | null, start: string | null): FrozenPlayer[] {
  const b = obj(basis);
  if (!context || context.sport !== 'NFL' || !start || !Number.isFinite(Date.parse(start)) || b.version !== 'draft-analysis-basis-v2' || b.state !== 'captured' || typeof b.capturedAt !== 'string' || !Number.isFinite(Date.parse(b.capturedAt)) || Date.parse(b.capturedAt) > Date.parse(start) || !Array.isArray(b.entries) || b.entries.length > 5000) return [];
  const rules = obj(context.scoringRules), result: FrozenPlayer[] = [], ids = new Set<string>(), aliases = new Set<string>();
  for (const raw of b.entries) {
    const e = obj(raw), playerId = id(e.playerId), at = typeof e.computedAt === 'string' ? Date.parse(e.computedAt) : NaN;
    if (!playerId || ids.has(playerId) || !Number.isFinite(at) || at > Date.parse(start) || typeof e.position !== 'string') return [];
    ids.add(playerId);
    const scored = computeLeagueProjectedPoints(obj(e.perGameRates), rules);
    if (!scored || !Number.isFinite(scored.points)) continue;
    if (scored.coverage.unmatched.length) return [];
    const names = [...new Set([playerId, id(e.sleeperId)].filter((x): x is string => !!x))];
    if (names.some(x => aliases.has(x))) return [];
    names.forEach(x => aliases.add(x));
    result.push({ playerId, name: typeof e.playerName === 'string' ? e.playerName : playerId, aliases: names, position: e.position.toUpperCase(), projectedPoints: scored.points });
  }
  return result;
}

/** Read the roster saved in the start event, never today's team. Ambiguous bindings block. */
export function frozenExistingRoster(snapshot: unknown, context: PreparationContext | null, teams: Array<{ rosterId: string }>): AnalysisSelection[] | null {
  if (!context) return null;
  if (context.leagueType === 'redraft' && context.purpose === 'standard') return [];
  const s = obj(snapshot);
  if (!Array.isArray(s.rosters) || !Array.isArray(s.teams) || s.rosters.length > 32 || teams.length !== context.teamCount) return null;
  const result: AnalysisSelection[] = [], used = new Set<string>();
  for (const team of teams) {
    const owners = s.teams.map(obj).filter(t => String(t.externalId) === team.rosterId);
    const rosters = s.rosters.map(obj).filter(r => id(r.id) === team.rosterId || (owners.length === 1 && id(owners[0].platformUserId) && r.platformUserId === owners[0].platformUserId));
    if (rosters.length !== 1 || !id(rosters[0].id) || used.has(String(rosters[0].id))) return null;
    used.add(String(rosters[0].id));
    const players = obj(rosters[0].playerData).players;
    if (!Array.isArray(players) || players.length > 200 || players.some(p => !id(p)) || new Set(players).size !== players.length) return null;
    for (const playerId of players as string[]) result.push({ playerId, rosterId: team.rosterId, playerName: playerId, position: 'Unknown', keeper: false });
  }
  return result;
}

export function buildReplay(basis: unknown, context: PreparationContext | null, start: string | null, picks: DecisionPick[], existing: AnalysisSelection[] | null): ReplayData {
  const base: ReplayData = { version: PHASE4_VERSION, state: 'unavailable', reason: 'Verified draft-time projections, complete pick order, frozen pool eligibility and (for auctions) recorded award budgets are required.', players: [], picks: [], existing: [], slots: [] };
  if (!context || !['snake', 'linear', 'auction'].includes(context.draftType) || !['all','rookies_only','veterans_only'].includes(context.playerPool) || !['standard', 'startup','rookie'].includes(context.purpose) || (context.purpose==='rookie'&&!['redraft','dynasty','keeper'].includes(context.leagueType)) || existing === null || !picks.length || picks.length > 1000) return base;
  if(!['redraft','dynasty','keeper'].includes(context.leagueType))return base;
  const eligiblePlayerIds = frozenPoolEligibility(basis,context,start);
  if(context.playerPool!=='all'&&!eligiblePlayerIds)return base;
  const players = frozenUniverse(basis, context, start), byAlias = new Map(players.flatMap(p => p.aliases.map(a => [a,p] as const)));
  const ordered = [...picks].sort((a,b) => a.overall - b.overall), taken = new Set<string>();
  if (!players.length || ordered.some((p,i) => p.overall !== i + 1 || !p.rosterId || !p.playerId || !byAlias.has(p.playerId))) return base;
  for (const p of ordered) { const canonical = byAlias.get(p.playerId!)!.playerId; if (taken.has(canonical)) return base; taken.add(canonical); }
  if (context.draftType === 'auction' && ordered.some(p => !p.keeper && (!auctionAwardBudget(p)||Date.parse(p.selectedAt!)<Date.parse(start!)))) return base;
  if (eligiblePlayerIds && ordered.some(p=>!p.keeper&&!eligiblePlayerIds.includes(byAlias.get(p.playerId!)!.playerId)))return base;
  const owned = new Map<string,string>();
  for (const p of existing) {
    const canonical = p.playerId ? byAlias.get(p.playerId)?.playerId : null;
    if (!canonical || !p.rosterId || owned.has(canonical)) return base;
    owned.set(canonical,p.rosterId);
  }
  if (ordered.some(p => owned.has(byAlias.get(p.playerId!)!.playerId) && (!p.keeper || owned.get(byAlias.get(p.playerId!)!.playerId) !== p.rosterId))) return base;
  const slots = context.rosterSlots.filter(s => !['BN','BE','BENCH','IR','TAXI'].includes(s));
  if (!slots.length || slots.length > 32 || fillLineup(players,slots).unknownSlots.length) return base;
  return { ...base, state:'ready', auction:context.draftType==='auction', eligiblePlayerIds:eligiblePlayerIds??undefined, reason:'Replays the recorded order within the preserved projection universe. Existing players and all reserved keepers are excluded. Counterfactuals compare the lineup at that pick only; later opponents, trades and outcomes are not simulated.', players, picks:ordered, existing, slots };
}

export function replayAt(data: ReplayData, overall: number, includeCandidates=true) {
  if (data.state !== 'ready' || !Number.isInteger(overall) || overall < 1 || overall > data.picks.length) return null;
  const pick = data.picks[overall-1], aliases = new Map(data.players.flatMap(p => p.aliases.map(a => [a,p] as const)));
  const canonical = (p: AnalysisSelection) => p.playerId ? aliases.get(p.playerId) : undefined;
  const unavailable = new Set([...data.existing, ...data.picks.filter(p => p.keeper || p.overall < overall)].flatMap(p => canonical(p) ? [canonical(p)!.playerId] : []));
  const roster = [...new Map([...data.existing.filter(p => p.rosterId === pick.rosterId), ...data.picks.filter(p => p.overall < overall && p.rosterId === pick.rosterId)].flatMap(p => canonical(p) ? [[canonical(p)!.playerId,canonical(p)!] as const] : [])).values()];
  const before = fillLineup(roster,data.slots), actual = canonical(pick)!;
  const available = data.players.filter(p => !unavailable.has(p.playerId)&&(!data.eligiblePlayerIds||data.eligiblePlayerIds.includes(p.playerId)));
  // One matching per eligibility-equivalent position. For any lower-scoring
  // player with the same edges, the matching gain is max(0, points - threshold).
  const bestByPosition = new Map<string,FrozenPlayer>();
  for (const p of available) if (!bestByPosition.has(p.position) || p.projectedPoints! > bestByPosition.get(p.position)!.projectedPoints!) bestByPosition.set(p.position,p);
  const thresholds = new Map([...bestByPosition].map(([position,p])=>{const after=fillLineup([...roster,p],data.slots),gain=after.points-before.points;return [position,{threshold:p.projectedPoints!-gain,fillsVacancy:after.starterIds.length>before.starterIds.length}] as const;}));
  const candidates = (includeCandidates ? available : [...bestByPosition.values()]).map(p => {const bound=thresholds.get(p.position)!,gain=p.projectedPoints!-bound.threshold;return {...p,gain:bound.fillsVacancy?gain:Math.max(0,gain)};}).sort((a,b) => b.gain-a.gain || b.projectedPoints!-a.projectedPoints! || a.playerId.localeCompare(b.playerId));
  const actualGain = roster.some(p=>p.playerId===actual.playerId) ? 0 : fillLineup([...roster,actual],data.slots).points-before.points;
  return { pick, before:before.points, actual:{...actual,gain:actualGain}, candidates, auctionBudget: data.auction ? auctionAwardBudget(pick) : null, opportunityGap: data.auction || pick.keeper || !candidates.length ? null : actualGain-candidates[0].gain };
}

export type DecisionComponents = { rosterId:string; name:string; values:[number|null,number|null,number|null,number|null]; scores:[number|null,number|null,number|null,number|null]; marketDiscount:number|null; benchmarkPicks:number; totalPicks:number };
export function decisionComponents(report: DraftAnalysisReport, replay: ReplayData): DecisionComponents[] {
  const rows: DecisionComponents[] = report.teams.map(t => {
    const picks = replay.picks.filter(p => p.rosterId === t.rosterId), opportunities = picks.filter(p => !p.keeper).map(p => replayAt(replay,p.overall,false)?.opportunityGap);
    const benchmarks = picks.filter(p => typeof p.adpDifference === 'number' && Number.isFinite(p.adpDifference));
    return { rosterId:t.rosterId,name:t.name,values:[t.starterPoints,opportunities.length && opportunities.every(v => typeof v === 'number') ? opportunities.reduce<number>((s,v)=>s+(v ?? 0),0)/opportunities.length : null, report.state === 'ready' ? 1 : null,t.benchValue],scores:[null,null,null,null],marketDiscount:benchmarks.length ? benchmarks.reduce((s,p)=>s+p.adpDifference!,0)/benchmarks.length : null,benchmarkPicks:benchmarks.length,totalPicks:t.selections };
  });
  for (let i=0;i<4;i++) if (report.state === 'ready' && rows.every(r => r.values[i] !== null)) for (const r of rows) {
    const lower = rows.filter(o => o.values[i]! < r.values[i]!-1e-6).length, tied = rows.filter(o => Math.abs(o.values[i]!-r.values[i]!) <= 1e-6).length;
    r.scores[i] = rows.length > 1 ? 100*(lower+(tied-1)/2)/(rows.length-1) : null;
  }
  return rows;
}

/** Saved at award time; never reconstruct historical purchasing power from today's budget. */
export function auctionAwardBudget(pick: DecisionPick) {
  const e=obj(pick.auctionEvidence), at=typeof e.capturedAt==='string'?Date.parse(e.capturedAt):NaN;
  if(e.version!=='auction-award-v1'||e.rosterId!==pick.rosterId||!Number.isFinite(at)||typeof pick.selectedAt!=='string'||Date.parse(pick.selectedAt)!==at||
    [e.budgetBefore,e.slotsRemaining,e.minimumBid,pick.amount].some(v=>typeof v!=='number'||!Number.isFinite(v))||
    !Number.isInteger(e.slotsRemaining)||Number(e.slotsRemaining)<1||Number(e.slotsRemaining)>100||
    Number(e.minimumBid)<=0||Number(e.budgetBefore)<0||Number(e.budgetBefore)>1000000)return null;
  const maxBid=Number(e.budgetBefore)-(Number(e.slotsRemaining)-1)*Number(e.minimumBid);
  if(Number(pick.amount)<Number(e.minimumBid)||Number(pick.amount)>maxBid)return null;
  return {budgetBefore:Number(e.budgetBefore),slotsRemaining:Number(e.slotsRemaining),minimumBid:Number(e.minimumBid),maxBid,capturedAt:e.capturedAt as string};
}
export function auctionAlternative(data:ReplayData,overall:number,playerId:string,price:number){
  const replay=replayAt(data,overall),budget=replay?.auctionBudget;
  if(!data.auction||!replay||!budget||replay.pick.keeper||!Number.isFinite(price)||price<budget.minimumBid||price>budget.maxBid)return null;
  const player=replay.candidates.find(p=>p.playerId===playerId);
  return player?{playerName:player.name,assumedPrice:price,remainingBudget:budget.budgetBefore-price,lineupGainDifference:player.gain-replay.actual.gain}:null;
}

/** Restricted membership is frozen separately from projections, with explicit seasonal provenance. */
export function frozenPoolEligibility(basis:unknown,context:PreparationContext,start:string|null):string[]|null{
  if(context.playerPool==='all')return null;
  const e=obj(obj(basis).eligibility),observed=typeof e.observedAt==='string'?Date.parse(e.observedAt):NaN,captured=typeof e.capturedAt==='string'?Date.parse(e.capturedAt):NaN;
  if(!start||e.version!=='draft-pool-eligibility-v1'||e.pool!==context.playerPool||e.season!==context.season||e.source!=='Sleeper years_exp by verified ID'||!Number.isFinite(observed)||!Number.isFinite(captured)||observed>captured||captured>Date.parse(start)||captured-observed>86400000||!Array.isArray(e.playerIds)||!e.playerIds.length||e.playerIds.length>5000||e.playerIds.some(p=>!id(p))||new Set(e.playerIds).size!==e.playerIds.length)return null;
  const identities=frozenIdentities(basis,start),known=new Set(identities.map(p=>p.playerId));
  return e.playerIds.every(p=>known.has(p))?e.playerIds as string[]:null;
}
