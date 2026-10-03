'use client'

import { useEffect, useId, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import './af-context-help.css'

/** One explanation per concept. Click/touch pins it; hover and focus also reveal it. */
export function ContextHelp({ title, body }: { title: string; body: string }) {
  const id = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(leaveTimer.current), [])
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const open = !dismissed && (hovered || focused || pinned)
  const enter = () => { clearTimeout(leaveTimer.current); setDismissed(false); setHovered(true) }
  const leave = () => { leaveTimer.current = setTimeout(() => setHovered(false), 180) }
  return (
    <Popover.Root open={open} onOpenChange={(next) => {
      setPinned(next)
      if (!next) { setHovered(false); setFocused(false); setDismissed(true) }
    }}>
      <Popover.Anchor asChild>
        <button ref={buttonRef} type="button" className="af-context-help" aria-label={`About ${title}`}
          aria-expanded={open} aria-controls={open ? id : undefined} aria-describedby={open ? id : undefined}
          onMouseEnter={enter}
          onMouseLeave={leave}
          onFocus={() => { setDismissed(false); setFocused(true) }}
          onBlur={() => setFocused(false)}
          onClick={() => {
            if (pinned) { setPinned(false); setDismissed(true) }
            else { setDismissed(false); setPinned(true) }
          }}>
          <span aria-hidden="true">?</span>
        </button>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content id={id} className="af-context-help-content" sideOffset={6} collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onMouseEnter={enter} onMouseLeave={leave}>
          <strong>{title}</strong>
          <p>{body}</p>
          <Popover.Close aria-label={`Close explanation for ${title}`} className="af-context-help-close"
            onClick={() => buttonRef.current?.focus()}>Close</Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
