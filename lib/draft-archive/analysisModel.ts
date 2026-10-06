import {scoreDraftRates,draftSlotEligibility} from './sportEvidence';
import { fillLineup, type ImpactPlayer } from '@/lib/decision-os/trade/rosterImpact';
import type { PreparationContext } from '@/lib/core-app/draftPreparationModel';
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export type AnalysisSelection = { playerId: string | null; rosterId: string | null; playerName: string; position: string; keeper: boolean };
export type DraftAnalysisReport = {
  version: 'draft-report-v2'; state: 'ready' | 'partial' | 'unavailable'; reason: string;
  teams: Array<{ rosterId: string; name: string; covered: number; selections: number; starterPoints: number | null; benchValue: number | null; rank: number | null; missingSlots: string[]; rosterPlayers?: number; existingCovered?: number; starterGain?: number | null }>;
  players: Array<{ playerId: string; name: string; position: string; points: number; replacement: number | null; valueOverReplacement: number | null; unrepresentedScoring: string[] }>;
  replacementBasis: string; computedBefore: string | null;
};
/** Descriptive ranks only. These stat-rate baselines are not calibrated win odds or letter grades. */
export function draftDayReport(basis: unknown, context: PreparationContext | null, selections: AnalysisSelection[], teams: Array<{ rosterId: string; name: string }>, start: string | null, existing: AnalysisSelection[] | null = null): DraftAnalysisReport {
  const base: DraftAnalysisReport = { version: 'draft-report-v2', state: 'unavailable', reason: 'Verified draft-time component baselines, identities and rules are required.', teams: [], players: [], replacementBasis: 'League-wide starting-slot demand proxy; not a waiver availability claim.', computedBefore: start };
  const raw = object(basis);
  if (!context || !draftSlotEligibility(context.sport) || (raw.sport!==undefined?raw.sport!==context.sport:context.sport!=='NFL') || !start || raw.version !== 'draft-analysis-basis-v2' || raw.state !== 'captured' || !Array.isArray(raw.entries) || raw.entries.length > 5000 || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(String(raw.capturedAt))) || Date.parse(String(raw.capturedAt)) > Date.parse(start)) return base;
  const eligibility=draftSlotEligibility(context.sport,raw.entries.flatMap(e=>typeof object(e).position==='string'?[object(e).position as string]:[]))!;
  const rules = object(context.scoringRules);
  if (!Object.values(rules).some(v => typeof v === 'number' && Number.isFinite(v) && v !== 0)) return base;
  const pool: ImpactPlayer[] = [], byAlias = new Map<string, ImpactPlayer>(), gaps = new Map<string, string[]>();
  const seen = new Set<string>(), ambiguous = new Set<string>();
  for (const value of raw.entries) {
    const e = object(value);
    if (typeof e.playerId !== 'string' || seen.has(e.playerId) || typeof e.position !== 'string' || !Number.isFinite(Date.parse(String(e.computedAt))) || Date.parse(String(e.computedAt)) > Date.parse(start)) return base;
    seen.add(e.playerId);
    const result = scoreDraftRates(object(e.perGameRates), rules,context.sport);
    if (!result || !Number.isFinite(result.points)) continue;
    const player = { playerId: e.playerId, position: e.position.toUpperCase(), projectedPoints: result.points };
    pool.push(player); gaps.set(player.playerId, result.coverage.unmatched);
    for (const alias of [e.playerId, e.sleeperId].filter((id): id is string => typeof id === 'string' && !!id)) {
      if (byAlias.has(alias) && byAlias.get(alias)!.playerId !== player.playerId) ambiguous.add(alias);
      else byAlias.set(alias, player);
    }
  }
  for (const alias of ambiguous) byAlias.delete(alias);
  const slots = context.rosterSlots.filter(s => !['BN','BE','BENCH','IR','TAXI'].includes(s));
  if (!slots.length || context.teamCount < 2 || context.teamCount > 32 || slots.length * context.teamCount > 320 || selections.length > 10000 || teams.length > 32) return base;
  const demand = fillLineup(pool, Array.from({ length: context.teamCount }, () => slots).flat(),eligibility);
  if (demand.unknownSlots.length || demand.unfilledSlots.length) return { ...base, reason: 'The projection pool cannot cover all recorded starting slots.' };
  const leagueStarters = new Set(demand.starterIds), replacement = new Map<string, number>();
  for (const p of pool) if (!leagueStarters.has(p.playerId)) replacement.set(p.position, Math.max(replacement.get(p.position) ?? -Infinity, p.projectedPoints!));
  const selectedPlayers = new Map<string, DraftAnalysisReport['players'][number]>();
  const globalGaps = Object.keys(rules).filter(key => typeof rules[key] === 'number' && rules[key] !== 0 && pool.every(p => gaps.get(p.playerId)?.includes(key)));
  const allRosterSelections = [...(existing ?? []), ...selections];
  const standardRedraft = context.leagueType === 'redraft' && context.purpose === 'standard' && !selections.some(p => p.keeper);
  const verifiedExisting = existing !== null && new Set(existing.map(p=>p.playerId?byAlias.get(p.playerId)?.playerId:undefined)).size===existing.length && existing.every(p => p.playerId && byAlias.has(p.playerId) && p.rosterId && teams.some(t => t.rosterId === p.rosterId));
  const rosterOwners = new Map<string,string>();
  let rosterConflict = false;
  for (const pick of allRosterSelections) { const canonical = pick.playerId ? byAlias.get(pick.playerId)?.playerId : undefined; if (canonical && pick.rosterId) { if (rosterOwners.has(canonical) && rosterOwners.get(canonical) !== pick.rosterId) rosterConflict = true; rosterOwners.set(canonical,pick.rosterId); } }
  const reports = teams.map(team => {
    const picks = selections.filter(p => p.rosterId === team.rosterId), rosterPicks = allRosterSelections.filter(p => p.rosterId === team.rosterId), mapped = rosterPicks.flatMap(p => p.playerId && byAlias.has(p.playerId) ? [byAlias.get(p.playerId)!] : []);
    const unique = [...new Map(mapped.map(p => [p.playerId, p])).values()];
    const lineup = fillLineup(unique, slots,eligibility), starters = new Set(lineup.starterIds);
    let benchValue = 0;
    for (const p of unique) {
      const pick = rosterPicks.find(k => k.playerId && byAlias.get(k.playerId)?.playerId === p.playerId)!;
      const rep = replacement.get(p.position) ?? null, vor = rep === null ? null : p.projectedPoints! - rep;
      selectedPlayers.set(p.playerId, { playerId: p.playerId, name: pick.playerName, position: p.position, points: p.projectedPoints!, replacement: rep, valueOverReplacement: vor, unrepresentedScoring: gaps.get(p.playerId) ?? [] });
      if (!starters.has(p.playerId) && vor !== null) benchValue += Math.max(0, vor);
    }
    const covered = picks.filter(p => p.playerId && byAlias.has(p.playerId)).length, completeRoster = rosterPicks.every(p => p.playerId && byAlias.has(p.playerId));
    const beforePlayers = (existing ?? []).filter(p => p.rosterId === team.rosterId).flatMap(p => p.playerId && byAlias.has(p.playerId) ? [byAlias.get(p.playerId)!] : []);
    return { rosterId: team.rosterId, name: team.name, covered, selections: picks.length, rosterPlayers:unique.length, existingCovered:beforePlayers.length, starterGain: verifiedExisting && completeRoster ? lineup.points-fillLineup(beforePlayers,slots,eligibility).points : null, starterPoints: completeRoster ? lineup.points : null, benchValue: completeRoster ? benchValue : null, rank: null as number | null, missingSlots: [...lineup.unknownSlots, ...lineup.unfilledSlots] };
  });
  // Rookie/keeper/dynasty drafts require the pre-existing roster; drafted players alone are incomplete.
  const canonicalSelections = selections.map(p => p.playerId ? byAlias.get(p.playerId)?.playerId : undefined);
  const complete = !globalGaps.length && new Set(canonicalSelections).size === selections.length && !rosterConflict && ((standardRedraft && (existing===null||verifiedExisting)) || (verifiedExisting && ['dynasty','keeper','redraft'].includes(context.leagueType))) && teams.length === context.teamCount && new Set(teams.map(t => t.rosterId)).size === teams.length && reports.every(t => t.rosterPlayers! > 0 && t.starterPoints !== null && t.benchValue !== null && t.covered === t.selections && !t.missingSlots.length) && selections.every(p => p.rosterId && teams.some(t => t.rosterId === p.rosterId));
  if (complete) for (const t of reports) t.rank = 1 + reports.filter(other => other.starterPoints! > t.starterPoints! + 0.000001).length;
  return { ...base, state: complete ? 'ready' : 'partial', reason: complete ? 'Relative rank by optimal starter stat-rate baseline under frozen scoring, including verified frozen existing rosters when required. Unrepresented scoring keys remain disclosed; no empirical grade calibration is claimed.' : 'Covered selections are shown; incomplete identities, rosters or starting slots prevent comparable team ranks.', teams: reports, players: [...selectedPlayers.values()] };
}
export type ResultsReport = { provisional?: boolean; state: 'ready' | 'partial' | 'unavailable'; teams: Array<{ rosterId: string; name: string; rank: number | null; points: number; starterPoints: number; starts: number; weeks: number[]; coveredPicks: number }>; coverage: string };
export function resultsReport(picks: AnalysisSelection[], teams: Array<{ rosterId: string; name: string }>, rows: Array<{ rosterId: string; playerId: string; points: number; isStarter: boolean; week: number }>, finalWeeks: number[]): ResultsReport {
  const finals = new Set(finalWeeks.filter(w => Number.isInteger(w) && w >= 1 && w <= 18)), totals = teams.map(t => ({ ...t, rank: null as number | null, points: 0, starterPoints: 0, starts: 0, weeks: [] as number[], coveredPicks: 0 }));
  let invalid = finals.size !== finalWeeks.length || new Set(teams.map(t => t.rosterId)).size !== teams.length || picks.some(p => !p.playerId || !p.rosterId || !teams.some(t => t.rosterId === p.rosterId));
  const seen = new Set<string>(), covered = new Map<string, Set<string>>();
  const duplicates = new Set<string>(), occurrences = new Set<string>();
  for (const r of rows) {
    const key = `${r.week}:${r.rosterId}:${r.playerId}`;
    if (!finals.has(r.week) || !picks.some(p => p.playerId === r.playerId && p.rosterId === r.rosterId)) continue;
    if (occurrences.has(key)) duplicates.add(key);
    occurrences.add(key);
  }
  if (duplicates.size) invalid = true;
  for (const r of rows) {
    const key = `${r.week}:${r.rosterId}:${r.playerId}`;
    // Attribute to the original drafting team only while the player remains on that team.
    const pick = picks.find(p => p.playerId === r.playerId && p.rosterId === r.rosterId), team = totals.find(t => t.rosterId === r.rosterId);
    if (!pick || !team || !finals.has(r.week)) continue;
    if (duplicates.has(key) || !Number.isFinite(r.points) || typeof r.isStarter !== 'boolean') { invalid = true; continue; }
    seen.add(key);
    team.points += r.points;
    if (r.isStarter) { team.starterPoints += r.points; team.starts++; }
    if (!team.weeks.includes(r.week)) team.weeks.push(r.week);
    const set = covered.get(r.rosterId) ?? new Set<string>(); set.add(r.playerId); covered.set(r.rosterId, set);
  }
  for (const team of totals) { team.coveredPicks = covered.get(team.rosterId)?.size ?? 0; team.weeks.sort((a,b) => a-b); }
  // Sparse weekly scores do not prove inactivity. Never rank teams with differing/missing coverage.
  const complete = !invalid && totals.length > 1 && finals.size > 0 && new Set(picks.map(p => p.playerId)).size === picks.length && totals.every(t => t.coveredPicks > 0 && picks.filter(p => p.rosterId === t.rosterId).every(p => p.playerId && [...finals].every(week => seen.has(`${week}:${t.rosterId}:${p.playerId}`))));
  if (complete) for (const t of totals) t.rank = 1 + totals.filter(o => o.starterPoints > t.starterPoints + 0.000001).length;
  return { state: complete ? 'ready' : totals.some(t => t.coveredPicks) ? 'partial' : 'unavailable', teams: totals, coverage: 'Recorded final-week scores only. Starter contribution follows actual lineup usage on the original drafting team. Missing rows are unavailable, not zero. Traded-away production, roster moves and draft cost are not an overall decision-quality grade.' };
}
