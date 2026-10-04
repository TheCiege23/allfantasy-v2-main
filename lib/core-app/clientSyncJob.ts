import { MAX_ROUNDS, runSyncRounds, type SyncCheckpoint, type SyncPostResult, type SyncRunOutcome } from './syncRunLoop'

export type ClientSyncSnapshot = {
  phase: 'idle' | 'busy' | 'done' | 'error'
  message: string | null
  completion: number
}

const INITIAL: ClientSyncSnapshot = { phase: 'idle', message: null, completion: 0 }
const STORAGE_KEY = 'af-core-sync-continuation:v2'
const MAX_AGE_MS = 15 * 60 * 1000

type SyncState = {
  accountId: string | null
  generation: number
  controller: AbortController | null
  snapshot: ClientSyncSnapshot
  active: Promise<SyncRunOutcome> | null
  refreshedCompletion: number
  listeners: Set<() => void>
  pending: SyncCheckpoint | null
  leaving: boolean
}

function checkpointKey(accountId: string) { return `${STORAGE_KEY}:${encodeURIComponent(accountId)}` }

function readCheckpoint(accountId: string): SyncCheckpoint | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(checkpointKey(accountId))
    if (!raw) return null
    const { at, checkpoint } = JSON.parse(raw)
    if (!Number.isFinite(at) || Date.now() - at > MAX_AGE_MS || at > Date.now() + 60_000) return null
    if (!checkpoint || !Array.isArray(checkpoint.only) || checkpoint.only.length === 0 || checkpoint.only.length > 250) return null
    if (!checkpoint.only.every((key: unknown) => typeof key === 'string' && key.length > 0 && key.length <= 256)) return null
    if (!['total', 'synced', 'locked', 'failed', 'rounds'].every(key => Number.isSafeInteger(checkpoint[key]) && checkpoint[key] >= 0)) return null
    if (checkpoint.rounds >= MAX_ROUNDS || checkpoint.total < checkpoint.synced + checkpoint.locked + checkpoint.failed) return null
    return checkpoint as SyncCheckpoint
  } catch { return null }
}

function saveCheckpoint(checkpoint: SyncCheckpoint | null) {
  if (typeof window === 'undefined' || !state.accountId) return
  try {
    if (checkpoint?.only?.length) window.sessionStorage.setItem(checkpointKey(state.accountId), JSON.stringify({ at: Date.now(), checkpoint }))
    else window.sessionStorage.removeItem(checkpointKey(state.accountId))
  } catch { /* Storage restrictions must not prevent an explicitly requested sync. */ }
}

function newState(): SyncState {
  const next: SyncState = { accountId: null, generation: 0, controller: null, snapshot: INITIAL, active: null, refreshedCompletion: 0, listeners: new Set(), pending: null, leaving: false }
  if (typeof window !== 'undefined') {
    // Navigating aborts the in-flight fetch. Keep the last confirmed work list
    // instead of treating that browser abort as an explicit failed sync.
    const departing = () => { next.leaving = true }
    window.addEventListener('beforeunload', departing, { once: true })
    window.addEventListener('pagehide', departing, { once: true })
    window.addEventListener('pageshow', () => { next.leaving = false })
  }
  return next
}

// Client bundles share one job in the tab. Never share user work in server globals.
const browserWindow = typeof window === 'undefined' ? null : window as Window & { __afCoreSyncJobV2?: SyncState }
const state = browserWindow ? (browserWindow.__afCoreSyncJobV2 ??= newState()) : newState()

/** Session changes invalidate in-flight work before it can publish or continue. */
export function bindClientSyncAccount(accountId: string | null) {
  if (state.accountId === accountId) return
  state.controller?.abort()
  saveCheckpoint(null)
  state.generation += 1
  state.accountId = accountId
  state.controller = null
  state.active = null
  state.pending = accountId ? readCheckpoint(accountId) : null
  state.refreshedCompletion = 0
  state.leaving = false
  try { browserWindow?.sessionStorage.removeItem('af-core-sync-continuation:v1') } catch { /* Ignore restricted storage. */ }
  publish(INITIAL)
}

export const getClientSyncSnapshot = () => state.snapshot
export const getServerSyncSnapshot = () => INITIAL
export function claimClientSyncRefresh(completion: number): boolean {
  if (completion <= state.refreshedCompletion) return false
  state.refreshedCompletion = completion
  return true
}
export function subscribeClientSync(listener: () => void) {
  state.listeners.add(listener)
  return () => { state.listeners.delete(listener) }
}
function publish(next: ClientSyncSnapshot) {
  state.snapshot = next
  for (const listener of state.listeners) listener()
}

async function postSync(only: string[] | null, signal?: AbortSignal): Promise<SyncPostResult> {
  try {
    const res = await fetch('/api/core/sync', {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(110_000)]) : AbortSignal.timeout(110_000),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(only ? { only } : {}),
    })
    return { httpOk: res.ok, round: await res.json().catch(() => null) }
  } catch {
    return { httpOk: false, round: { error: 'Could not confirm the sync result. Check your league’s Sync status before retrying.' } }
  }
}

function runJob(onlyKey: string | null | undefined, post: (only: string[] | null) => Promise<SyncPostResult>, checkpoint?: SyncCheckpoint): Promise<SyncRunOutcome> {
  if (state.active) return state.active
  const generation = state.generation
  const current = () => generation === state.generation
  const controller = new AbortController()
  state.controller = controller
  state.pending = null
  let confirmed = checkpoint ?? null
  saveCheckpoint(checkpoint ?? (onlyKey ? { only: [onlyKey], total: 1, synced: 0, locked: 0, failed: 0, rounds: 0 } : null))
  publish({ ...state.snapshot, phase: 'busy', message: checkpoint ? 'Continuing your unfinished league sync…' : onlyKey ? 'Refreshing this league…' : 'Refreshing your connected leagues…' })
  state.active = runSyncRounds({
    initialOnly: onlyKey ? [onlyKey] : undefined,
    initialCheckpoint: checkpoint,
    post: async only => {
      if (!current()) return { httpOk: false, round: null }
      const result = await (post === postSync ? postSync(only, controller.signal) : post(only))
      return current() ? result : { httpOk: false, round: null }
    },
    onProgress: message => { if (current()) publish({ ...state.snapshot, message }) },
    onCheckpoint: next => { if (current()) { confirmed = next; saveCheckpoint(next) } },
  }).then(outcome => {
    if (!current()) return outcome
    // A verified no-progress/budget stop can resume without re-syncing completed
    // leagues. An unverified/network failure still requires checking status first.
    state.pending = outcome.status === 'incomplete' && confirmed?.only?.length
      ? { ...confirmed, rounds: 0 }
      : null
    if (!state.leaving) saveCheckpoint(state.pending)
    publish({ phase: outcome.tone === 'ok' ? 'done' : 'error', message: outcome.message, completion: state.snapshot.completion + 1 })
    return outcome
  }).catch(() => {
    if (!current()) throw new Error('Sync account changed')
    if (!state.leaving) saveCheckpoint(null)
    publish({ phase: 'error', message: 'Sync stopped unexpectedly. Check league status before retrying.', completion: state.snapshot.completion + 1 })
    throw new Error('Sync stopped unexpectedly')
  }).finally(() => { if (current()) { state.active = null; state.controller = null } })
  return state.active
}

/** One browser job survives screen navigation; every sync control observes it. */
export function startClientSync(onlyKey?: string | null, post: (only: string[] | null) => Promise<SyncPostResult> = postSync): Promise<SyncRunOutcome> {
  if (post === postSync && !state.accountId) return Promise.reject(new Error('UNAUTHENTICATED'))
  return runJob(onlyKey, post, onlyKey ? undefined : state.pending ?? undefined)
}

/** Resume only confirmed remaining keys; the server rechecks account ownership. */
export function resumeClientSync(post: (only: string[] | null) => Promise<SyncPostResult> = postSync): Promise<SyncRunOutcome> | null {
  if (state.active) return state.active
  if (!state.pending) return null
  return runJob(undefined, post, state.pending)
}
