import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { draftArchiveCatalog } from './catalog';
import { normalizePickNumber } from '@/lib/league-import/sleeper/sleeperDraftPickIdentity';
import { sleeperDraftArchiveMetadata } from '@/lib/league-import/sleeper/draftArchiveMetadata';
import type { SleeperLeague } from '@/lib/sleeper-client';
type ProviderDraft = { draft_id: string; league_id: string; type: string; status: string; start_time?: number };
type ProviderPick = { draft_id: string; round: number; pick_no: number; player_id: string };
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
async function read(path: string) {
  const response = await fetch('https://api.sleeper.app/v1/' + path, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
  if (!response.ok) throw new Error('Historical provider unavailable');
  return await response.json() as unknown;
}
/** Call only after the action's commissioner gate. No provider reads during page rendering. */
export async function reconciliationSources(leagueId: string, key: string) {
  const catalog = await draftArchiveCatalog([leagueId], { key, limit: 1 });
  const choice = catalog.choices[0];
  if (!choice || choice.source !== 'legacy' || choice.sport !== 'NFL' || !choice.season) throw new Error('Choose an unresolved NFL archive');
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, platformLeagueId: true } });
  if (league?.platform?.toLowerCase() !== 'sleeper' || !league.platformLeagueId || !/^\d+$/.test(league.platformLeagueId)) throw new Error('Unsupported provider');
  let id: string | null = league.platformLeagueId, season: SleeperLeague | null = null;
  const seen = new Set<string>();
  const deadline = Date.now() + 45000;
  for (let depth = 0; id && depth < 21; depth++) {
    if (Date.now() > deadline) throw new Error('Historical review time bound exceeded');
    if (!/^\d+$/.test(id) || seen.has(id)) throw new Error('Invalid historical chain');
    seen.add(id);
    const raw = await read('league/' + id);
    if (object(raw).league_id !== id) throw new Error('Unverified historical league');
    const value = raw as SleeperLeague;
    if (Number(value.season) === choice.season) { season = value; break; }
    id = value.previous_league_id ?? null;
  }
  if (!season) throw new Error('Historical season unavailable');
  const raw = await read('league/' + season.league_id + '/drafts');
  if (!Array.isArray(raw) || raw.length > 20) throw new Error('Historical source bound exceeded');
  const drafts = raw as ProviderDraft[];
  if (drafts.some(d => !/^\d+$/.test(d.draft_id) || d.league_id !== season!.league_id)) throw new Error('Unverified source draft');
  const facts = await prisma.draftFact.findMany({ where: { leagueId, sport: choice.sport, season: choice.season }, orderBy: { draftId: 'asc' }, take: 10001 });
  if (facts.length > 10000) throw new Error('Archive bound exceeded');
  return { choice, season, drafts, facts: facts.filter(f => !object(f.metadata).sourceDraftId) };
}
export async function reconciliationPreview(leagueId: string, key: string, sourceId: string) {
  const scope = await reconciliationSources(leagueId, key);
  const draft = scope.drafts.find(d => d.draft_id === sourceId);
  if (!draft) throw new Error('Source is outside this league and season');
  const raw = await read('draft/' + sourceId + '/picks');
  if (!Array.isArray(raw) || raw.length > 10000 || (draft.status === 'complete' && !raw.length)) throw new Error('Source selections unavailable');
  const picks = raw as ProviderPick[];
  const factCounts = new Map<string, number>();
  for (const f of scope.facts) { const identity = `${f.round}:${f.pickNumber}:${f.playerId}`; factCounts.set(identity, (factCounts.get(identity) ?? 0) + 1); }
  const updates = scope.facts.flatMap(fact => {
    // Selecting a draft cannot distinguish duplicate local facts for one provider selection.
    if (factCounts.get(`${fact.round}:${fact.pickNumber}:${fact.playerId}`) !== 1) return [];
    const matches = picks.filter((pick, i) => pick.draft_id === sourceId && Number(pick.round) === fact.round && normalizePickNumber(pick, i + 1) === fact.pickNumber && pick.player_id === fact.playerId);
    if (matches.length !== 1) return [];
    const metadata = sleeperDraftArchiveMetadata({ sourceDraftId: sourceId, sourceLeagueId: scope.season.league_id, season: scope.choice.season!, draft, league: scope.season, pick: matches[0], tradedPicks: null, rosters: null, includeDraftSnapshot: true });
    return [{ fact, after: { ...object(fact.metadata), ...object(metadata), historyVerification: 'commissioner_verified' } }];
  }).slice(0, 50);
  const digest = createHash('sha256').update(JSON.stringify({ leagueId, key, sourceId, updates: updates.map(u => ({ id: u.fact.draftId, before: u.fact.metadata, after: u.after })) })).digest('hex');
  return { updates, digest, total: scope.facts.length, draft };
}
export async function applyReconciliation(leagueId: string, key: string, sourceId: string, digest: string, userId: string, reason: string) {
  const preview = await reconciliationPreview(leagueId, key, sourceId);
  if (preview.digest !== digest || !preview.updates.length) throw new Error('Preview changed; review again');
  return prisma.$transaction(async tx => {
    for (const update of preview.updates) {
      const result = await tx.draftFact.updateMany({ where: { leagueId, draftId: update.fact.draftId, metadata: { equals: update.fact.metadata === null ? Prisma.DbNull : update.fact.metadata as Prisma.InputJsonValue } }, data: { metadata: update.after as Prisma.InputJsonValue } });
      if (result.count !== 1) throw new Error('Historical record changed; review again');
    }
    await tx.leagueAuditLog.create({ data: { leagueId, userId, entityType: 'draft_history', entityId: sourceId, actionType: 'draft_history_reconciliation', beforeState: preview.updates.map(u => ({ draftId: u.fact.draftId, metadata: u.fact.metadata })) as Prisma.InputJsonValue, afterState: { sourceDraftId: sourceId, reason, verification: 'commissioner_verified', facts: preview.updates.map(u => ({ draftId: u.fact.draftId, metadata: u.after })) } as Prisma.InputJsonValue } });
    return preview.updates.length;
  }, { timeout: 15000 });
}
