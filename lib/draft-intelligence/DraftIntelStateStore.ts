import type { DraftIntelState, DraftIntelStreamEnvelope } from './types'

type Listener = (event: DraftIntelStreamEnvelope) => void

function getKey(leagueId: string, userId: string) {
  return `${leagueId}:${userId}`
}

/*
 * ⚠ BOUNDED. Each state carries a full draft snapshot, and `draft-tick` writes one for every manager
 * near the clock in every draft, every minute. This used to have no delete at all, so finished drafts
 * stayed in memory for the life of the process. States not written for STATE_MAX_AGE_MS are dropped,
 * and the count is capped (oldest write first). A key with a live subscriber is never dropped — that
 * is a draft room someone has open.
 */
const STATE_MAX_AGE_MS = 6 * 60 * 60 * 1000
const STATE_MAX_ENTRIES = 2000

class DraftIntelStateStore {
  private readonly state = new Map<string, { value: DraftIntelState; at: number }>()
  private readonly listeners = new Map<string, Set<Listener>>()

  get(leagueId: string, userId: string): DraftIntelState | null {
    return this.state.get(getKey(leagueId, userId))?.value ?? null
  }

  private prune(now: number) {
    // Map iteration is insertion order and `set` re-inserts, so the oldest write comes first.
    for (const [key, entry] of this.state) {
      const tooOld = now - entry.at > STATE_MAX_AGE_MS
      if (!tooOld && this.state.size <= STATE_MAX_ENTRIES) break
      if (this.listeners.get(key)?.size) continue
      this.state.delete(key)
    }
  }

  set(
    eventType: DraftIntelStreamEnvelope['type'],
    nextState: DraftIntelState
  ): DraftIntelState {
    const key = getKey(nextState.leagueId, nextState.userId)
    const now = Date.now()
    this.state.delete(key)
    this.state.set(key, { value: nextState, at: now })
    this.prune(now)
    const envelope: DraftIntelStreamEnvelope = {
      type: eventType,
      leagueId: nextState.leagueId,
      userId: nextState.userId,
      state: nextState,
    }
    const listeners = this.listeners.get(key)
    if (listeners?.size) {
      for (const listener of listeners) {
        try {
          listener(envelope)
        } catch {
          // Ignore subscriber failures to keep stream fanout resilient.
        }
      }
    }
    return nextState
  }

  subscribe(leagueId: string, userId: string, listener: Listener): () => void {
    const key = getKey(leagueId, userId)
    const current = this.listeners.get(key) ?? new Set<Listener>()
    current.add(listener)
    this.listeners.set(key, current)
    return () => {
      const listeners = this.listeners.get(key)
      if (!listeners) return
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.listeners.delete(key)
      }
    }
  }
}

export const draftIntelStateStore = new DraftIntelStateStore()
