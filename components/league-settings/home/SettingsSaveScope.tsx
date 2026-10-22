'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'

/**
 * One way to save, on every League Settings page (Sleeper-style): change what you like, then
 * "Save changes" in a sticky bar — never a mix of pages that save as you type and pages with a
 * button. A commissioner who changed waivers and saw no Save button could not tell whether it had
 * taken; that is the bug this exists to remove.
 *
 * The autosaving tabs keep their hook (`useLeagueSettingsSectionAutosave`). Inside a scope it stops
 * saving on its own and registers its pending edits here instead; outside one (the older settings
 * modal for imported leagues) it autosaves exactly as before.
 *
 * Editors with their own save call join through `useSaveScopeParticipant` and hide their own
 * button (the Playoffs bracket and stage editors). Pages whose editor still draws its own Save
 * button (roster, scoring, draft, guillotine) do not register and are unaffected.
 */

export type SaveScopeParticipant = {
  isDirty: () => boolean
  /** Resolves true when everything saved. */
  save: () => Promise<boolean>
  discard: () => void
}

type Store = {
  register: (id: string, p: SaveScopeParticipant) => () => void
  notify: () => void
  subscribe: (fn: () => void) => () => void
  snapshot: () => number
  isDirty: () => boolean
  saveAll: () => Promise<boolean>
  discardAll: () => void
  hasParticipants: () => boolean
}

function createStore(): Store {
  const participants = new Map<string, SaveScopeParticipant>()
  const listeners = new Set<() => void>()
  let version = 0
  const notify = () => {
    version++
    listeners.forEach((fn) => fn())
  }
  return {
    register(id, p) {
      participants.set(id, p)
      notify()
      return () => {
        participants.delete(id)
        notify()
      }
    },
    notify,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    snapshot: () => version,
    isDirty: () => [...participants.values()].some((p) => p.isDirty()),
    async saveAll() {
      const results = await Promise.all([...participants.values()].filter((p) => p.isDirty()).map((p) => p.save()))
      notify()
      return results.every(Boolean)
    },
    discardAll() {
      participants.forEach((p) => p.discard())
      notify()
    },
    hasParticipants: () => participants.size > 0,
  }
}

const SaveScopeContext = createContext<Store | null>(null)

/** For `useLeagueSettingsSectionAutosave`: the scope it is in, or null (then it autosaves). */
export function useSettingsSaveScope(): Store | null {
  return useContext(SaveScopeContext)
}

/**
 * For an editor with its own save call (the playoff bracket and stage editors): join the page's save
 * bar instead of drawing a second Save button. Pass whether it has unsaved edits and how to save
 * them; returns true when a bar is there to do the saving, so the editor can hide its own button.
 * Outside a scope it does nothing and returns false.
 */
export function useSaveScopeParticipant(dirty: boolean, save: () => Promise<boolean>): boolean {
  const scope = useSettingsSaveScope()
  const latest = useRef({ dirty, save })
  latest.current = { dirty, save }
  useEffect(() => {
    if (!scope) return
    return scope.register(`editor:${Math.random().toString(36).slice(2)}`, {
      isDirty: () => latest.current.dirty,
      save: () => latest.current.save(),
      // Discard remounts the page from saved values, which resets the editor's own state.
      discard: () => {},
    })
  }, [scope])
  useEffect(() => {
    scope?.notify()
  }, [scope, dirty])
  return scope != null
}

export type SettingsSaveScopeHandle = {
  isDirty: () => boolean
  discardAll: () => void
}

/**
 * Wrap one settings sub-page. `onReady` hands the caller a handle so its own back / switch-section
 * controls can ask "unsaved changes?" before leaving.
 */
export function SettingsSaveScope({
  children,
  onReady,
}: {
  children: ReactNode
  onReady?: (handle: SettingsSaveScopeHandle) => void
}) {
  const store = useMemo(createStore, [])
  // Discard reverts every edited field by remounting the page from saved values.
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    onReady?.({
      isDirty: store.isDirty,
      discardAll: () => {
        store.discardAll()
        setGeneration((g) => g + 1)
      },
    })
  }, [store, onReady])

  // A closed tab or a reload with unsaved edits gets the browser's own "leave site?" prompt.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!store.isDirty()) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [store])

  return (
    <SaveScopeContext.Provider value={store}>
      <div key={generation}>{children}</div>
      <SaveBar store={store} onDiscard={() => setGeneration((g) => g + 1)} />
    </SaveScopeContext.Provider>
  )
}

function SaveBar({ store, onDiscard }: { store: Store; onDiscard: () => void }) {
  useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<'saved' | 'failed' | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const dirty = store.isDirty()
  // Only pages with a registered (formerly autosaving) section get this bar.
  if (!store.hasParticipants()) return null
  if (!dirty && !saving && result !== 'saved') return null

  const save = async () => {
    setSaving(true)
    setResult(null)
    const ok = await store.saveAll()
    setSaving(false)
    setResult(ok ? 'saved' : 'failed')
    if (ok) {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setResult(null), 2500)
    }
  }

  return (
    <div className="lsh-footer lsh-savebar" role="region" aria-label="Save settings" data-testid="lsh-savebar">
      <span className="lsh-savebar-status" role="status" aria-live="polite">
        {saving ? 'Saving…' : result === 'saved' && !dirty ? '✓ Saved' : result === 'failed' ? 'Some changes did not save. Try again.' : 'Unsaved changes'}
      </span>
      {dirty ? (
        <span className="lsh-savebar-actions">
          <button
            type="button"
            className="lsh-secondary"
            disabled={saving}
            onClick={() => {
              store.discardAll()
              setResult(null)
              onDiscard()
            }}
            data-testid="lsh-discard"
          >
            Discard
          </button>
          <button type="button" className="lsh-primary" disabled={saving} onClick={() => void save()} data-testid="lsh-save-changes">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </span>
      ) : null}
    </div>
  )
}

/** "Leave without saving?" — shared wording for the back arrow and the section switcher. */
export function confirmDiscardIfDirty(handle: SettingsSaveScopeHandle | null): boolean {
  if (!handle || !handle.isDirty()) return true
  const leave = typeof window === 'undefined' ? true : window.confirm('You have unsaved changes. Leave without saving?')
  if (leave) handle.discardAll()
  return leave
}

/** Lets a caller keep the latest handle in a ref without re-rendering. */
export function useSaveScopeHandleRef() {
  const ref = useRef<SettingsSaveScopeHandle | null>(null)
  const onReady = useCallback((h: SettingsSaveScopeHandle) => {
    ref.current = h
  }, [])
  return { ref, onReady }
}
