'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import {
  clampLauncher,
  exceedsDragThreshold,
  launcherDevice,
  launcherStorageKey,
  parseStoredLauncher,
  snapLauncher,
  type LauncherBounds,
  type LauncherPosition,
} from './launcherPosition'

/**
 * Drag the chat bubble with a mouse, a finger or a pen; a tap still opens it.
 *
 * ⚠ ONE BUTTON, TWO GESTURES, SEPARATED BY DISTANCE. A press that travels less
 * than `DRAG_THRESHOLD_PX` is a tap and the button's own click opens the drawer
 * exactly as before. Past the threshold it is a drag, and the click the browser
 * fires on release is swallowed — otherwise every move would also open the chat.
 *
 * ⚠ KEYBOARD USERS ARE UNTOUCHED. Enter and Space fire `click` with no pointer
 * down before them, so nothing here ever intercepts them.
 *
 * ⚠ STORAGE IS A CONVENIENCE AND IS ALLOWED TO FAIL. Private windows, blocked
 * site data and quota errors all throw from localStorage; every access is
 * wrapped, and the bubble simply stays where the stylesheet puts it.
 */

const TOP_RESERVE_PX = 72

function readStored(key: string): LauncherPosition | null {
  try {
    return parseStoredLauncher(window.localStorage.getItem(key))
  } catch {
    return null
  }
}

function writeStored(key: string, p: LauncherPosition): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(p))
  } catch {
    /* A position that is not remembered is still a position. */
  }
}

function px(value: string | null | undefined, fallback: number): number {
  const n = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(n) ? n : fallback
}

/**
 * `visible` is whether the bubble is on screen right now. CommsDock unmounts it
 * while the drawer is open, so the remembered spot has to be re-applied each
 * time it comes back rather than only once on page load.
 */
export function useDraggableLauncher(ref: RefObject<HTMLElement | null>, visible = true) {
  const [position, setPosition] = useState<LauncherPosition | null>(null)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  /* The stylesheet's own offsets, read once while no inline style overrides them. */
  const defaults = useRef<{ inset: number; bottom: number; size: number } | null>(null)
  const press = useRef<{ id: number; startX: number; startY: number; dragging: boolean } | null>(null)
  const swallowClick = useRef(false)

  const measureDefaults = useCallback(() => {
    const el = ref.current
    if (!el || typeof window === 'undefined') return null
    if (!defaults.current) {
      const cs = window.getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      defaults.current = {
        inset: px(cs.right, 18),
        bottom: px(cs.bottom, 18),
        size: rect.width || 56,
      }
    }
    return defaults.current
  }, [ref])

  const bounds = useCallback((): LauncherBounds | null => {
    const d = measureDefaults()
    if (!d) return null
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      size: d.size,
      minBottom: d.bottom,
      topReserve: TOP_RESERVE_PX,
    }
  }, [measureDefaults])

  /* Load the remembered spot for this device class, and re-clamp when the window changes. */
  useEffect(() => {
    if (typeof window === 'undefined' || !visible) return
    let device = launcherDevice(window.innerWidth)
    const apply = () => {
      const b = bounds()
      const stored = readStored(launcherStorageKey(device))
      setPosition(stored && b ? clampLauncher(stored, b) : null)
    }
    apply()
    const onResize = () => {
      const next = launcherDevice(window.innerWidth)
      if (next !== device) {
        device = next
        /* A new device class starts from ITS stylesheet default; re-measure it. */
        defaults.current = null
        setPosition(null)
        requestAnimationFrame(apply)
        return
      }
      apply()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [bounds, visible])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      measureDefaults()
      press.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, dragging: false }
      swallowClick.current = false
      /*
       * ⚠ CAPTURE ON PRESS, NOT ON THE FIRST MOVE. A touch is implicitly captured by
       * the element it started on; a MOUSE is not. A quick mouse drag leaves the 56px
       * bubble on its first move event, which then lands on the page and the drag
       * never starts — measured in Chromium before this line existed.
       */
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* jsdom and some old engines lack capture; touch still tracks. */
      }
    },
    [measureDefaults],
  )

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    if (!p.dragging) {
      if (!exceedsDragThreshold(e.clientX - p.startX, e.clientY - p.startY)) return
      p.dragging = true
    }
    setDrag({ x: e.clientX, y: e.clientY })
  }, [])

  const finish = useCallback(
    (e: ReactPointerEvent<HTMLElement>, commit: boolean) => {
      const p = press.current
      if (!p || p.id !== e.pointerId) return
      press.current = null
      if (!p.dragging) return
      swallowClick.current = true
      setDrag(null)
      if (!commit) return
      const b = bounds()
      if (!b) return
      const next = snapLauncher({ x: e.clientX, y: e.clientY }, b)
      setPosition(next)
      writeStored(launcherStorageKey(launcherDevice(b.viewportWidth)), next)
    },
    [bounds],
  )

  /** Returns true when the click belongs to a drag and must not open the drawer. */
  const consumeDragClick = useCallback((): boolean => {
    if (!swallowClick.current) return false
    swallowClick.current = false
    return true
  }, [])

  let style: CSSProperties | undefined
  const d = defaults.current
  if (drag && d) {
    style = {
      left: Math.round(drag.x - d.size / 2),
      top: Math.round(drag.y - d.size / 2),
      right: 'auto',
      bottom: 'auto',
    }
  } else if (position && d) {
    style =
      position.side === 'left'
        ? { left: d.inset, right: 'auto', bottom: position.bottom }
        : { right: d.inset, left: 'auto', bottom: position.bottom }
  }

  return {
    style,
    dragging: Boolean(drag),
    moved: Boolean(position),
    consumeDragClick,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e: ReactPointerEvent<HTMLElement>) => finish(e, true),
      onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => finish(e, false),
    },
  }
}
