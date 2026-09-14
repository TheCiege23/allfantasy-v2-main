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
  return { turns: all[scope]?.turns ?? [], draft: all[scope]?.draft ?? '', setTurns, setDraft }
}
