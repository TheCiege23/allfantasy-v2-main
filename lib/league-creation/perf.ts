'use client'

type LeagueCreationPerfPayload = {
  event: string
  at: number
  [key: string]: unknown
}

const PERF_FLAG_KEY = 'af:leagueCreationPerf'
const PERF_QUERY_FLAG = 'lcPerf'
const PERF_EVENT_NAME = 'af:league-creation:perf'

function hasPerfQueryFlag(search: string): boolean {
  try {
    const params = new URLSearchParams(search)
    return params.get(PERF_QUERY_FLAG) === '1'
  } catch {
    return false
  }
}

export function isLeagueCreationPerfEnabled(): boolean {
  if (typeof window === 'undefined') return false
  if ((window as { __AF_LEAGUE_CREATION_PERF__?: boolean }).__AF_LEAGUE_CREATION_PERF__) return true
  if (hasPerfQueryFlag(window.location.search)) return true
  try {
    return window.localStorage.getItem(PERF_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

export function emitLeagueCreationPerf(
  event: string,
  payload?: Record<string, unknown>
): void {
  if (!isLeagueCreationPerfEnabled()) return
  const detail: LeagueCreationPerfPayload = {
    event,
    at: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    ...(payload ?? {}),
  }
  console.debug('[league-creation-perf]', detail)
  window.dispatchEvent(new CustomEvent(PERF_EVENT_NAME, { detail }))
}

