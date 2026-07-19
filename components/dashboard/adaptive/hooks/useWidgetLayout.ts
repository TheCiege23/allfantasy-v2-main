'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DeviceKind } from './useDeviceKind'

/**
 * Persisted per-surface widget layout — order + hidden set.
 *
 * Seeded by the KPI row, but deliberately generic (`surface`, arbitrary key list) because
 * the handoff calls this "the seed of a future pin/resize/rearrange widget system": adding
 * a second customisable surface should mean passing a different `surface` string, not
 * writing a second hook.
 *
 * Storage is keyed by surface + role + device, so a commissioner's tablet layout and a free
 * manager's phone layout don't overwrite each other. Unknown keys in a stored layout are
 * dropped on read and new keys are appended, so shipping a new widget doesn't strand users
 * on a stale layout that hides it forever.
 */

export type WidgetLayout = {
  /** Visible widget keys, in render order. */
  visible: string[]
  /** Keys the user has hidden, restorable from the "Hidden:" chip row. */
  hidden: string[]
  isCustomised: boolean
  move: (key: string, direction: -1 | 1) => void
  hide: (key: string) => void
  show: (key: string) => void
  reset: () => void
}

type Stored = { order?: unknown; hidden?: unknown }

const STORAGE_PREFIX = 'af-widgets'

export function widgetLayoutKey(surface: string, role: string, device: DeviceKind): string {
  return `${STORAGE_PREFIX}:${surface}:${role}:${device}`
}

export function useWidgetLayout(
  surface: string,
  defaultKeys: readonly string[],
  role: string,
  device: DeviceKind,
  /**
   * Keys that exist in the catalogue but start hidden — extra widgets the user can add from
   * the "Hidden:" row. Lets the default view match the design's widget count while still
   * shipping the alternatives, instead of choosing between them at build time.
   */
  defaultHidden: readonly string[] = [],
): WidgetLayout {
  const storageKey = widgetLayoutKey(surface, role, device)
  const [order, setOrder] = useState<string[]>([])
  const [hidden, setHidden] = useState<string[]>([])

  // Re-read whenever the key changes — switching role or device loads THAT layout, which is
  // the whole point of keying by it. Reading in an effect (not lazily in useState) is
  // deliberate: the key is not stable for the component's lifetime.
  useEffect(() => {
    let next: Stored = {}
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw) next = JSON.parse(raw) as Stored
    } catch {
      // Private mode / quota / corrupt JSON — fall back to defaults rather than breaking the row.
    }
    const storedOrder = Array.isArray(next.order) ? next.order.filter((k): k is string => typeof k === 'string') : []
    const storedHidden = Array.isArray(next.hidden) ? next.hidden.filter((k): k is string => typeof k === 'string') : []
    setOrder(storedOrder)
    // No saved layout → apply the catalogue's default-hidden set. Once the user has customised,
    // their choices win outright, so re-showing an extra widget isn't undone on reload.
    setHidden(storedOrder.length === 0 && storedHidden.length === 0 ? [...defaultHidden] : storedHidden)
    // `defaultHidden` is a module-level constant at every call site; re-running on identity
    // change would reset the user's layout on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  const persist = useCallback((nextOrder: string[], nextHidden: string[]) => {
    try {
      // An empty layout is the "never customised" state — remove the row rather than
      // storing `{order:[],hidden:[]}`, so a future default-order change reaches the user.
      if (nextOrder.length === 0 && nextHidden.length === 0) window.localStorage.removeItem(storageKey)
      else window.localStorage.setItem(storageKey, JSON.stringify({ order: nextOrder, hidden: nextHidden }))
    } catch {
      // Persistence is best-effort; the in-memory layout still applies for this session.
    }
  }, [storageKey])

  /**
   * Stored order ∩ known keys, then any key the user has never seen appended in default
   * position. Guarantees a newly-shipped widget appears instead of being silently dropped
   * because it wasn't in a layout saved months ago.
   */
  const resolvedOrder = useMemo(() => {
    const known = new Set(defaultKeys)
    const fromStore = order.filter((k) => known.has(k))
    const seen = new Set(fromStore)
    return [...fromStore, ...defaultKeys.filter((k) => !seen.has(k))]
  }, [order, defaultKeys])

  const visible = useMemo(
    () => resolvedOrder.filter((k) => !hidden.includes(k)),
    [resolvedOrder, hidden],
  )

  /*
   * All three mutators compute the next layout OUTSIDE the state updater and persist from
   * there. Writing to localStorage inside a `setState(prev => …)` callback fires twice under
   * StrictMode's double-invoke, and makes the updater impure for no benefit — these actions
   * are user-driven and never batch against each other.
   */
  const move = useCallback((key: string, direction: -1 | 1) => {
    // Reorder the VISIBLE sequence — moving past a hidden widget would look like a no-op to
    // the user, since they can't see the slot it swapped into.
    const current = resolvedOrder.filter((k) => !hidden.includes(k))
    const i = current.indexOf(key)
    const j = i + direction
    if (i < 0 || j < 0 || j >= current.length) return
    const swapped = [...current]
    ;[swapped[i], swapped[j]] = [swapped[j], swapped[i]]
    // Re-merge the hidden keys so their relative position survives an unhide.
    const next = [...swapped, ...resolvedOrder.filter((k) => hidden.includes(k))]
    setOrder(next)
    persist(next, hidden)
  }, [resolvedOrder, hidden, persist])

  const hide = useCallback((key: string) => {
    if (hidden.includes(key)) return
    const next = [...hidden, key]
    setHidden(next)
    persist(resolvedOrder, next)
  }, [hidden, resolvedOrder, persist])

  const show = useCallback((key: string) => {
    if (!hidden.includes(key)) return
    const next = hidden.filter((k) => k !== key)
    setHidden(next)
    persist(resolvedOrder, next)
  }, [hidden, resolvedOrder, persist])

  const reset = useCallback(() => {
    setOrder([])
    // Reset means "back to the shipped default", which includes the default-hidden extras —
    // not "show everything". Persisting nothing keeps this the uncustomised state.
    setHidden([...defaultHidden])
    persist([], [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persist])

  // "Customised" means differing from the shipped default, not "has any hidden widget" —
  // otherwise the default-hidden extras would make a never-touched row look customised and
  // leave "Reset Layout" permanently offered.
  const isDefaultHidden = hidden.length === defaultHidden.length
    && hidden.every((k) => defaultHidden.includes(k))

  return {
    visible,
    hidden: hidden.filter((k) => defaultKeys.includes(k)),
    isCustomised: order.length > 0 || !isDefaultHidden,
    move, hide, show, reset,
  }
}
