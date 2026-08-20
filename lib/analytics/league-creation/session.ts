import type { CreateMode } from '@/lib/create-league-v2/state'

let sessionId = ''
let startedAtMs = 0
let currentMode: CreateMode | null = null
let modeEnteredAtMs = 0
/** Prevents duplicate `league_create_started` when React Strict Mode remounts before session reset. */
let createStartedEmitted = false

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `lc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

/** Idempotent per tab — call on funnel entry. */
export function ensureLeagueCreationAnalyticsSession(): string {
  if (!sessionId) {
    sessionId = newSessionId()
    startedAtMs = Date.now()
  }
  return sessionId
}

export function resetLeagueCreationAnalyticsSession(): void {
  sessionId = ''
  startedAtMs = 0
  currentMode = null
  modeEnteredAtMs = 0
  createStartedEmitted = false
}

/**
 * Returns true the first time per analytics session; false on subsequent calls (e.g. Strict Mode remount).
 */
export function tryConsumeLeagueCreateStartedAnalyticsSlot(): boolean {
  ensureLeagueCreationAnalyticsSession()
  if (createStartedEmitted) return false
  createStartedEmitted = true
  return true
}

export function getLeagueCreationAnalyticsSessionMeta(): {
  sessionId: string
  startedAtMs: number
  elapsedMs: number
  currentMode: CreateMode | null
} {
  const sid = sessionId || ensureLeagueCreationAnalyticsSession()
  const now = Date.now()
  return {
    sessionId: sid,
    startedAtMs,
    elapsedMs: startedAtMs ? now - startedAtMs : 0,
    currentMode,
  }
}

/**
 * Call when `creationMode` changes. Returns timing for the mode being exited
 * (for `league_create_mode_selected` payloads).
 */
export function touchLeagueCreationAnalyticsMode(mode: CreateMode): {
  previousMode?: CreateMode
  previousModeDurationMs?: number
} {
  ensureLeagueCreationAnalyticsSession()
  const now = Date.now()
  if (currentMode == null) {
    currentMode = mode
    modeEnteredAtMs = now
    return {}
  }
  if (currentMode === mode) {
    return {}
  }
  const previousMode = currentMode
  const previousModeDurationMs = Math.max(0, now - modeEnteredAtMs)
  currentMode = mode
  modeEnteredAtMs = now
  return { previousMode, previousModeDurationMs }
}
