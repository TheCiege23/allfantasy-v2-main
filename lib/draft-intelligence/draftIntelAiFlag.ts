/**
 * `DRAFT_INTEL_AI_ENABLED`: the on/off switch for the AI-written copy in draft intelligence.
 *
 * ⚠ IT IS THE ONE AUTOMATIC ANTHROPIC SPENDER, AND IT HAD NO SWITCH OF ITS OWN. Every pick,
 * `publishDraftIntelForUpcomingManagers` asks a model for copy for each distinct manager among the
 * next six picks, so a 12-team, 15-round draft is on the order of 1,000 calls. It runs from the
 * per-minute draft-tick cron, the pick / controls / autopick routes and the draft-room stream, for
 * free and paid users alike. The only way to stop it was the global `AI_FEATURES_ENABLED` switch,
 * which also turns off Chimmy. Found 2026-09-28 while tracing where the Anthropic credit went.
 *
 * Off means: the draft room keeps its deterministic recommendations and queue, and only the
 * model-written copy is skipped. That is exactly what already happens when no Anthropic key is set.
 *
 * DEFAULT ON. Unset keeps today's behaviour. Set `false`, `0`, `off` or `no` to stop it.
 */
export function isDraftIntelAiEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.DRAFT_INTEL_AI_ENABLED?.trim().toLowerCase()
  if (!raw) return true
  return !['false', '0', 'off', 'no'].includes(raw)
}
