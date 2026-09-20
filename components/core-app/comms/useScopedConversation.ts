'use client'

import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'

export function useScopedConversation<T extends { id: string; role: string; text: string }>(owner: string | undefined, scope: string) {
  type State = { turns: T[]; draft: string }
  const [all, setAll] = useState<Record<string, State>>({})
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
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
    setLoadedKey(storageKey)
  }, [storageKey])
  useEffect(() => {
    if (loadedKey === storageKey && storageKey) { try { sessionStorage.setItem(storageKey, JSON.stringify(all)) } catch { /* Private mode or storage quota: keep the in-memory conversation. */ } }
  }, [all, loadedKey, storageKey])

  /*
   * ── 🛑 THE TRANSCRIPT WAS IN THE DATABASE THE WHOLE TIME ────────────────────────────────────
   *
   * Everything above is `sessionStorage`, which is per TAB: close it, or open the drawer in a new
   * one, and the conversation is gone. Meanwhile `/api/chat/chimmy` has been writing BOTH halves
   * of every exchange to `chat_history` since PROMPT 234, and already feeds the last 12 back into
   * the prompt — so Chimmy REMEMBERED a conversation the user could no longer SEE. Reported as
   * "why isn't my previous conversation showing?", and the honest answer was that nothing ever
   * asked for it.
   *
   * ⚠ ONLY WHEN THE SCOPE IS EMPTY, AND THE CHECK LIVES INSIDE THE SETTER. The fetch is async, so
   * a user can type and get an answer before it lands; deciding "is this scope empty" beforehand
   * would race and could replace a live exchange with an older snapshot. Re-reading `previous` at
   * merge time is what keeps the live tab authoritative over the server, every time.
   *
   * ⚠ AND IT WAITS FOR `sessionStorage` TO LOAD FIRST (`loadedKey === storageKey`). That load is
   * itself an effect calling `setAll(valid)` — landing server turns before it would just have them
   * overwritten a tick later, which fails silently and intermittently.
   */
  const hydrated = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!owner || loadedKey !== storageKey) return
    const key = `${owner}:${scope}`
    if (hydrated.current.has(key)) return
    hydrated.current.add(key)
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/chat/chimmy?leagueId=${encodeURIComponent(scope)}`, {
          headers: { accept: 'application/json' },
        })
        if (!res.ok || cancelled) return
        const body = (await res.json()) as { turns?: unknown }
        const incoming = Array.isArray(body?.turns)
          ? (body.turns as Array<Record<string, unknown>>).filter(
              (t) =>
                t &&
                typeof t.id === 'string' &&
                typeof t.text === 'string' &&
                ['you', 'chimmy'].includes(String(t.role)),
            )
          : []
        if (cancelled || incoming.length === 0) return
        setAll((previous) => {
          const state = previous[scope] ?? { turns: [], draft: '' }
          if (state.turns.length > 0) return previous
          return { ...previous, [scope]: { ...state, turns: incoming.slice(-80) as unknown as T[] } }
        })
      } catch {
        /* Offline, blocked, or the read failed: the drawer still works, it just starts empty. */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [owner, scope, loadedKey, storageKey])
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
  return { turns: loadedKey === storageKey ? all[scope]?.turns ?? [] : [], draft: loadedKey === storageKey ? all[scope]?.draft ?? '' : '', setTurns, setDraft, carryInto }
}
