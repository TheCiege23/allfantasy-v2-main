'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

// CheckBox moved to components/ui/checkbox.tsx; re-exported here so existing callers are unchanged.
export { CheckBox } from '@/components/ui/checkbox'

/**
 * A "?" that explains a choice. Tap to open, tap again, tap elsewhere or press Escape to close —
 * never hover-only, because phones have no hover.
 *
 * The note is positioned with `fixed` coordinates clamped to the viewport (16px gutters), so it
 * can never push the page sideways on a 375px screen the way an absolutely-positioned bubble near
 * the right edge would.
 */
export function HelpTip({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const noteRef = useRef<HTMLDivElement | null>(null)
  const noteId = useId()

  const place = useCallback(() => {
    const button = buttonRef.current
    if (!button || typeof window === 'undefined') return
    const rect = button.getBoundingClientRect()
    const gutter = 16
    const width = Math.min(288, window.innerWidth - gutter * 2)
    const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, gutter), window.innerWidth - gutter - width)
    setPosition({ top: rect.bottom + 8, left, width })
  }, [])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || noteRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(event) => {
          // Inside a <label> a click would also toggle the label's control; a help tap must not.
          event.preventDefault()
          event.stopPropagation()
          setOpen((value) => !value)
        }}
        aria-label={`What is ${label}?`}
        aria-expanded={open}
        aria-controls={open ? noteId : undefined}
        className="relative ml-1.5 inline-grid h-5 w-5 shrink-0 touch-manipulation place-items-center rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] align-middle text-[11px] font-black normal-case tracking-normal text-[color:var(--text-secondary)] transition hover:border-violet-400 hover:text-violet-600 before:absolute before:-inset-3 before:content-[''] dark:hover:text-violet-300"
        data-testid={testId}
      >
        ?
      </button>
      {open && position ? (
        <div
          ref={noteRef}
          id={noteId}
          role="note"
          style={{ position: 'fixed', top: position.top, left: position.left, width: position.width }}
          className="z-50 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] p-3 text-left text-sm font-normal normal-case leading-6 tracking-normal text-[color:var(--text-primary)] shadow-2xl"
          data-testid={testId ? `${testId}-note` : undefined}
        >
          {children}
        </div>
      ) : null}
    </>
  )
}
