/**
 * Cost-aware provider profiles for the AI router.
 *
 * cheap    — simple Q&A, short summaries, quick Chimmy replies
 * standard — Explain My Bracket, deeper fantasy analysis
 * premium  — Commissioner Brain, long strategy / recap tasks
 *
 * Model selection reads from env vars so you can tune per-provider without
 * code changes. Falls back to reasonable defaults for each provider.
 */

export type ProviderProfile = 'cheap' | 'standard' | 'premium'

// ── OpenAI ────────────────────────────────────────────────────────────────────

const OPENAI_DEFAULTS: Record<ProviderProfile, string> = {
  cheap:    'gpt-4o-mini',
  standard: 'gpt-4o',
  premium:  'gpt-4o',
}

export function resolveOpenAIModel(profile: ProviderProfile): string {
  if (profile === 'cheap') {
    return process.env.OPENAI_MODEL_CHEAP?.trim() || OPENAI_DEFAULTS.cheap
  }
  if (profile === 'premium') {
    return process.env.OPENAI_MODEL_PREMIUM?.trim() || OPENAI_DEFAULTS.premium
  }
  return (
    process.env.OPENAI_MODEL_STANDARD?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    OPENAI_DEFAULTS.standard
  )
}

// ── Anthropic ─────────────────────────────────────────────────────────────────

// Verified against the account's own /v1/models listing on 2026-08-27
// (`npm run ai:models`). `claude-opus-5` is also available and is the natural
// premium upgrade, but is left opt-in via ANTHROPIC_MODEL_PREMIUM because it
// costs materially more per call than Sonnet.
const ANTHROPIC_DEFAULTS: Record<ProviderProfile, string> = {
  cheap:    'claude-haiku-4-5-20251001',
  standard: 'claude-sonnet-5',
  premium:  'claude-sonnet-5',
}

export function resolveAnthropicModel(profile: ProviderProfile): string {
  if (profile === 'cheap') {
    return (
      process.env.ANTHROPIC_MODEL_CHEAP?.trim() ||
      process.env.ANTHROPIC_MODEL_QUICKASK?.trim() ||
      ANTHROPIC_DEFAULTS.cheap
    )
  }
  if (profile === 'premium') {
    return (
      process.env.ANTHROPIC_MODEL_PREMIUM?.trim() ||
      process.env.ANTHROPIC_MODEL_DEEP?.trim() ||
      ANTHROPIC_DEFAULTS.premium
    )
  }
  return (
    process.env.ANTHROPIC_MODEL_STANDARD?.trim() ||
    process.env.ANTHROPIC_MODEL_SPECIALIST?.trim() ||
    ANTHROPIC_DEFAULTS.standard
  )
}

// ── xAI ───────────────────────────────────────────────────────────────────────

// Verified against the account's own /v1/models listing on 2026-08-27.
// The previous default here was `grok-2-latest`, which no longer exists — the
// Grok 2 and 3 families are retired and `grok-4` itself retired 2026-08-15, so
// every xAI call was returning a bare 400. Pin real model ids, not moving
// `-latest` aliases, so a vendor retirement surfaces as a failed smoke test
// rather than silent breakage in production.
const XAI_DEFAULTS: Record<ProviderProfile, string> = {
  cheap:    'grok-4.3',
  standard: 'grok-4.5',
  premium:  'grok-4.6',
}

export function resolveXaiModel(profile: ProviderProfile): string {
  const explicit = process.env.XAI_MODEL?.trim() || process.env.GROK_MODEL?.trim()
  if (explicit) return explicit
  return XAI_DEFAULTS[profile] ?? XAI_DEFAULTS.standard
}

// ── DeepSeek ──────────────────────────────────────────────────────────────────

// `deepseek-chat` still resolves as a legacy alias but is absent from the
// account's model listing, so it is undocumented surface that can disappear
// without notice. Pin the published ids instead.
const DEEPSEEK_DEFAULTS: Record<ProviderProfile, string> = {
  cheap:    'deepseek-v4-flash',
  standard: 'deepseek-v4-flash',
  premium:  'deepseek-v4-pro',
}

export function resolveDeepSeekModel(profile: ProviderProfile): string {
  const explicit = process.env.DEEPSEEK_MODEL?.trim()
  if (explicit) return explicit
  return DEEPSEEK_DEFAULTS[profile] ?? DEEPSEEK_DEFAULTS.standard
}
