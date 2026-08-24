'use client'

import { useCallback, useEffect, useState } from 'react'
import CommsDrawer, { type CommsLeague, type CommsTab } from './CommsDrawer'
import SupportModal from '@/components/core-app/support/SupportModal'
import { COMMS_OPEN_EVENT, SUPPORT_OPEN_EVENT } from './commsEvents'

/**
 * Mounts the communications drawer (23a/23b) and the support modal (25b) once,
 * in the shell, so every /core screen inherits both.
 *
 * ⚠ MOUNTED IN THE SHELL, NOT PER SCREEN. The drawer's whole product argument is
 * "never a page you navigate to and lose your place" — a per-screen mount would
 * unmount it on navigation, which is the failure it exists to avoid. Same reason
 * the read-only chip and the geo notice live in the shell.
 *
 * ⚠ DOCKED IS CHOSEN BY THE PAGE, NOT BY THE VIEWPORT ALONE. 23b docks beside a
 * roster or matchup — screens where you are reading one league and asking about
 * it — and overlays everywhere else, because a cross-league dashboard has no
 * "place" to lose. `dockable` carries that decision from the route.
 *
 * ⚠ NOTHING SPENDS ON MOUNT. Opening the drawer costs nothing; the first request
 * is the user's. Same standing constraint as ChimmyFab, and for the same reason:
 * a panel that generated an opening line would bill every page view.
 */

export type CommsDockProps = {
  leagues: CommsLeague[]
  /** The league the current page is about — drives 23b's auto-scoping. */
  pageLeagueId: string | null
  /** Tokens per Chimmy answer, from the real pricing matrix. Null = not charged. */
  chimmyTokenCost: number | null
  /** Ids+counts the /core home is showing — see lib/core-app/homeSignals.ts. */
  homeSignals?: string | null
  /** True on league-scoped screens, where docking beside the content pays off. */
  dockable?: boolean
  /** Prefills the support form's reply address. */
  supportEmail?: string | null
  /**
   * Unread count for the launcher badge. Carried over from the /core home's old
   * floating bubble, which this launcher replaced — dropping it would have been
   * a silent feature loss. Omitted or zero renders no badge, per the standing
   * rule that a badge with nothing behind it is an invented notification.
   */
  unread?: number
}

/*
 * Re-exported for existing importers. The definitions moved to `commsEvents.ts`
 * so SERVER components can reach them without pulling this client module —
 * see that file's header.
 */
export { COMMS_OPEN_EVENT, SUPPORT_OPEN_EVENT }

export function CommsDock({
  leagues,
  pageLeagueId,
  chimmyTokenCost,
  homeSignals = null,
  dockable = false,
  supportEmail = null,
  unread = 0,
}: CommsDockProps) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<CommsTab>('chimmy')
  const [supportOpen, setSupportOpen] = useState(false)
  const [wide, setWide] = useState(false)

  /*
   * Docked needs room. Below 1200px the page has none to give up, so the same
   * component falls back to overlay — see the media query in af-comms.css, which
   * has to agree with this breakpoint.
   */
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1200px)')
    const sync = () => setWide(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const openComms = (e: Event) => {
      const detail = (e as CustomEvent<{ tab?: CommsTab }>).detail
      if (detail?.tab) setTab(detail.tab)
      setOpen(true)
    }
    const openSupport = () => setSupportOpen(true)
    window.addEventListener(COMMS_OPEN_EVENT, openComms)
    window.addEventListener(SUPPORT_OPEN_EVENT, openSupport)
    return () => {
      window.removeEventListener(COMMS_OPEN_EVENT, openComms)
      window.removeEventListener(SUPPORT_OPEN_EVENT, openSupport)
    }
  }, [])

  const mode = dockable && wide ? 'docked' : 'overlay'

  /*
   * The shell reflows for a docked panel rather than letting it cover content.
   * Set on the shell element because that is what owns the page's width — the
   * drawer cannot push a parent it is a child of.
   */
  useEffect(() => {
    const shell = document.querySelector('.af-shell')
    if (!shell) return
    if (open && mode === 'docked') shell.setAttribute('data-comms-docked', 'true')
    else shell.removeAttribute('data-comms-docked')
    return () => shell.removeAttribute('data-comms-docked')
  }, [open, mode])

  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      {!open ? (
        <button
          type="button"
          className="af-cm-launch"
          onClick={() => setOpen(true)}
          aria-label={unread > 0 ? `Open communications (${unread} unread)` : 'Open communications'}
        >
          {/*
            Founder direction, verbatim: "the chat is supposed to be a bubble".
            A round icon bubble — the accessible name lives on aria-label, and
            the unread count stays visible as the badge it always was.
          */}
          <svg
            className="af-cm-launch-icon"
            viewBox="0 0 24 24"
            width="26"
            height="26"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
          {unread > 0 ? <span className="af-cm-launchdot">{unread}</span> : null}
        </button>
      ) : null}

      <CommsDrawer
        mode={mode}
        open={open}
        onClose={close}
        leagues={leagues}
        pageLeagueId={pageLeagueId}
        chimmyTokenCost={chimmyTokenCost}
        homeSignals={homeSignals}
        initialTab={tab}
      />

      <SupportModal
        open={supportOpen}
        onClose={() => setSupportOpen(false)}
        defaultEmail={supportEmail}
        leagues={leagues.map((l) => ({ id: l.id, name: l.name }))}
        pageLeagueId={pageLeagueId}
      />
    </>
  )
}

export default CommsDock
