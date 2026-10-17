'use client'

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * The "?" — one way, everywhere in /core, to explain a term, a number or where a figure comes from.
 *
 * ⚠ A `title` IS NOT AN EXPLANATION ON A TOUCH SCREEN. Most of /core explained itself through
 * `title=` attributes (334 of them on 2026-10-03), which a phone and an iPad never show and a
 * keyboard cannot reach. This is a real button driving a native popover: tap, click, Enter and
 * Space open it; Escape and click-away close it; focus handling comes from the platform rather
 * than from state this component keeps. My Team's projection heading was the first; this is that
 * control, generalised.
 *
 * ⚠ USE IT WHERE SOMETHING NEEDS EXPLAINING, NOT ON EVERY LABEL. An abbreviation, a number a model
 * produced, the source of a figure. A row that repeats sixteen times gets ONE tip at its heading
 * (or a key), never one per row — a "?" on everything is noise, and noise teaches people to stop
 * opening them.
 *
 * ⚠ THE POPOVER LIVES INSIDE THE WRAPPER, beside its button. Rendered as a sibling of the host's
 * own children it would shift any `nth-child` rule the host uses (My Team's narrow page hides the
 * 3rd and 4th headings that way). Hidden until opened and in the top layer once it is, so it never
 * takes a cell. A <span popover>, not a <div>, so it is valid inside inline content — which is also
 * why a paragraph inside it is `<span className="af-info-para">`, never a `<p>`.
 *
 * ⚠ AND NO `title` ON ANY ANCESTOR. The popover is a DOM descendant of whatever the tip sits in, so
 * a `title` there pops a second, hover-only tooltip over the open popover.
 *
 * `label` is the button's accessible name ("What OWN and START mean"); `title` heads the popover.
 * `className`/`popClassName` add a host's own classes without replacing the shared ones.
 */
export function InfoTip({
  label,
  title,
  children,
  className,
  popClassName,
}: {
  label: string
  title?: ReactNode
  children: ReactNode
  className?: string
  popClassName?: string
}) {
  const id = useId()
  const popover = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const anchor = useRef<{top: number; left: number} | null>(null)
  const pinned = useRef(false)
  const suppressFocus = useRef(false)
  const [expanded, setExpanded] = useState(false)
  const [interactive, setInteractive] = useState(false)
  const es = useOptionalLanguage().language === 'es'
  const show = (keyboard = false) => {
    const node = popover.current
    if (!node || typeof node.showPopover !== 'function') return
    const bounds = trigger.current?.getBoundingClientRect()
    anchor.current = bounds ? { top: bounds.top, left: bounds.left } : null
    setInteractive(pinned.current || keyboard)
    node.showPopover()
    setExpanded(true)
  }
  const hide = useCallback(() => {
    // Native dismissal restores focus; that restoration must not reopen the preview.
    suppressFocus.current = true
    popover.current?.hidePopover?.()
    pinned.current = false
    setExpanded(false)
    setInteractive(false)
    queueMicrotask(() => { suppressFocus.current = false })
  }, [])
  useEffect(() => {
    const node = popover.current
    const onToggle = (event: Event) => {
      if ('newState' in event && event.newState === 'closed') {
        pinned.current = false
        setExpanded(false)
      }
    }
    node?.addEventListener('toggle', onToggle)
    return () => node?.removeEventListener('toggle', onToggle)
  }, [])
  useEffect(() => {
    if (!expanded) return
    // A top-layer popover must not cover unrelated controls after its anchor scrolls.
    const dismiss = () => {
      const bounds = trigger.current?.getBoundingClientRect()
      if (!bounds || !anchor.current || bounds.top !== anchor.current.top || bounds.left !== anchor.current.left) hide()
    }
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [expanded, hide])
  return (
    <span className="af-info-tip-wrap"
      onKeyDownCapture={event => {
        if (event.key === 'Escape' && typeof popover.current?.hidePopover === 'function' && popover.current.matches(':popover-open')) {
          // Consume Escape in this open popover before restoring trigger focus.
          event.preventDefault()
          event.stopPropagation()
          suppressFocus.current = true
          hide()
          trigger.current?.focus()
          queueMicrotask(() => { suppressFocus.current = false })
        }
      }}
      onMouseEnter={() => { if (window.matchMedia?.('(hover: hover)')?.matches) show() }}
      onMouseLeave={() => { if (!pinned.current) hide() }}
      onBlur={event => { if (!pinned.current && !event.currentTarget.contains(event.relatedTarget as Node | null)) hide() }}
    >
      <button
        ref={trigger}
        type="button"
        className={`af-info-tip${className ? ` ${className}` : ''}`}
        popoverTarget={id}
        aria-label={label}
        aria-expanded={expanded}
        aria-controls={id}
        onFocus={() => { if (suppressFocus.current) { suppressFocus.current = false; return }; show(true) }}
        onClick={event => {
          // Clicking a hover preview pins it. A second click closes it.
          event.preventDefault()
          if (pinned.current) hide()
          else { pinned.current = true; show(true) }
        }}
      >
        ?
      </button>
      <span ref={popover} id={id} popover="auto" style={{ pointerEvents: interactive ? 'auto' : 'none' }} className={`af-info-pop${popClassName ? ` ${popClassName}` : ''}`} role="note">
        {title ? <strong>{title}</strong> : null}
        <span className="af-info-pop-body">{children}</span>
        <button type="button" hidden={!expanded || !interactive} className="af-info-close" onClick={() => { suppressFocus.current = true; hide(); trigger.current?.focus() }}>
          {es ? 'Cerrar' : 'Close'}
        </button>
      </span>
    </span>
  )
}
