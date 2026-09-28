'use client'

import { useEffect, type RefObject } from 'react'
import { computeKeyboardViewport } from '@/app/chimmy/hooks/useVisibleViewportHeight'

/**
 * Keep the drawer — and so its composer — above the on-screen keyboard.
 *
 * 🛑 THE MESSAGE BOX WAS HIDING BEHIND THE KEYBOARD. af-comms.css sized the phone
 * drawer from `var(--af-comms-vh, 100dvh)`, and NOTHING SET `--af-comms-vh`, so it
 * was always `100dvh` — which accounts for the browser's collapsing toolbar and
 * NOT for the keyboard (the viewport's `interactive-widget` defaults to
 * `resizes-visual`: the visual viewport shrinks, the layout one does not). Focus
 * the composer, the keyboard opens, the drawer stays full height, and the box you
 * are typing into sits underneath it.
 *
 * This writes the missing variables from `visualViewport` while a keyboard is up
 * — `--af-comms-vh` (visible height) and `--af-comms-vv-top` (how far iOS has
 * scrolled the visual viewport) — and marks the drawer `data-keyboard="open"`,
 * which the stylesheet uses to pin the panel to the visible region. With no
 * keyboard it removes them all, and the stylesheet is exactly as it was.
 *
 * ⚠ WHY NOT `interactive-widget=resizes-content` IN THE ROOT VIEWPORT. It would
 * change keyboard behaviour on every page of the app (the phone tab bar would
 * ride up over the keyboard on every form), iOS Safari ignores it anyway, and no
 * real device is available here to check it. This is scoped to the drawer and
 * reversible. Same reasoning `useVisibleViewportHeight` records for /chimmy/chat.
 */
export function useCommsKeyboardInset(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active || typeof window === 'undefined') return
    const vv = window.visualViewport
    if (!vv) return

    let frame = 0
    const clear = (el: HTMLElement) => {
      el.style.removeProperty('--af-comms-vh')
      el.style.removeProperty('--af-comms-vv-top')
      el.removeAttribute('data-keyboard')
    }
    const apply = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const el = ref.current
        if (!el) return
        const box = computeKeyboardViewport({
          visualHeight: vv.height,
          visualOffsetTop: vv.offsetTop,
          innerHeight: window.innerHeight,
          scale: vv.scale,
        })
        if (!box) {
          clear(el)
          return
        }
        el.style.setProperty('--af-comms-vh', `${Math.round(box.height)}px`)
        el.style.setProperty('--af-comms-vv-top', `${Math.round(box.top)}px`)
        el.setAttribute('data-keyboard', 'open')
      })
    }

    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      cancelAnimationFrame(frame)
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      if (ref.current) clear(ref.current)
    }
  }, [ref, active])
}
