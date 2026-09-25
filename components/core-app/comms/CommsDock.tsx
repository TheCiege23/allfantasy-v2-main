'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { MessageSquare } from 'lucide-react'
import CommsDrawer, { type CommsLeague, type CommsTab } from './CommsDrawer'
import SupportModal from '@/components/core-app/support/SupportModal'
import { useDraggableLauncher } from './useDraggableLauncher'
import { COMMS_OPEN_EVENT, SUPPORT_OPEN_EVENT, type CommsOpenDetail } from './commsEvents'
import type { CoreSurfaceKey } from '@/lib/core-app/coreSurface'
import type { ChimmyPlanAllowanceView } from '@/lib/chimmy/planAllowanceView'

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
  /** Included Chimmy answers left today when the plan includes Chimmy (lib/chimmy/planAllowance.ts). */
  chimmyPlanAllowance?: ChimmyPlanAllowanceView | null
  /** Ids+counts the /core home is showing — see lib/core-app/homeSignals.ts. */
  homeSignals?: string | null
  /** Current Core workflow. Sent as a validated key, never as free-form prompt text. */
  pageSurface?: CoreSurfaceKey | null
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
  /**
   * Messages that NAME you. Badged differently from ordinary unread on purpose:
   * a mention needs a reply, and collapsing the two is how a badge becomes noise
   * that people clear without reading.
   */
  mentions?: number
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
  chimmyPlanAllowance = null,
  homeSignals = null,
  pageSurface = null,
  dockable = false,
  supportEmail = null,
  unread = 0,
  mentions = 0,
}: CommsDockProps) {
  const { data: session } = useSession()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<CommsTab>('chimmy')
  const [prefill, setPrefill] = useState<string | null>(null)
  const [openRequest, setOpenRequest] = useState<{
    seq: number
    tab: CommsTab | null
    leagueId: string | null
  } | null>(null)
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
      const detail = (e as CustomEvent<CommsOpenDetail>).detail
      if (detail?.tab) setTab(detail.tab)
      /*
       * Seeds the composer. Held in state rather than passed straight down so a
       * second open with no prefill clears the first one's question instead of
       * leaving a stale sentence in the box.
       */
      setPrefill(detail?.prefill ?? null)
      setOpenRequest((prev) => ({
        seq: (prev?.seq ?? 0) + 1,
        tab: detail?.tab ?? null,
        leagueId: detail?.leagueId ?? null,
      }))
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

  /*
   * The bubble can be dragged anywhere along either edge and remembers where, per
   * device class — see useDraggableLauncher. It is still UNMOUNTED while the
   * drawer is open, which is what guarantees it never sits on top of the
   * composer: there is nothing to cover it with.
   */
  const launchRef = useRef<HTMLButtonElement | null>(null)
  const launcher = useDraggableLauncher(launchRef, !open)

  return (
    <>
      {!open ? (
        <button
          ref={launchRef}
          type="button"
          className="af-cm-launch"
          style={launcher.style}
          data-dragging={launcher.dragging || undefined}
          data-moved={launcher.moved || undefined}
          {...launcher.handlers}
          onClick={() => {
            /* The click a browser fires at the end of a drag is not a tap. */
            if (launcher.consumeDragClick()) return
            setOpen(true)
          }}
          title="Open chat — drag to move"
          aria-label={
            mentions > 0
              ? `Open communications (${mentions} mention${mentions === 1 ? '' : 's'}, ${unread} unread)`
              : unread > 0
                ? `Open communications (${unread} unread)`
                : 'Open communications'
          }
        >
          {/*
            Founder direction, verbatim: "the chat is supposed to be a bubble".
            A round icon bubble — the accessible name lives on aria-label, and
            the unread count stays visible as the badge it always was.
          */}
          <MessageSquare className="af-cm-launch-icon" size={22} aria-hidden />
          {/*
            One badge, two voices. A mention turns it accent-coloured and marks
            it with an @; ordinary unread stays quiet. Two separate badges on one
            small bubble would be unreadable, and the louder state is the one
            worth the pixels.
          */}
          {unread > 0 ? (
            <span className="af-cm-launchdot" data-kind={mentions > 0 ? 'mention' : 'unread'}>
              {mentions > 0 ? '@' : ''}
              {unread}
            </span>
          ) : null}
        </button>
      ) : null}

      <CommsDrawer
        key={session?.user?.id ?? 'anonymous'}
        userId={session?.user?.id}
        mode={mode}
        open={open}
        onClose={close}
        leagues={leagues}
        pageLeagueId={pageLeagueId}
        chimmyTokenCost={chimmyTokenCost}
        chimmyPlanAllowance={chimmyPlanAllowance}
        homeSignals={homeSignals}
        pageSurface={pageSurface}
        initialTab={tab}
        initialDraft={prefill}
        openRequest={openRequest}
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
