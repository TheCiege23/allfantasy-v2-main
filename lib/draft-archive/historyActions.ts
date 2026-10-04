'use server';
import { requireAuth } from '@/lib/auth-guard';
import { isElevatedCommissioner } from '@/server/services/permissionService';
import { consumeRateLimit } from '@/lib/rate-limit';
import { reconciliationSources, reconciliationPreview, applyReconciliation } from './reconciliation';
import { captureImportedResults } from './importedResults';
async function gate(leagueId: string, key: string) {
  const auth = await requireAuth();
  if (!auth.ok || typeof leagueId !== 'string' || !leagueId || leagueId.length > 64 || typeof key !== 'string' || !key || key.length > 200) return null;
  const limit = consumeRateLimit({ scope: 'core', action: 'draft_history_review', sleeperUsername: auth.userId, maxRequests: 6, windowMs: 60000 });
  return limit.success && await isElevatedCommissioner(leagueId, auth.userId) ? auth.userId : null;
}
export async function listHistorySources(leagueId: string, key: string) {
  if (!await gate(leagueId, key)) return { ok: false as const };
  try { const data = await reconciliationSources(leagueId, key); return { ok: true as const, drafts: data.drafts.map(d => ({ id: d.draft_id, type: d.type, status: d.status, start: d.start_time ?? null })), unresolved: data.facts.length }; } catch { return { ok: false as const }; }
}
export async function refreshHistoricalResults(leagueId: string, key: string) {
  if (!await gate(leagueId,key)) return {ok:false as const};
  try { return {ok:true as const,...await captureImportedResults(leagueId,key)}; } catch { return {ok:false as const}; }
}
export async function previewHistorySource(leagueId: string, key: string, sourceId: string) {
  if (!await gate(leagueId, key) || typeof sourceId !== 'string' || !/^\d{1,30}$/.test(sourceId)) return { ok: false as const };
  try { const data = await reconciliationPreview(leagueId, key, sourceId); return { ok: true as const, digest: data.digest, count: data.updates.length, total: data.total, picks: data.updates.slice(0, 10).map(u => ({ overall: u.fact.pickNumber, round: u.fact.round, playerId: u.fact.playerId })) }; } catch { return { ok: false as const }; }
}
export async function confirmHistorySource(leagueId: string, key: string, sourceId: string, digest: string, reason: string) {
  const userId = await gate(leagueId, key);
  if (!userId || typeof sourceId !== 'string' || !/^\d{1,30}$/.test(sourceId) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest) || typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 500) return { ok: false as const };
  try { return { ok: true as const, count: await applyReconciliation(leagueId, key, sourceId, digest, userId, reason.trim()) }; } catch { return { ok: false as const }; }
}
