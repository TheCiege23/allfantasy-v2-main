/**
 * AIConsistencyGuard — product-level guardrails so AI feels unified and trustworthy.
 * Delegates to unified-ai fact guard; adds product-level rules (deterministic-first, no invented claims).
 */

/**
 * Product-level rules every AI surface should respect.
 * Use in prompts or as a checklist; actual enforcement is in lib/unified-ai/AIFactGuard and orchestration.
 */
const AI_PRODUCT_CONSISTENCY_RULES = [
  'Deterministic-first: use engine/output numbers as source of truth; do not override with model opinion.',
  'Fact-grounded: only state what is supported by provided data or deterministic payload.',
  'No invented claims: no fake stats, no made-up fairness scores, no vibes-only advice.',
  'Sport and league aware: respect sport (NFL, NHL, NBA, MLB, NCAAB, NCAAF, Soccer) and league context.',
  'Confidence when justified: show confidence only when data supports it; avoid overstating certainty.',
] as const;

const DETERMINISTIC_FIRST_FEATURES = new Set<string>([
  'trade_analyzer',
  'trade_evaluator',
  'waiver_ai',
  'rankings',
  'draft_helper',
  'graph_insight',
  'simulation',
  'matchup',
  'psychological',
  'psychological_profiles',
  'legacy_score',
  'reputation',
  'rivalries',
  'awards',
  'record_book',
  'career_prestige',
  'xp_explain',
  'gm_economy_explain',
  'bracket_intelligence',
]);

/**
 * Short preamble for product docs or debug (not for model prompts; use ChimmyPromptStyleResolver / buildDomainGuard for that).
 */
export function getAIConsistencyPreamble(): string {
  return AI_PRODUCT_CONSISTENCY_RULES.join(' ');
}

/**
 * Whether a feature type should enforce deterministic-first (tool AI that has engine output).
 */
export function shouldEnforceDeterministicFirst(featureType: string): boolean {
  return DETERMINISTIC_FIRST_FEATURES.has(featureType);
}

export function getDeterministicFirstFeatureTypes(): readonly string[] {
  return Array.from(DETERMINISTIC_FIRST_FEATURES);
}
