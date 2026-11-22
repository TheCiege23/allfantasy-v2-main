"use client"

import { useEffect } from 'react'

/** Share the visible viewport with phone dialogs without changing browser zoom or scroll. */
export function MobileViewport() {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const root = document.documentElement
    const phone = window.matchMedia('(max-width: 720px), (pointer: coarse) and (max-height: 500px)')
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // Pinch zoom is not a software keyboard. Keep the normal layout while zooming.
        if (!phone.matches || Math.abs(viewport.scale - 1) > 0.05) {
          root.removeAttribute('data-phone-keyboard')
          root.style.removeProperty('--phone-visible-height')
          root.style.removeProperty('--phone-visible-top')
          return
        }
        const focused = document.activeElement
        const editing = focused instanceof HTMLElement &&
          (focused.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]), textarea') || focused.isContentEditable)
        root.style.setProperty('--phone-visible-height', `${viewport.height}px`)
        root.style.setProperty('--phone-visible-top', `${viewport.offsetTop}px`)
        root.toggleAttribute('data-phone-keyboard', editing && window.innerHeight - viewport.height > 150)
      })
    }
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', update)
    phone.addEventListener('change', update)
    update()
    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', update)
      phone.removeEventListener('change', update)
      root.removeAttribute('data-phone-keyboard')
      root.style.removeProperty('--phone-visible-height')
      root.style.removeProperty('--phone-visible-top')
    }
  }, [])
  return null
}
