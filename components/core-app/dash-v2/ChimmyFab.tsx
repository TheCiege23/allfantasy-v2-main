'use client'

import { useEffect, useRef, useState } from 'react'

import { CHIMMY_OPEN_EVENT } from '@/components/core-app/dash-v2/ChimmyAsk'

/**
 * Chimmy launcher — collapsed by default, opens only on click.
 *
 * ⚠ NOTHING IS GENERATED UNTIL THE USER ASKS. The handoff shows the panel already
 * open with an opening line ("You have an hour before the first lock…"). Shipping
 * that literally means every dashboard load spends Chimmy tokens, for every user,
 * whether or not they engage — dash34's loader already refuses to generate a brief
 * for exactly this reason:
 *
 *     "Chimmy is the only thing that spends tokens, and a home page that spends
 *      on every load would bill for a visit."
 *
 * It is the same failure mode as the per-league model calls that were removed
 * from the signed-in home, which billed on every page view.
 *
 * So: collapsed bubble, zero cost at rest. Opening the panel costs nothing
 * either — the thread starts empty and the first request is the user's.
 *
 * ⚠ NO UNREAD BADGE UNLESS THERE IS SOMETHING UNREAD. The handoff draws a red
 * count on the collapsed bubble. A badge with no unread message behind it is an
 * invented notification, so `unread` defaults to 0 and the dot is omitted.
 */
export function ChimmyFab({ unread = 0 }: { unread?: number }) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLElement | null>(null)

  /*
   * "Ask Chimmy" on the brief card opens this panel. The button is a sibling
   * several levels up the tree, and lifting this `useState` to DashboardV2 to
   * share it would make that screen a client component and ship its career,
   * portfolio, draft and week payloads to the browser. A window event is the
   * cheap seam.
   *
   * Opening still spends nothing — the thread starts empty either way. The
   * standing rule is about generation, not about visibility.
   */
  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(CHIMMY_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(CHIMMY_OPEN_EVENT, onOpen)
  }, [])

  /*
   * Focus moves into the panel when it opens. Without this, a keyboard or screen
   * reader user who presses "Ask Chimmy" at the top of the page is left with
   * focus on a button that has just vanished from the layout, and the panel that
   * replaced it is 2,000px away at the bottom of the document.
   */
  useEffect(() => {
    if (open) panelRef.current?.focus()
  }, [open])

  if (!open) {
    return (
      /*
       * The launcher is the "Ask Chimmy" pill plus the robot-king mark, per the
       * handoff. The label ships because a bare avatar in the corner does not
       * say what it does — and this is the one control on the screen that costs
       * tokens to use, so it should be opened deliberately rather than poked at.
       *
       * ⚠ THE ART ALREADY EXISTED AND NOTHING USED IT. public/af-robot-king.png
       * has been in the repo the whole time while this rendered the letters
       * "CH". Plain <img>, not next/image: a small static local asset where the
       * optimiser buys nothing.
       */
      <div className="af-d2-fab-wrap">
        <button
          type="button"
          className="af-d2-fab-pill"
          onClick={() => setOpen(true)}
        >
          Ask Chimmy
        </button>
        <button
          type="button"
          className="af-d2-fab"
          onClick={() => setOpen(true)}
          aria-label="Ask Chimmy"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="af-d2-fab-img" src="/af-robot-king.png" alt="" width={58} height={58} />
          {unread > 0 ? <span className="af-d2-fab-badge af-num">{unread}</span> : null}
        </button>
      </div>
    )
  }

  return (
    <section className="af-d2-chat" aria-label="Ask Chimmy" ref={panelRef} tabIndex={-1}>
      <header className="af-d2-chat-head">
        <span className="af-d2-chat-mark" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/af-robot-king.png" alt="" width={30} height={30} />
        </span>
        <span className="af-d2-chat-who">
          <span className="af-d2-chat-name">Chimmy</span>
          {/*
            The handoff's subtitle is "reading all 12 leagues". That describes work
            that is not happening — nothing is read until a question is asked — so
            the resting state says what is true instead.
          */}
          <span className="af-d2-chat-status af-num">READY WHEN YOU ARE</span>
        </span>
        <button
          type="button"
          className="af-d2-chat-min"
          onClick={() => setOpen(false)}
          aria-label="Minimise Chimmy"
        >
          –
        </button>
      </header>

      <div className="af-d2-chat-body">
        <p className="af-d2-chat-hint">
          Ask about a lineup, a trade or your waiver order. Chimmy reads the league
          you ask about — nothing runs until you send something.
        </p>
      </div>

      <div className="af-d2-chat-foot">
        <input
          className="af-d2-chat-input"
          placeholder="Ask Chimmy anything…"
          aria-label="Ask Chimmy anything"
          disabled
        />
        {/*
          Disabled until the send path is wired to the existing chat service. An
          input that silently drops what you typed is worse than one that says it
          is not ready yet.
        */}
        <span className="af-d2-chat-soon af-num">SEND NOT WIRED YET</span>
      </div>
    </section>
  )
}

export default ChimmyFab
