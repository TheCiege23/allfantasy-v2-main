export type ChimmyFeatureFlags = {
  intentChips: boolean
  assistantModes: boolean
  followups: boolean
  trustPanel: boolean
  dailyDigest: boolean
  voicePreview: boolean
  aiKpiEvents: boolean
  /**
   * Let the model CALL for grounding instead of only being handed it.
   *
   * ⚠ ON BY DEFAULT SINCE 2026-09-15, BY THE USER'S DECISION. It shipped off,
   * and the reason it was off still stands and is worth keeping in view: every
   * other answer path in this route assembles context up front and refuses when
   * it is missing, which is what makes the refusals trustworthy. This hands that
   * judgement to the model, costs up to MAX_TOOL_TURNS provider calls where the
   * spend rule charges for one, and is Grok-only.
   *
   * What makes the default safe rather than merely chosen:
   * - `canRunChimmyToolLoop` returns false with no XAI/GROK key or with spend
   *   disabled, and `runChimmyToolLoop` returns null on any provider failure or
   *   empty result — every one of those falls through to the push path exactly
   *   as before. Turning this on cannot break an answer; it can only change
   *   which path produces it.
   * - It runs AFTER the deterministic, refusal and league-grounding
   *   short-circuits (route.ts ~2238), so the paths that answer for free or
   *   refuse honestly are untouched.
   * - No tool takes a `leagueId`. The league comes from the session, or from
   *   `find_league_by_name` resolved server-side against leagues this user is
   *   demonstrably in.
   *
   * ⚠ WHAT TO WATCH, SINCE THIS IS THE PART NO GUARD COVERS: unit cost. One
   * charged message can now be up to four xAI round trips. If per-message spend
   * matters more than the answer quality this buys, `CHIMMY_TOOL_LOOP_ENABLED=0`
   * turns it off without a deploy of this file.
   */
  toolLoop: boolean
  /**
   * When we hold NO data for a sports question, ask live search instead of
   * dead-ending on the refusal.
   *
   * Off by default. The refusals are the most trustworthy thing in this route,
   * and this is the only path that answers past one — so it is gated on
   * citations at the provider boundary AND on this switch, and it never touches
   * league questions. Turning it on trades a guaranteed-honest non-answer for a
   * sourced one; that is a product decision, not a default.
   */
  liveSearchFallback: boolean
}

const DEFAULT_FLAGS: ChimmyFeatureFlags = {
  intentChips: true,
  assistantModes: true,
  followups: true,
  trustPanel: true,
  dailyDigest: false,
  voicePreview: false,
  aiKpiEvents: true,
  toolLoop: true,
  liveSearchFallback: true,
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback
  const normalized = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function readFlagValue(envKey: string, fallback: boolean): boolean {
  const raw = process.env[envKey] ?? process.env[`NEXT_PUBLIC_${envKey}`]
  return parseBoolean(raw, fallback)
}

export function getChimmyFeatureFlags(): ChimmyFeatureFlags {
  return {
    intentChips: readFlagValue('CHIMMY_INTENT_CHIPS_ENABLED', DEFAULT_FLAGS.intentChips),
    assistantModes: readFlagValue('CHIMMY_ASSISTANT_MODES_ENABLED', DEFAULT_FLAGS.assistantModes),
    followups: readFlagValue('CHIMMY_FOLLOWUPS_ENABLED', DEFAULT_FLAGS.followups),
    trustPanel: readFlagValue('CHIMMY_TRUST_PANEL_ENABLED', DEFAULT_FLAGS.trustPanel),
    dailyDigest: readFlagValue('CHIMMY_DAILY_DIGEST_ENABLED', DEFAULT_FLAGS.dailyDigest),
    voicePreview: readFlagValue('CHIMMY_VOICE_PREVIEW_ENABLED', DEFAULT_FLAGS.voicePreview),
    aiKpiEvents: readFlagValue('CHIMMY_AI_KPI_EVENTS_ENABLED', DEFAULT_FLAGS.aiKpiEvents),
    toolLoop: readFlagValue('CHIMMY_TOOL_LOOP_ENABLED', DEFAULT_FLAGS.toolLoop),
    liveSearchFallback: readFlagValue(
      'CHIMMY_LIVE_SEARCH_FALLBACK_ENABLED',
      DEFAULT_FLAGS.liveSearchFallback,
    ),
  }
}
