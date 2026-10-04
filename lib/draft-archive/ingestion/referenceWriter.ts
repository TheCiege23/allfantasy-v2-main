import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { preparationFormatKey, type PreparationContext } from '@/lib/core-app/draftPreparationModel';
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
import { validDraftReference, type DraftReference } from '../referenceModel';
import { referenceStorageKey } from '../references';

export async function preserveReference(formatKey: string, snapshot: DraftReference, apply: boolean) {
  if (!validDraftReference(snapshot, new Date())) throw new Error('Invalid or future reference');
  const fingerprint = createHash('sha256').update(JSON.stringify({ ...snapshot, entries: [...snapshot.entries].sort((a,b) => a.playerId.localeCompare(b.playerId)), observedAt: undefined })).digest('hex');
  if (apply) await prisma.aiAdpSnapshotHistory.upsert({ where: { id: 'hqr-' + fingerprint.slice(0, 40) }, update: {}, create: {
    id: 'hqr-' + fingerprint.slice(0, 40), sport: 'NFL', leagueType: 'draft_reference', formatKey: referenceStorageKey(formatKey),
    computedAt: new Date(snapshot.effectiveAt), snapshotData: snapshot as unknown as Prisma.InputJsonValue,
    totalDrafts: 0, totalPicks: snapshot.entries.length, runMeta: { source: snapshot.provider, kind: snapshot.kind, fingerprint },
  } });
  return snapshot.entries.length;
}

export async function syncMarketReferences(date: string, apply: boolean, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date || date >= now.toISOString().slice(0, 10) || date < '2025-09-01') throw new Error('A supported, completed UTC day is required');
  const report = { stored: 0, entries: 0, failed: 0, unavailable: 0 };
  for (const format of ['sf_dynasty', 'non_sf_dynasty', 'sf_redraft', 'non_sf_redraft']) {
    try {
      // One request per format/day. No league, account or roster data is sent to the vendor.
      const exists = await prisma.aiAdpSnapshotHistory.findFirst({ where: { leagueType: 'draft_reference', formatKey: referenceStorageKey('sgf:' + format), computedAt: { gte: new Date(date + 'T00:00:00Z'), lte: new Date(date + 'T23:59:59.999Z') } }, select: { id: true } });
      if (exists) continue;
      const response = await fetch(`https://api.statsguyfantasy.com/api/v1/rankings?format=${format}&date=${date}&limit=1000`, { headers: { 'User-Agent': 'AllFantasy/1.0 (+https://www.allfantasy.ai)' }, signal: AbortSignal.timeout(8000), cache: 'no-store' });
      if (!response.ok) { report.failed++; if (response.status === 429) break; continue; }
      const payload = object(await response.json());
      if (payload.format !== format || !Array.isArray(payload.rankings) || payload.rankings.length !== payload.total || payload.rankings.length > 1000 || typeof payload.asOf !== 'string') throw new Error('Incomplete source board');
      if (!payload.rankings.length) { report.unavailable++; continue; }
      // Historical API dates have day precision. The end of that day is the conservative cutoff.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.asOf) || payload.asOf > date || !Number.isFinite(Date.parse(payload.asOf)) || new Date(payload.asOf).toISOString().slice(0,10) !== payload.asOf || Date.parse(date) - Date.parse(payload.asOf) > 14 * 86400000) throw new Error('Unverified source date');
      const snapshot: DraftReference = {
        version: 'draft-reference-v1', kind: 'market_value', provider: 'Stats Guy Fantasy', attributionUrl: 'https://statsguyfantasy.com',
        observedAt: now.toISOString(), effectiveAt: payload.asOf + 'T23:59:59.999Z', historical: true,
        season: format.endsWith('redraft') ? Number(payload.asOf.slice(0, 4)) : null, identitySpace: 'sleeper', format,
        entries: payload.rankings.map(raw => { const row = object(raw); return { playerId: String(row.id ?? ''), name: String(row.name ?? ''), position: String(row.position ?? ''), value: Number(row.value), sample: null }; }),
      };
      report.entries += await preserveReference('sgf:' + format, snapshot, apply); report.stored++;
    } catch { report.failed++; }
  }
  return report;
}

export function auctionPriceReferences(rows: Array<{ playerId: string | null; playerName: string; position: string; amount: number | null; pickMetadata: unknown; sessionId: string }>, at: Date) {
  const groups = new Map<string, { context: PreparationContext; budget: number; values: Map<string, { name: string; position: string; prices: number[]; sessions: Set<string> }> }>();
  for (const row of rows) {
    const metadata = object(row.pickMetadata), archive = object(metadata.archive), context = object(archive.context) as unknown as PreparationContext;
    const budget = metadata.auctionBudgetPerTeam;
    if (typeof archive.eventId !== 'string' || context.draftType !== 'auction' || context.sport !== 'NFL' || !Array.isArray(context.rosterSlots) || typeof budget !== 'number' || budget <= 0 || !row.playerId || row.amount == null || !Number.isFinite(row.amount) || row.amount <= 0 || row.amount > budget) continue;
    const key = `auction:${preparationFormatKey(context)}:${budget}`;
    let group = groups.get(key);
    if (!group) { group = { context, budget, values: new Map() }; groups.set(key, group); }
    let value = group.values.get(row.playerId);
    if (!value) { value = { name: row.playerName, position: row.position, prices: [], sessions: new Set() }; group.values.set(row.playerId, value); }
    if (value.sessions.has(row.sessionId)) continue;
    value.sessions.add(row.sessionId); value.prices.push(row.amount);
  }
  return [...groups].map(([formatKey, group]) => ({ formatKey, snapshot: {
    version: 'draft-reference-v1', kind: 'auction_price', provider: 'AllFantasy', attributionUrl: null,
    observedAt: at.toISOString(), effectiveAt: at.toISOString(), historical: false, season: group.context.season,
    identitySpace: 'native', format: 'auction', contextKey: preparationFormatKey(group.context), budget: group.budget,
    entries: [...group.values].map(([playerId, v]) => ({ playerId, name: v.name, position: v.position, value: v.prices.reduce((a, b) => a + b, 0) / v.prices.length, sample: v.prices.length, low: Math.min(...v.prices), high: Math.max(...v.prices) })),
  } satisfies DraftReference }));
}

export async function captureCachedReferences(apply: boolean, at = new Date()) {
  const report = { boards: 0, entries: 0, auctionPicks: 0 };
  const boards = await prisma.sportsDataCache.findMany({ where: { cacheKey: { startsWith: 'projections:season:v1:' } }, take: 25, select: { data: true } });
  for (const board of boards) {
    const data = object(board.data), season = Number(data.season);
    if (!Number.isInteger(season) || season !== at.getUTCFullYear()) continue;
    const players = Object.values(object(data.players)).map(object);
    if (players.length > 5000) continue;
    for (const format of ['adp_std', 'adp_half_ppr', 'adp_ppr', 'adp_2qb', 'adp_dynasty_std', 'adp_dynasty_half_ppr', 'adp_dynasty_ppr', 'adp_dynasty_2qb', 'adp_rookie']) {
      const entries = players.flatMap(player => { const value = object(player.adp)[format]; return typeof value === 'number' && value > 0 && value < 999 && typeof player.playerId === 'string' ? [{ playerId: player.playerId, name: String(player.name ?? ''), position: String(player.position ?? ''), value, sample: null }] : []; });
      if (!entries.length) continue;
      const snapshot: DraftReference = { version: 'draft-reference-v1', kind: 'adp', provider: 'Sleeper / RotoWire', attributionUrl: 'https://sleeper.com', observedAt: at.toISOString(), effectiveAt: at.toISOString(), historical: false, season, identitySpace: 'sleeper', format, entries };
      report.entries += await preserveReference(`sleeper:${season}:${format}`, snapshot, apply); report.boards++;
    }
  }
  const auction = await prisma.draftPick.findMany({ where: { session: { sessionKind: 'live', sleeperDraftId: null, status: 'completed', draftType: 'auction' }, source: { notIn: ['test_seed', 'keeper', 'undone', 'corrected'] } }, take: 10001, select: { playerId: true, playerName: true, position: true, amount: true, pickMetadata: true, sessionId: true } });
  if (auction.length > 10000) throw new Error('Auction observation bound exceeded');
  report.auctionPicks = auction.length;
  for (const group of auctionPriceReferences(auction, at)) { report.entries += await preserveReference(group.formatKey, group.snapshot, apply); report.boards++; }
  return report;
}

/** Current ADP only: observation time is explicit; no historical provider timestamp is invented. */
export async function captureProviderAdp(apply: boolean, at = new Date()) {
  const season = at.getUTCFullYear(), report = { boards: 0, entries: 0, unavailable: false };
  const existing = await prisma.aiAdpSnapshotHistory.findFirst({ where: { sport: 'NFL', leagueType: 'draft_reference', formatKey: referenceStorageKey(`sleeper:${season}:adp_ppr`), computedAt: { gte: new Date(at.toISOString().slice(0,10) + 'T00:00:00Z') } }, select: { id: true } });
  if (existing) return report;
  const positions = ['QB','RB','WR','TE','K','DEF','DL','LB','DB'].map(p => 'position[]=' + p).join('&');
  const response = await fetch(`https://api.sleeper.com/projections/nfl/${season}?season_type=regular&${positions}`, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
  if (!response.ok) return { ...report, unavailable: true };
  const raw: unknown = await response.json();
  if (!Array.isArray(raw) || !raw.length || raw.length > 10000) throw new Error('Invalid ADP board');
  for (const format of ['adp_std', 'adp_half_ppr', 'adp_ppr', 'adp_2qb', 'adp_dynasty_std', 'adp_dynasty_half_ppr', 'adp_dynasty_ppr', 'adp_dynasty_2qb', 'adp_rookie']) {
    const entries = raw.flatMap(value => {
      const row = object(value), player = object(row.player), v = object(row.stats)[format];
      const name = [player.first_name,player.last_name].filter(p => typeof p === 'string').join(' ').trim();
      return typeof row.player_id === 'string' && typeof v === 'number' && v > 0 && v < 999 && name && typeof player.position === 'string' ? [{ playerId: row.player_id, name, position: player.position, value: v, sample: null }] : [];
    });
    if (!entries.length) continue;
    report.entries += await preserveReference(`sleeper:${season}:${format}`, { version: 'draft-reference-v1',kind:'adp',provider:'Sleeper / RotoWire',attributionUrl:'https://sleeper.com',observedAt:at.toISOString(),effectiveAt:at.toISOString(),historical:false,season,identitySpace:'sleeper',format,entries }, apply);
    report.boards++;
  }
  report.unavailable = report.boards === 0;
  return report;
}
