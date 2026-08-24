'use client'

import { useCallback, useEffect, useState } from 'react'
import CommsDrawer, { type CommsLeague, type CommsTab } from './CommsDrawer'
import SupportModal from '@/components/core-app/support/SupportModal'

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
  /** True on league-scoped screens, where docking beside the content pays off. */
  dockable?: boolean
  /** Prefills the support form's reply address. */
  supportEmail?: string | null
}

/** Opens the drawer from anywhere — nav links, empty states, keyboard. */
export const COMMS_OPEN_EVENT = 'af-comms-open'
/** Opens the support modal from anywhere. */
export const SUPPORT_OPEN_EVENT = 'af-support-open'

export function CommsDock({
  leagues,
  pageLeagueId,
  chimmyTokenCost,
  dockable = false,
  supportEmail = null,
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
          aria-label="Open communications"
        >
          Chat
          <span aria-hidden>›</span>
        </button>
      ) : null}

      <CommsDrawer
        mode={mode}
        open={open}
        onClose={close}
        leagues={leagues}
        pageLeagueId={pageLeagueId}
        chimmyTokenCost={chimmyTokenCost}
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
