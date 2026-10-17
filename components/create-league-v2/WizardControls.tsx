'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * A checkbox that always shows whether it is ticked.
 *
 * 🛑 THE NATIVE BOX COULD NOT. `@tailwindcss/forms` draws checkboxes with `appearance: none`, a
 * `currentColor` fill and a WHITE tick. In dark mode the text colour is near-white, so a ticked
 * box was white-on-white: measured 2026-10-12 on the median-game box, fill rgba(255,255,255,.92)
 * with the white tick inside — managers could not tell their click had worked. The box here is
 * drawn from state (violet fill + white check when on), so it reads the same in both modes and
 * on every platform. The real input stays on top at full size and opacity 0, so tapping,
 * keyboard, screen readers and `locator('input').check()` all keep working.
 */
export function CheckBox({
  checked,
  onChange,
  disabled = false,
  testId,
  className,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  testId?: string
  className?: string
}) {
  return (
    <span className={cx('relative inline-grid h-5 w-5 shrink-0 place-items-center', className)}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="peer absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        data-testid={testId}
      />
      <span
        aria-hidden="true"
        data-checked={checked ? 'true' : 'false'}
        className={cx(
          'pointer-events-none grid h-5 w-5 place-items-center rounded-md border-2 transition-colors motion-reduce:transition-none',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-violet-500 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[color:var(--surface-app)]',
          checked ? 'border-violet-600 bg-violet-600 text-[#ffffff]' : 'border-[color:var(--text-tertiary)] bg-transparent',
          disabled && 'opacity-50',
        )}
      >
        {checked ? <Check className="h-3.5 w-3.5" strokeWidth={3.5} /> : null}
      </span>
    </span>
  )
}

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
