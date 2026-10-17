'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

/**
 * Tells a Sleeper manager why an offer they can see in Sleeper is not here, and how to get it graded.
 *
 * 🛑 SLEEPER'S PUBLIC FEED CARRIES A TRADE ONLY ONCE IT IS ACCEPTED. Measured on production 2026-09-28:
 * 2,154 Sleeper trades swept over 12 days of 5-minute sweeps and 28,167 archived trade rows, not one
 * ever seen pending. So an offer sent to you — or by you — reaches AllFantasy only after it is
 * accepted, and "no offers here" means "Sleeper does not tell us", never "nothing is waiting".
 *
 * Guap, 2026-09-30: every user must be told this, with the way through — enter each manager's assets
 * by hand and the builder grades it like any trade. The Trade Center inbox already carried a short
 * note; this is the notice for the screens people actually look at first (/core Trades, the league's
 * Trades tab). Dismissible per browser; it is guidance, not a warning, and a returning manager who has
 * read it should not have to scroll past it forever.
 */

/*
 * v2 (2026-09-30): the notice gained the screenshot upload. A manager who dismissed v1 has not been
 * told about it, so the key moved and they see the notice once more.
 */
const STORAGE_KEY = 'af:sleeper-offers-notice:v2'

/** Where the builder opens straight into "enter an offer by hand" — see `TradeCenter`'s `startWithOfferEntry`. */
export function sleeperOfferEntryHref(leagueId: string): string {
  return `/core/trades?league=${encodeURIComponent(leagueId)}&enter=offer`
}

export function SleeperOffersNotice(props: {
  /** One Sleeper league: the button opens its builder. Absent on a cross-league screen. */
  leagueId?: string | null
  className?: string
}) {
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === '1') setDismissed(true)
    } catch {
      /* Storage blocked (private window, preview): keep showing it — the safe default. */
    }
  }, [])

  if (dismissed) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      window.localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* Hidden for this visit only. */
    }
  }

  return (
    <aside
      role="note"
      aria-labelledby="af-sleeper-offers-title"
      data-testid="sleeper-offers-notice"
      className={`rounded-2xl border border-sky-400/30 bg-sky-400/[0.07] px-4 py-3 text-[13px] leading-relaxed text-white/80 ${props.className ?? ''}`}
    >
      <p id="af-sleeper-offers-title" className="font-bold text-white">
        Trade offers still waiting in Sleeper don&rsquo;t show up here
      </p>
      <p className="mt-1">
        Sleeper only shares a trade after it&rsquo;s accepted. Until then, an offer someone sent you &mdash; or one you
        sent &mdash; never reaches AllFantasy, so it can&rsquo;t appear here or be graded on its own.
      </p>
      <p className="mt-2 font-semibold text-white">
        To get a pending offer graded now, {props.leagueId ? 'open this league’s Trade Center' : 'open the league’s Trade Center'} and either:
      </p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        <li>
          <b>Upload a screenshot</b> &mdash; screenshot the offer in Sleeper and upload it. We read both sides and
          fill in the trade; check every asset against Sleeper, then Analyze.
        </li>
        <li>
          <b>Grade a Sleeper offer</b> by hand &mdash; pick the manager on the other side, then add every player,
          pick and FAAB each manager would send, exactly as Sleeper shows it, and Analyze.
        </li>
      </ul>
      <p className="mt-2">Either way you get the same grade as any trade in that league.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {props.leagueId ? (
          <Link
            href={sleeperOfferEntryHref(props.leagueId)}
            className="rounded-xl border border-sky-400/40 bg-sky-400/15 px-3 py-1.5 text-[12px] font-bold text-sky-100 hover:bg-sky-400/25"
          >
            Grade a Sleeper offer
          </Link>
        ) : null}
        <button
          type="button"
          onClick={dismiss}
          className="rounded-xl px-3 py-1.5 text-[12px] font-semibold text-white/60 hover:text-white"
        >
          Got it
        </button>
      </div>
    </aside>
  )
}
