'use client'

import { COMMS_OPEN_EVENT } from './commsEvents'
import type { CommsTab } from './CommsDrawer'

/**
 * Opens the communications drawer from a server-rendered screen.
 *
 * ⚠ THIS EXISTS BECAUSE THE THING IT REPLACES NAVIGATED AWAY. `Dashboard34` —
 * the /core home — carried two Chimmy entry points, both `<Link href="/chimmy/chat">`,
 * and one of them was a floating bubble whose own comment read "Chat is a
 * floating bubble, not a tab". It looked like a chat bubble and behaved like a
 * page: clicking it left /core entirely and lost the reader's place, which is
 * precisely the failure 23a exists to prevent ("never a page you navigate to
 * and lose your place").
 *
 * The screen is a server component, so it cannot carry an onClick. A window
 * event is the cheap seam — the same one `ChimmyAsk` uses to reach `ChimmyFab`
 * on Dashboard V2, and for the same reason: lifting the drawer's open state up
 * to the screen would make that screen a client component and ship its whole
 * data payload to the browser.
 *
 * `/chimmy/chat` is still a real page and still reachable directly. What
 * changed is that a bubble inside /core no longer throws you at it.
 */
export function OpenCommsButton({
  className,
  tab = 'chimmy',
  label,
  children,
}: {
  className?: string
  /** Which tab to land on. Defaults to Chimmy — the private 1:1 assistant. */
  tab?: CommsTab
  /** Accessible name, when the visible text is not enough on its own. */
  label?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      onClick={() =>
        window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail: { tab } }))
      }
    >
      {children}
    </button>
  )
}

export default OpenCommsButton
