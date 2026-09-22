import 'server-only'

import {
  getDeepSeekConfigFromEnv,
  getOpenAIConfigFromEnv,
  getXaiConfigFromEnv,
} from '@/lib/provider-config'
import { classifyProviderFailure, type ProviderFailureKind } from '@/lib/ai-orchestration/providerOutageAlert'
import { redactAndCap } from '@/lib/security/redactSecrets'

/**
 * CAN EACH AI PROVIDER ACTUALLY ANSWER — measured, not inferred from a key being set.
 *
 * 🛑 THE READINESS PANEL SAID "READY" WHILE TWO OF THREE PROVIDERS WERE DEAD. Measured
 * 2026-09-22: OpenAI 429 `billing_not_active`, xAI 403 "used all available credits", DeepSeek
 * the only one answering. The panel had no AI-provider row at all, and the admin system-health
 * check (`SystemHealthResolver`) calls `/v1/models` WITHOUT a key and counts the 401 as
 * "active" — so it reports a provider healthy whatever state its account is in.
 *
 * ⚠ ONLY A COMPLETION TELLS YOU. A models list, an api-key endpoint and a "key is set" check
 * all return success on an account that cannot answer a single question; the billing error
 * arrives only on a real request. So this sends one, capped at 1 output token.
 *
 * This is a live provider health probe — the one permanent reason CLAUDE.md allows a request
 * path to call a provider. It is cached for PROBE_TTL_MS so an admin page reload costs nothing,
 * never logs or returns a key, and redacts every provider message before it leaves.
 */

export type AiProviderId = 'openai' | 'xai' | 'deepseek'
export type AiProviderProbeState = 'answering' | ProviderFailureKind | 'not_configured' | 'unreachable'

export type AiProviderProbeResult = {
  id: AiProviderId
  label: string
  state: AiProviderProbeState
  model: string | null
  httpStatus: number | null
  /** Redacted provider message, when it failed. */
  detail: string | null
  checkedAt: string
}

const PROBE_TTL_MS = 10 * 60 * 1000
const PROBE_TIMEOUT_MS = 8000

type Fetch = typeof fetch
let cache: { at: number; results: AiProviderProbeResult[] } | null = null
let inflight: Promise<AiProviderProbeResult[]> | null = null
let fetchImpl: Fetch = (...args) => fetch(...args)

const PROVIDERS: Array<{ id: AiProviderId; label: string; config: () => { apiKey: string; baseUrl: string; model: string } | null }> = [
  { id: 'openai', label: 'OpenAI', config: getOpenAIConfigFromEnv },
  { id: 'xai', label: 'xAI (Grok)', config: getXaiConfigFromEnv },
  { id: 'deepseek', label: 'DeepSeek', config: getDeepSeekConfigFromEnv },
]

async function probeOne(p: (typeof PROVIDERS)[number], now: Date): Promise<AiProviderProbeResult> {
  const base = { id: p.id, label: p.label, checkedAt: now.toISOString() }
  const cfg = p.config()
  if (!cfg) return { ...base, state: 'not_configured', model: null, httpStatus: null, detail: null }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetchImpl(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
      signal: ctrl.signal,
    })
    if (res.ok) return { ...base, state: 'answering', model: cfg.model, httpStatus: res.status, detail: null }
    const text = await res.text().catch(() => '')
    const kind = classifyProviderFailure(res.status, text)
    return {
      ...base,
      state: kind,
      model: cfg.model,
      httpStatus: res.status,
      /* Redacted, and the key itself is scrubbed explicitly in case a provider echoes it. */
      detail: redactAndCap(text.split(cfg.apiKey).join('[REDACTED]'), 200) || null,
    }
  } catch (err) {
    return {
      ...base,
      state: 'unreachable',
      model: cfg.model,
      httpStatus: null,
      detail: err instanceof Error && err.name === 'AbortError' ? `timed out after ${PROBE_TIMEOUT_MS}ms` : 'network error',
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Probe every AI provider, at most once per PROBE_TTL_MS per process. Never throws.
 * Concurrent callers share one probe rather than each sending their own.
 */
export async function probeAiProviders(opts: { now?: Date; force?: boolean } = {}): Promise<AiProviderProbeResult[]> {
  const now = opts.now ?? new Date()
  if (!opts.force && cache && now.getTime() - cache.at < PROBE_TTL_MS) return cache.results
  if (inflight) return inflight
  inflight = Promise.all(PROVIDERS.map((p) => probeOne(p, now)))
    .then((results) => {
      cache = { at: now.getTime(), results }
      return results
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Test seam: clears the cache and swaps the network. */
export function __resetAiProviderProbeForTests(f: Fetch | null = null): void {
  cache = null
  inflight = null
  fetchImpl = f ?? ((...args) => fetch(...args))
}
