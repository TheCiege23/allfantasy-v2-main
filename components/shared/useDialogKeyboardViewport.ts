'use client'

import { useEffect, type RefObject } from 'react'
import { computeKeyboardViewport } from '@/app/chimmy/hooks/useVisibleViewportHeight'

/** Fixed dialogs must follow the visual viewport: Android keyboards do not resize 100dvh. */
export function useDialogKeyboardViewport(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return
    const viewport = window.visualViewport
    const element = ref.current
    if (!viewport || !element) return

    let frame = 0
    const clear = () => {
      element.style.removeProperty('--af-dialog-height')
      element.style.removeProperty('--af-dialog-top')
    }
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const box = computeKeyboardViewport({
          visualHeight: viewport.height,
          visualOffsetTop: viewport.offsetTop,
          innerHeight: window.innerHeight,
          scale: viewport.scale,
        })
        if (!box) return clear()
        element.style.setProperty('--af-dialog-height', `${Math.round(box.height)}px`)
        element.style.setProperty('--af-dialog-top', `${Math.round(box.top)}px`)
      })
    }

    measure()
    viewport.addEventListener('resize', measure)
    viewport.addEventListener('scroll', measure)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener('resize', measure)
      viewport.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      clear()
    }
  }, [ref, active])
}
