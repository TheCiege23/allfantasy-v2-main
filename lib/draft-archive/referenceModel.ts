import type { PreparationContext } from '@/lib/core-app/draftPreparationModel'

export type DraftReference = {
  version: 'draft-reference-v1';
  kind: 'adp' | 'auction_price' | 'market_value';
  provider: 'AllFantasy' | 'Sleeper / RotoWire' | 'Stats Guy Fantasy';
  attributionUrl: string | null;
  observedAt: string;
  effectiveAt: string;
  historical: boolean;
  season: number | null;
  identitySpace: 'sleeper' | 'native';
  format: string;
  contextKey?: string;
  budget?: number;
  displayScope?: 'preparation_top100' | 'draft_selections';
  identityBasis?: 'draft_start_mapping' | 'current_verified_mapping' | 'provider_recorded_id';
  formatBasis?: 'frozen_draft_context' | 'observed_historical_season';
  entries: Array<{ playerId: string; name: string; position: string; value: number; sample: number | null; low?: number; high?: number; draftedOverall?: number; difference?: number }>;
}
export const marketFormat = (context: PreparationContext) => {
  if (context.sport !== 'NFL' || !['dynasty', 'redraft'].includes(context.leagueType) || context.playerPool !== 'all') return null;
  const quarterbacks = context.rosterSlots.filter(s => ['QB', 'SUPER_FLEX', 'SUPERFLEX', 'SF', 'OP'].includes(s)).length;
  return `${quarterbacks > 1 ? 'sf' : 'non_sf'}_${context.leagueType === 'dynasty' ? 'dynasty' : 'redraft'}`;
}
export function referenceAdpKey(context: PreparationContext): string | null {
  if (context.sport !== 'NFL' || context.draftType === 'auction' || context.playerPool !== 'all') return null;
  if (/rookie/i.test(context.purpose)) return 'adp_rookie';
  if (!marketFormat(context) || !['ppr', 'half_ppr', 'half-ppr', 'std', 'standard'].includes(context.scoring)) return null;
  const sf = marketFormat(context)!.startsWith('sf_');
  if (context.leagueType === 'dynasty') return sf ? 'adp_dynasty_2qb' : context.scoring === 'ppr' ? 'adp_dynasty_ppr' : context.scoring === 'half_ppr' || context.scoring === 'half-ppr' ? 'adp_dynasty_half_ppr' : 'adp_dynasty_std';
  return sf ? 'adp_2qb' : context.scoring === 'ppr' ? 'adp_ppr' : context.scoring === 'half_ppr' || context.scoring === 'half-ppr' ? 'adp_half_ppr' : context.scoring === 'std' || context.scoring === 'standard' ? 'adp_std' : null;
}
export function validDraftReference(raw: unknown, cutoff: Date): DraftReference | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = raw as Partial<DraftReference>;
  if (s.version !== 'draft-reference-v1' || !['adp', 'auction_price', 'market_value'].includes(s.kind ?? '') ||
      !['AllFantasy', 'Sleeper / RotoWire', 'Stats Guy Fantasy'].includes(s.provider ?? '') ||
      !['sleeper', 'native'].includes(s.identitySpace ?? '') || typeof s.format !== 'string' ||
      typeof s.observedAt !== 'string' || typeof s.effectiveAt !== 'string' || !Array.isArray(s.entries) || s.entries.length > 5000) return null;
  if (typeof s.historical !== 'boolean' || !(s.season === null || (Number.isInteger(s.season) && s.season! >= 1900 && s.season! <= 2100)) ||
      (s.kind === 'adp' && (s.provider !== 'Sleeper / RotoWire' || s.identitySpace !== 'sleeper' || s.attributionUrl !== 'https://sleeper.com')) ||
      (s.kind === 'market_value' && (s.provider !== 'Stats Guy Fantasy' || s.identitySpace !== 'sleeper' || s.attributionUrl !== 'https://statsguyfantasy.com')) ||
      (s.kind === 'auction_price' && (s.provider !== 'AllFantasy' || s.identitySpace !== 'native' || s.attributionUrl !== null || !s.contextKey || !Number.isFinite(s.budget) || s.budget! <= 0))) return null;
  const effective = Date.parse(s.effectiveAt), observed = Date.parse(s.observedAt);
  if (!Number.isFinite(effective) || !Number.isFinite(observed) || effective > cutoff.getTime() || observed > Date.now()) return null;
  // Only the documented historical market API can prove a pre-cutoff value retrieved later.
  if (observed > cutoff.getTime() && !(s.provider === 'Stats Guy Fantasy' && s.kind === 'market_value' && s.historical === true)) return null;
  const seen = new Set<string>();
  for (const e of s.entries) {
    if (!e || typeof e.playerId !== 'string' || !e.playerId.trim() || seen.has(e.playerId) || typeof e.name !== 'string' || !e.name.trim() || typeof e.position !== 'string' || !e.position.trim() || !Number.isFinite(e.value) || e.value < 0 ||
        (s.kind === 'adp' && e.value <= 0) || (e.sample !== null && (!Number.isInteger(e.sample) || e.sample < 1))) return null;
    seen.add(e.playerId);
    if ((e.low !== undefined && (!Number.isFinite(e.low) || e.low < 0 || e.low > e.value)) || (e.high !== undefined && (!Number.isFinite(e.high) || e.high < e.value))) return null;
  }
  if (!s.entries.length) return null;
  return s as DraftReference;
}
