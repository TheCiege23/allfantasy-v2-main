import { runSyncRounds, type SyncPostResult, type SyncRunOutcome } from './syncRunLoop'

export type ClientSyncSnapshot = {
  phase: 'idle' | 'busy' | 'done' | 'error'
  message: string | null
  completion: number
}

const INITIAL: ClientSyncSnapshot = { phase: 'idle', message: null, completion: 0 }
let snapshot = INITIAL
let active: Promise<SyncRunOutcome> | null = null
let refreshedCompletion = 0
const listeners = new Set<() => void>()

export const getClientSyncSnapshot = () => snapshot
export const getServerSyncSnapshot = () => INITIAL
export function claimClientSyncRefresh(completion: number): boolean {
  if (completion <= refreshedCompletion) return false
  refreshedCompletion = completion
  return true
}
export function subscribeClientSync(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function publish(next: ClientSyncSnapshot) {
  snapshot = next
  for (const listener of listeners) listener()
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

/** One browser job survives screen navigation; every sync control observes it. */
export function startClientSync(
  onlyKey?: string | null,
  post: (only: string[] | null) => Promise<SyncPostResult> = postSync,
): Promise<SyncRunOutcome> {
  if (active) return active
  publish({ ...snapshot, phase: 'busy', message: onlyKey ? 'Refreshing this league…' : 'Refreshing your connected leagues…' })
  active = runSyncRounds({
    initialOnly: onlyKey ? [onlyKey] : undefined,
    post,
    onProgress: (message) => publish({ ...snapshot, message }),
  }).then((outcome) => {
    publish({ phase: outcome.tone === 'ok' ? 'done' : 'error', message: outcome.message, completion: snapshot.completion + 1 })
    return outcome
  }).catch((error: unknown) => {
    publish({ phase: 'error', message: 'Sync stopped unexpectedly. Check league status before retrying.', completion: snapshot.completion + 1 })
    throw error
  }).finally(() => { active = null })
  return active
}
