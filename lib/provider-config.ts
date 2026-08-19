/**
 * PROMPT 151 — Centralized API key and provider config.
 * Server-side only. Never log or expose secret values.
 *
 * Canonical env keys:
 * - OPENAI_API_KEY
 * - DEEPSEEK_API_KEY
 * - XAI_API_KEY
 * - CLEARSPORTS_API_KEY
 */

import { type SupportedSport } from '@/lib/sport-scope'
import { ROLLING_INSIGHTS_SPORTS } from '@/lib/workers/api-config'

const OPENAI_KEY_KEYS = ['OPENAI_API_KEY', 'AI_INTEGRATIONS_OPENAI_API_KEY'] as const
const OPENAI_BASE_URL_KEYS = ['OPENAI_BASE_URL', 'AI_INTEGRATIONS_OPENAI_BASE_URL'] as const

const DEEPSEEK_KEY_KEYS = ['DEEPSEEK_API_KEY'] as const
const DEEPSEEK_BASE_URL_KEYS = ['DEEPSEEK_BASE_URL'] as const
const DEEPSEEK_MODEL_KEYS = ['DEEPSEEK_MODEL'] as const

const XAI_KEY_KEYS = ['XAI_API_KEY', 'GROK_API_KEY'] as const
const XAI_BASE_URL_KEYS = ['XAI_BASE_URL', 'GROK_BASE_URL'] as const
const XAI_MODEL_KEYS = ['XAI_MODEL', 'GROK_MODEL'] as const

const CLEARSPORTS_KEY_KEYS = ['CLEARSPORTS_API_KEY', 'CLEAR_SPORTS_API_KEY', 'CLEARSPORTS_KEY'] as const
const CLEARSPORTS_BASE_URL_KEYS = [
  'CLEARSPORTS_API_BASE',
  'CLEAR_SPORTS_API_BASE',
  'CLEARSPORTS_BASE_URL',
  'CLEAR_SPORTS_BASE_URL',
] as const
const DEFAULT_CLEARSPORTS_BASE_URL = 'https://api.clearsportsapi.com/api/v1'

const ROLLING_INSIGHTS_API_KEY_KEYS = ['ROLLING_INSIGHTS_API_KEY', 'ROLLINGINSIGHTS_API_KEY'] as const
const ROLLING_INSIGHTS_CLIENT_ID_KEYS = ['ROLLING_INSIGHTS_CLIENT_ID'] as const
const ROLLING_INSIGHTS_CLIENT_SECRET_KEYS = ['ROLLING_INSIGHTS_CLIENT_SECRET'] as const
const ROLLING_INSIGHTS_CLIENT_ID2_KEYS = ['ROLLING_INSIGHTS_CLIENT_ID2'] as const
const ROLLING_INSIGHTS_CLIENT_SECRET2_KEYS = ['ROLLING_INSIGHTS_CLIENT_SECRET2'] as const
const ROLLING_INSIGHTS_BASE_URL_KEYS = ['ROLLING_INSIGHTS_BASE_URL', 'ROLLING_INSIGHTS_API_BASE'] as const
/**
 * Probed 2026-08-10: `https://datafeeds.rolling-insights.com` (the previous
 * default) 404s on EVERY path and every path ordering. The live DataFeeds REST
 * host is `rest.datafeeds.rolling-insights.com` under `/api/v1`, authenticated
 * with `?RSC_token=`.
 *
 * The api-chain provider survived the wrong default only because
 * `buildRestBaseCandidates()` appends `DEFAULT_RI_REST_BASES`, which already
 * carried the correct host — so this was a latent trap that made the config
 * lie rather than an active outage. It still governs the api_key branch and is
 * what anyone reading provider config would believe, so it is corrected here.
 */
const DEFAULT_ROLLING_INSIGHTS_BASE_URL = 'https://rest.datafeeds.rolling-insights.com/api/v1'

interface ResolvedEnvValue {
  value: string
  keyUsed: string | null
}

function trim(value: string | undefined): string {
  return (value ?? '').trim()
}

function mask(value: string): string {
  return value ? 'set' : 'unset'
}

function resolveFirstEnv(keys: readonly string[]): ResolvedEnvValue {
  for (const key of keys) {
    const value = trim(process.env[key])
    if (value) return { value, keyUsed: key }
  }
  return { value: '', keyUsed: null }
}

function normalizeBaseUrl(value: string, fallback: string): string {
  const raw = trim(value) || fallback
  return raw.replace(/\/+$/, '')
}

function normalizeXaiBaseUrl(value: string): string {
  const normalized = normalizeBaseUrl(value, 'https://api.x.ai/v1')
  return normalized
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/responses$/i, '')
}

function getRollingInsightsEnabledSports(): Record<SupportedSport, boolean> {
  return {
    NFL: ROLLING_INSIGHTS_SPORTS.NFL,
    NHL: ROLLING_INSIGHTS_SPORTS.NHL,
    NBA: ROLLING_INSIGHTS_SPORTS.NBA,
    MLB: ROLLING_INSIGHTS_SPORTS.MLB,
    NCAAF: ROLLING_INSIGHTS_SPORTS.NCAAF,
    NCAAB: ROLLING_INSIGHTS_SPORTS.NCAAB,
    SOCCER: ROLLING_INSIGHTS_SPORTS.SOCCER,
  }
}

// ----- OpenAI -----
export interface OpenAIProviderConfig {
  apiKey: string
  baseUrl: string
  model: string
  keySource: string
}

export function getOpenAIConfigFromEnv(): OpenAIProviderConfig | null {
  const apiKey = resolveFirstEnv(OPENAI_KEY_KEYS)
  if (!apiKey.value) return null
  const baseUrlRaw = resolveFirstEnv(OPENAI_BASE_URL_KEYS)
  const baseUrl = normalizeBaseUrl(baseUrlRaw.value, 'https://api.openai.com/v1')
  const model = resolveFirstEnv(['OPENAI_MODEL']).value || 'gpt-4o'
  return {
    apiKey: apiKey.value,
    baseUrl,
    model,
    keySource: apiKey.keyUsed ?? OPENAI_KEY_KEYS[0],
  }
}

export function isOpenAIAvailable(): boolean {
  return !!getOpenAIConfigFromEnv()
}

// ----- DeepSeek -----
export interface DeepSeekProviderConfig {
  apiKey: string
  baseUrl: string
  model: string
  keySource: string
}

export function getDeepSeekConfigFromEnv(): DeepSeekProviderConfig | null {
  const apiKey = resolveFirstEnv(DEEPSEEK_KEY_KEYS)
  if (!apiKey.value) return null
  const baseUrl = normalizeBaseUrl(resolveFirstEnv(DEEPSEEK_BASE_URL_KEYS).value, 'https://api.deepseek.com/v1')
  const model = resolveFirstEnv(DEEPSEEK_MODEL_KEYS).value || 'deepseek-chat'
  return {
    apiKey: apiKey.value,
    baseUrl,
    model,
    keySource: apiKey.keyUsed ?? DEEPSEEK_KEY_KEYS[0],
  }
}

export function isDeepSeekAvailable(): boolean {
  return !!getDeepSeekConfigFromEnv()
}

// ----- xAI / Grok -----
export interface XaiProviderConfig {
  apiKey: string
  baseUrl: string
  model: string
  keySource: string
}

export function getXaiConfigFromEnv(): XaiProviderConfig | null {
  const apiKey = resolveFirstEnv(XAI_KEY_KEYS)
  if (!apiKey.value) return null
  const baseUrl = normalizeXaiBaseUrl(resolveFirstEnv(XAI_BASE_URL_KEYS).value)
  const model = resolveFirstEnv(XAI_MODEL_KEYS).value || 'grok-2-latest'
  return {
    apiKey: apiKey.value,
    baseUrl,
    model,
    keySource: apiKey.keyUsed ?? XAI_KEY_KEYS[0],
  }
}

export function isXaiAvailable(): boolean {
  return !!getXaiConfigFromEnv()
}

// ----- ClearSports -----
export interface ClearSportsProviderConfig {
  apiKey: string
  baseUrl: string
  keySource: string
}

export function getClearSportsConfigFromEnv(): ClearSportsProviderConfig | null {
  const apiKey = resolveFirstEnv(CLEARSPORTS_KEY_KEYS)
  const baseUrlRaw = resolveFirstEnv(CLEARSPORTS_BASE_URL_KEYS)
  const baseFallback = apiKey.value ? DEFAULT_CLEARSPORTS_BASE_URL : ''
  const baseUrl = normalizeBaseUrl(baseUrlRaw.value, baseFallback)
  if (!apiKey.value || !baseUrl) return null
  return {
    apiKey: apiKey.value,
    baseUrl,
    keySource: apiKey.keyUsed ?? CLEARSPORTS_KEY_KEYS[0],
  }
}

export function isClearSportsAvailable(): boolean {
  return !!getClearSportsConfigFromEnv()
}

// ----- Rolling Insights -----
export interface RollingInsightsProviderConfig {
  authMode: 'api_key' | 'client_credentials'
  baseUrl: string
  keySource: string
  enabledSports: Record<SupportedSport, boolean>
}

export function getRollingInsightsConfigFromEnv(): RollingInsightsProviderConfig | null {
  const apiKey = resolveFirstEnv(ROLLING_INSIGHTS_API_KEY_KEYS)
  const clientId = resolveFirstEnv(ROLLING_INSIGHTS_CLIENT_ID_KEYS)
  const clientSecret = resolveFirstEnv(ROLLING_INSIGHTS_CLIENT_SECRET_KEYS)
  const clientId2 = resolveFirstEnv(ROLLING_INSIGHTS_CLIENT_ID2_KEYS)
  const clientSecret2 = resolveFirstEnv(ROLLING_INSIGHTS_CLIENT_SECRET2_KEYS)
  const baseUrl = normalizeBaseUrl(
    resolveFirstEnv(ROLLING_INSIGHTS_BASE_URL_KEYS).value,
    DEFAULT_ROLLING_INSIGHTS_BASE_URL
  )
  const enabledSports = getRollingInsightsEnabledSports()
  const hasPrimaryClientPair = !!clientId.value && !!clientSecret.value
  const hasSecondaryClientPair = !!clientId2.value && !!clientSecret2.value

  if (hasPrimaryClientPair || hasSecondaryClientPair) {
    const preferredKeySource = hasPrimaryClientPair
      ? clientId.keyUsed ?? ROLLING_INSIGHTS_CLIENT_ID_KEYS[0]
      : clientId2.keyUsed ?? ROLLING_INSIGHTS_CLIENT_ID2_KEYS[0]

    return {
      authMode: 'client_credentials',
      baseUrl,
      keySource: preferredKeySource,
      enabledSports,
    }
  }

  if (apiKey.value) {
    return {
      authMode: 'api_key',
      baseUrl,
      keySource: apiKey.keyUsed ?? ROLLING_INSIGHTS_API_KEY_KEYS[0],
      enabledSports,
    }
  }

  return null
}

export function isRollingInsightsAvailable(): boolean {
  return !!getRollingInsightsConfigFromEnv()
}

// ----- Frontend-safe status (no secrets) -----
export interface ProviderStatus {
  openai: boolean
  deepseek: boolean
  xai: boolean
  clearsports: boolean
  rollingInsights: boolean
  anyAi: boolean
}

export interface ProviderSurfaceStatus {
  providerSelector: boolean
  aiModeSelector: boolean
  providerComparison: boolean
  mediaGeneration: boolean
  chimmy: boolean
  socialClipGeneration: boolean
  blogGeneration: boolean
}

export function getProviderStatus(): ProviderStatus {
  const openai = isOpenAIAvailable()
  const deepseek = isDeepSeekAvailable()
  const xai = isXaiAvailable()
  const clearsports = isClearSportsAvailable()
  const rollingInsights = isRollingInsightsAvailable()
  return {
    openai,
    deepseek,
    xai,
    clearsports,
    rollingInsights,
    anyAi: openai || deepseek || xai,
  }
}

export function getProviderSurfaceStatus(status: ProviderStatus = getProviderStatus()): ProviderSurfaceStatus {
  const aiProvidersOnline = [status.openai, status.deepseek, status.xai].filter(Boolean).length
  return {
    providerSelector: status.anyAi,
    aiModeSelector: status.anyAi,
    providerComparison: aiProvidersOnline > 1,
    mediaGeneration: status.openai || status.xai,
    chimmy: status.openai || status.xai,
    socialClipGeneration: status.openai || status.xai,
    blogGeneration: status.anyAi,
  }
}

// ----- Startup validation notes (safe, no secret values) -----
export interface ProviderStartupValidationNote {
  level: 'info' | 'warn'
  code: string
  message: string
}

export function getProviderStartupValidationNotes(): ProviderStartupValidationNote[] {
  const notes: ProviderStartupValidationNote[] = []
  const status = getProviderStatus()

  if (!status.anyAi) {
    notes.push({
      level: 'warn',
      code: 'ai_providers_missing',
      message: 'No AI providers configured. Set OPENAI_API_KEY, DEEPSEEK_API_KEY, or XAI_API_KEY.',
    })
  }

  const clearSportsKey = resolveFirstEnv(CLEARSPORTS_KEY_KEYS)
  const clearSportsBase = resolveFirstEnv(CLEARSPORTS_BASE_URL_KEYS)
  if (clearSportsKey.value && !clearSportsBase.value) {
    notes.push({
      level: 'info',
      code: 'clearsports_default_base_applied',
      message: `ClearSports base URL not set. Falling back to ${DEFAULT_CLEARSPORTS_BASE_URL}.`,
    })
  } else if (!!clearSportsKey.value !== !!clearSportsBase.value) {
    notes.push({
      level: 'warn',
      code: 'clearsports_partial_config',
      message: 'ClearSports config is partial. Set both CLEARSPORTS_API_KEY and CLEARSPORTS_API_BASE.',
    })
  }

  const rollingInsightsApiKey = resolveFirstEnv(ROLLING_INSIGHTS_API_KEY_KEYS)
  const rollingInsightsClientId = resolveFirstEnv(ROLLING_INSIGHTS_CLIENT_ID_KEYS)
  const rollingInsightsClientSecret = resolveFirstEnv(ROLLING_INSIGHTS_CLIENT_SECRET_KEYS)
  const rollingInsightsClientId2 = resolveFirstEnv(ROLLING_INSIGHTS_CLIENT_ID2_KEYS)
  const rollingInsightsClientSecret2 = resolveFirstEnv(ROLLING_INSIGHTS_CLIENT_SECRET2_KEYS)
  const rollingInsightsExtraSports = Object.entries(getRollingInsightsEnabledSports())
    .filter(([sport, enabled]) => sport !== 'NFL' && enabled)
    .map(([sport]) => sport)

  const hasRollingInsightsApiKey = !!rollingInsightsApiKey.value
  const hasRollingInsightsPrimaryClientPair =
    !!rollingInsightsClientId.value && !!rollingInsightsClientSecret.value
  const hasRollingInsightsSecondaryClientPair =
    !!rollingInsightsClientId2.value && !!rollingInsightsClientSecret2.value
  const hasRollingInsightsClientPair =
    hasRollingInsightsPrimaryClientPair || hasRollingInsightsSecondaryClientPair

  if (
    !hasRollingInsightsApiKey &&
    !hasRollingInsightsPrimaryClientPair &&
    (!!rollingInsightsClientId.value !== !!rollingInsightsClientSecret.value)
  ) {
    notes.push({
      level: 'warn',
      code: 'rolling_insights_primary_partial_config',
      message: 'Rolling Insights client credentials are partial. Set both ROLLING_INSIGHTS_CLIENT_ID and ROLLING_INSIGHTS_CLIENT_SECRET.',
    })
  }

  if (
    !hasRollingInsightsApiKey &&
    !hasRollingInsightsSecondaryClientPair &&
    (!!rollingInsightsClientId2.value !== !!rollingInsightsClientSecret2.value)
  ) {
    notes.push({
      level: 'warn',
      code: 'rolling_insights_secondary_partial_config',
      message: 'Rolling Insights secondary client credentials are partial. Set both ROLLING_INSIGHTS_CLIENT_ID2 and ROLLING_INSIGHTS_CLIENT_SECRET2.',
    })
  }

  if (rollingInsightsExtraSports.length > 0 && !hasRollingInsightsApiKey && !hasRollingInsightsClientPair) {
    notes.push({
      level: 'warn',
      code: 'rolling_insights_sports_enabled_without_credentials',
      message: `Rolling Insights multi-sport flags are enabled for ${rollingInsightsExtraSports.join(', ')}, but credentials are not configured.`,
    })
  }

  if (resolveFirstEnv(OPENAI_KEY_KEYS).keyUsed === 'AI_INTEGRATIONS_OPENAI_API_KEY') {
    notes.push({
      level: 'info',
      code: 'openai_legacy_alias_in_use',
      message: 'Using legacy alias AI_INTEGRATIONS_OPENAI_API_KEY. Prefer OPENAI_API_KEY.',
    })
  }

  if (resolveFirstEnv(XAI_KEY_KEYS).keyUsed === 'GROK_API_KEY') {
    notes.push({
      level: 'info',
      code: 'xai_legacy_alias_in_use',
      message: 'Using legacy alias GROK_API_KEY. Prefer XAI_API_KEY.',
    })
  }

  if (resolveFirstEnv(CLEARSPORTS_KEY_KEYS).keyUsed === 'CLEAR_SPORTS_API_KEY') {
    notes.push({
      level: 'info',
      code: 'clearsports_legacy_alias_in_use',
      message: 'Using legacy alias CLEAR_SPORTS_API_KEY. Prefer CLEARSPORTS_API_KEY.',
    })
  }

  return notes
}

// ----- Safe logging (never print secret values) -----
export function logProviderStatus(): void {
  if (typeof process === 'undefined') return
  const o = getOpenAIConfigFromEnv()
  const d = getDeepSeekConfigFromEnv()
  const x = getXaiConfigFromEnv()
  const c = getClearSportsConfigFromEnv()
  const r = getRollingInsightsConfigFromEnv()
  const parts = [
    `openai: ${mask(o?.apiKey ?? '')}`,
    `deepseek: ${mask(d?.apiKey ?? '')}`,
    `xai: ${mask(x?.apiKey ?? '')}`,
    `clearsports: ${mask(c?.apiKey ?? '')}`,
    `rollingInsights: ${mask(r ? 'configured' : '')}`,
  ]
  console.info('[ProviderConfig]', parts.join(', '))
}

export function logProviderStartupValidation(): void {
  if (typeof process === 'undefined') return
  const notes = getProviderStartupValidationNotes()
  for (const note of notes) {
    const line = `[ProviderConfig][${note.code}] ${note.message}`
    if (note.level === 'warn') console.warn(line)
    else console.info(line)
  }
}
