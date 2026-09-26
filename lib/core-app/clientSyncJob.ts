import { MAX_ROUNDS, runSyncRounds, type SyncCheckpoint, type SyncPostResult, type SyncRunOutcome } from './syncRunLoop'

export type ClientSyncSnapshot = {
  phase: 'idle' | 'busy' | 'done' | 'error'
  message: string | null
  completion: number
}

const INITIAL: ClientSyncSnapshot = { phase: 'idle', message: null, completion: 0 }
const STORAGE_KEY = 'af-core-sync-continuation:v1'
const MAX_AGE_MS = 15 * 60 * 1000

type SyncState = {
  snapshot: ClientSyncSnapshot
  active: Promise<SyncRunOutcome> | null
  refreshedCompletion: number
  listeners: Set<() => void>
  pending: SyncCheckpoint | null
}

function readCheckpoint(): SyncCheckpoint | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
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
  if (typeof window === 'undefined') return
  try {
    if (checkpoint?.only?.length) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ at: Date.now(), checkpoint }))
    else window.sessionStorage.removeItem(STORAGE_KEY)
  } catch { /* Storage restrictions must not prevent an explicitly requested sync. */ }
}

function newState(): SyncState {
  return { snapshot: INITIAL, active: null, refreshedCompletion: 0, listeners: new Set(), pending: readCheckpoint() }
}

// Client bundles share one job in the tab. Never share user work in server globals.
const browserWindow = typeof window === 'undefined' ? null : window as Window & { __afCoreSyncJobV1?: SyncState }
const state = browserWindow ? (browserWindow.__afCoreSyncJobV1 ??= newState()) : newState()

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

async function postSync(only: string[] | null): Promise<SyncPostResult> {
  try {
    const res = await fetch('/api/core/sync', {
      signal: AbortSignal.timeout(110_000),
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
  state.pending = null
  saveCheckpoint(checkpoint ?? (onlyKey ? { only: [onlyKey], total: 1, synced: 0, locked: 0, failed: 0, rounds: 0 } : null))
  publish({ ...state.snapshot, phase: 'busy', message: checkpoint ? 'Continuing your unfinished league sync…' : onlyKey ? 'Refreshing this league…' : 'Refreshing your connected leagues…' })
  state.active = runSyncRounds({
    initialOnly: onlyKey ? [onlyKey] : undefined,
    initialCheckpoint: checkpoint,
    post,
    onProgress: message => publish({ ...state.snapshot, message }),
    onCheckpoint: saveCheckpoint,
  }).then(outcome => {
    saveCheckpoint(null)
    publish({ phase: outcome.tone === 'ok' ? 'done' : 'error', message: outcome.message, completion: state.snapshot.completion + 1 })
    return outcome
  }).catch(() => {
    saveCheckpoint(null)
    publish({ phase: 'error', message: 'Sync stopped unexpectedly. Check league status before retrying.', completion: state.snapshot.completion + 1 })
    throw new Error('Sync stopped unexpectedly')
  }).finally(() => { state.active = null })
  return state.active
}

/** One browser job survives screen navigation; every sync control observes it. */
export function startClientSync(onlyKey?: string | null, post: (only: string[] | null) => Promise<SyncPostResult> = postSync): Promise<SyncRunOutcome> {
  return runJob(onlyKey, post)
}

/** Resume only confirmed remaining keys; the server rechecks account ownership. */
export function resumeClientSync(post: (only: string[] | null) => Promise<SyncPostResult> = postSync): Promise<SyncRunOutcome> | null {
  if (state.active) return state.active
  if (!state.pending) return null
  return runJob(undefined, post, state.pending)
}
