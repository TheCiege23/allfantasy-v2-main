'use client'

import { useCallback, useEffect, useState, type SetStateAction } from 'react'

export function useScopedConversation<T extends { id: string; role: string; text: string }>(owner: string | undefined, scope: string) {
  type State = { turns: T[]; draft: string }
  const [all, setAll] = useState<Record<string, State>>({})
  const [ready, setReady] = useState(false)
  const storageKey = owner ? `af:comms:conversations:${owner}` : null
  useEffect(() => {
    try {
      const saved = storageKey ? JSON.parse(sessionStorage.getItem(storageKey) ?? '{}') : {}
      const valid: Record<string, State> = {}
      for (const [key, value] of Object.entries(saved)) {
        const v = value as State
        if (Array.isArray(v?.turns) && typeof v.draft === 'string') valid[key] = {
          draft: v.draft.slice(0, 10000),
          turns: v.turns.filter(t => t && typeof t.id === 'string' && typeof t.text === 'string' && ['you', 'chimmy'].includes(t.role)).slice(-80),
        }
      }
      setAll(valid)
    } catch { setAll({}) }
    setReady(true)
  }, [storageKey])
  useEffect(() => {
    if (ready && storageKey) { try { sessionStorage.setItem(storageKey, JSON.stringify(all)) } catch { /* Private mode or storage quota: keep the in-memory conversation. */ } }
  }, [all, ready, storageKey])
  const setTurns = useCallback((action: SetStateAction<T[]>) => setAll(previous => {
    const state = previous[scope] ?? { turns: [], draft: '' }
    return { ...previous, [scope]: { ...state, turns: (typeof action === 'function' ? action(state.turns) : action).slice(-80) } }
  }), [scope])
  const setDraft = useCallback((action: SetStateAction<string>) => setAll(previous => {
    const state = previous[scope] ?? { turns: [], draft: '' }
    return { ...previous, [scope]: { ...state, draft: typeof action === 'function' ? action(state.draft) : action } }
  }), [scope])
  /*
   * Bring turns from this conversation into ANOTHER scope's thread.
   *
   * An empty target is seeded with all of `carried`. A target that already holds a conversation is
   * never overwritten: it only gains the last `appendLast` turns (none by default), so moving to a
   * league keeps what was said there and, when asked, adds the question and answer that led there.
   */
  const carryInto = useCallback((target: string, carried: T[], appendLast = 0) => setAll(previous => {
    const state = previous[target] ?? { turns: [], draft: '' }
    if (target === scope || carried.length === 0) return previous
    if (state.turns.length === 0) {
      return { ...previous, [target]: { ...state, turns: carried.slice(-80) } }
    }
    if (appendLast <= 0) return previous
    const held = new Set(state.turns.map(t => t.id))
    const added = carried.slice(-appendLast).filter(t => !held.has(t.id))
    if (added.length === 0) return previous
    return { ...previous, [target]: { ...state, turns: [...state.turns, ...added].slice(-80) } }
  }), [scope])
  return { turns: all[scope]?.turns ?? [], draft: all[scope]?.draft ?? '', setTurns, setDraft, carryInto }
}
