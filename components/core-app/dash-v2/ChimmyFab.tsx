'use client'

import { useState } from 'react'

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

  if (!open) {
    return (
      <button
        type="button"
        className="af-d2-fab"
        onClick={() => setOpen(true)}
        aria-label="Ask Chimmy"
      >
        <span className="af-d2-fab-mark" aria-hidden>
          CH
        </span>
        {unread > 0 ? <span className="af-d2-fab-badge af-num">{unread}</span> : null}
      </button>
    )
  }

  return (
    <section className="af-d2-chat" aria-label="Ask Chimmy">
      <header className="af-d2-chat-head">
        <span className="af-d2-chat-mark" aria-hidden>
          CH
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
