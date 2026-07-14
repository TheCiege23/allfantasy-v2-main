/**
 * Privacy-safe AI response cache backed by SportsDataCache (no new table needed).
 *
 * Privacy rules:
 * - Cache keys never contain raw userId, email, invite code, or prompt text.
 * - User-specific answers are keyed by a hash of (userId + content), so they
 *   are never accidentally shared across users.
 * - Pool-level generic answers may be cached by poolId when content is public.
 * - Never cache raw prompt text.
 */
import 'server-only'

import { createHash } from 'node:crypto'

import { prisma } from '@/lib/prisma'
import { getAiCacheTtls } from '@/lib/ai/aiConfig'

// ── TTL presets (seconds) ─────────────────────────────────────────────────────
// Computed at module load from env vars — server restart picks up changes.
// Env vars: AI_CACHE_TTL_CHIMMY_MINUTES, AI_CACHE_TTL_EXPLAIN_HOURS,
//           AI_CACHE_TTL_COMMISSIONER_BRAIN_MINUTES, AI_CACHE_TTL_SPORTS_SCHEDULE_MINUTES

export const AI_CACHE_TTL = getAiCacheTtls()
export type AiCacheFeature = keyof typeof AI_CACHE_TTL

// ── Key helpers ───────────────────────────────────────────────────────────────

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

/**
 * Build a stable, privacy-safe cache key.
 *
 * @param feature  Feature name (e.g. 'chimmy')
 * @param scopeId  Hashed user or pool identifier — never the raw ID
 * @param questionHash  sha256 of the normalized question (or full prompt)
 * @param contextHash   sha256 of relevant context (sport, leagueId, mode, lang)
 */
export function buildAiCacheKey(
  feature: AiCacheFeature,
  scopeId: string,
  questionHash: string,
  contextHash: string
): string {
  return `aic:${feature}:${scopeId}:${questionHash}:${contextHash}`
}

/**
 * Hash a userId so it never appears in plain text in cache keys or logs.
 * Returns a 24-char hex string.
 */
export function hashScope(rawId: string): string {
  return sha(rawId)
}

/**
 * Derive a question hash from the normalized message.
 * Lowercases and trims whitespace so minor phrasing variations don't bypass cache.
 */
export function hashQuestion(message: string): string {
  return sha(message.toLowerCase().trim())
}

/**
 * Derive a context hash from relevant request parameters.
 * Excludes PII — include only enum/ID values, not names or emails.
 */
export function hashContext(parts: {
  sport?: string | null
  leagueId?: string | null
  assistantMode?: string | null
  language?: string | null
  weekSeason?: string | null
}): string {
  const normalized = JSON.stringify({
    sport: parts.sport ?? '',
    leagueId: parts.leagueId ?? '',
    mode: parts.assistantMode ?? '',
    lang: parts.language ?? '',
    ws: parts.weekSeason ?? '',
  })
  return sha(normalized)
}

// ── Cache read / write ────────────────────────────────────────────────────────

/**
 * Retrieve a cached AI text response.
 * Returns null on miss, error, or expiry.
 */
export async function getCachedAiAnswer(key: string): Promise<string | null> {
  try {
    const row = await prisma.sportsDataCache.findUnique({
      where: { cacheKey: key },
      select: { data: true, expiresAt: true },
    })
    if (!row) return null
    if (row.expiresAt < new Date()) {
      // Expired — clean up lazily
      prisma.sportsDataCache.deleteMany({ where: { cacheKey: key } }).catch(() => {})
      return null
    }
    const data = row.data as { text?: unknown }
    return typeof data?.text === 'string' ? data.text : null
  } catch {
    return null
  }
}

/**
 * Store an AI text response in the cache.
 * Never throws.
 */
export async function setCachedAiAnswer(
  key: string,
  text: string,
  ttlSeconds: number
): Promise<void> {
  if (ttlSeconds <= 0) return
  const expiresAt = new Date(Date.now() + ttlSeconds * 1_000)
  try {
    await prisma.sportsDataCache.upsert({
      where: { cacheKey: key },
      update: { data: { text }, expiresAt },
      create: { cacheKey: key, data: { text }, expiresAt },
    })
  } catch {
    // Caching is best-effort — never block the user path.
  }
}
