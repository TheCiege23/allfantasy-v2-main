'use client'

import { useSyncExternalStore } from 'react'
import {
  EMPTY_LAYOUTS,
  readLayouts,
  sanitizeLayout,
  type StatTableLayouts,
  type TableDensity,
  type TableLayout,
} from '@/lib/table-layout/statTableLayout'

/**
 * One store for every stat table on the page (lib/table-layout/statTableLayout.ts).
 *
 * Signed in, the layouts live on the account (/api/user/table-layout) and follow the manager across
 * devices. Signed out (the API answers 401) they live in this browser's storage instead. Changes apply
 * at once and are written behind; a failed write keeps the change on screen for this visit.
 *
 * Browser storage can be missing or throw (private windows, blocked storage), so every access is
 * guarded and the tables draw with their defaults whatever happens.
 */

const LOCAL_KEY = 'af.statTableLayouts.v1'

let state: StatTableLayouts = EMPTY_LAYOUTS
let mode: 'unknown' | 'account' | 'local' = 'unknown'
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function readLocal(): StatTableLayouts {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY)
    if (!raw) return EMPTY_LAYOUTS
    const o = JSON.parse(raw) as { tables?: unknown; density?: unknown }
    return readLayouts(o.tables, o.density)
  } catch {
    return EMPTY_LAYOUTS
  }
}

function writeLocal(s: StatTableLayouts) {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable: the change still holds for this visit */
  }
}

function ensureLoaded() {
  if (loading || typeof window === 'undefined') return
  loading = fetch('/api/user/table-layout', { cache: 'no-store' })
    .then(async (r) => {
      if (r.status === 401) {
        mode = 'local'
        state = readLocal()
      } else if (r.ok) {
        mode = 'account'
        const d = (await r.json()) as { tables?: unknown; density?: unknown }
        state = readLayouts(d.tables, d.density)
      } else {
        mode = 'local'
        state = readLocal()
      }
    })
    .catch(() => {
      mode = 'local'
      state = readLocal()
    })
    .finally(emit)
}

function put(body: Record<string, unknown>) {
  // Before the first read answers, the change goes to BOTH: whichever turns out to be the store has it.
  if (mode !== 'account') writeLocal(state)
  if (mode === 'local') return
  void fetch('/api/user/table-layout', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {})
}

function subscribe(l: () => void) {
  listeners.add(l)
  ensureLoaded()
  return () => listeners.delete(l)
}

/** For tests: forget everything this module holds. */
export function resetStatTableLayoutsForTest() {
  state = EMPTY_LAYOUTS
  mode = 'unknown'
  loading = null
}

export function useStatTableLayouts() {
  const s = useSyncExternalStore(subscribe, () => state, () => EMPTY_LAYOUTS)
  return {
    density: s.density,
    layoutFor: (tableId: string): TableLayout | null => s.tables[tableId] ?? null,
    setLayout: (tableId: string, layout: TableLayout | null) => {
      const tables = { ...state.tables }
      if (layout) tables[tableId] = sanitizeLayout(layout)
      else delete tables[tableId]
      state = { ...state, tables }
      emit()
      put({ tableId, layout })
    },
    setDensity: (density: TableDensity) => {
      state = { ...state, density }
      emit()
      put({ density })
    },
  }
}
