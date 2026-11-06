import '@/components/core-app/af-screen-skeleton.css'
import { Suspense } from 'react'
import ScreenLoadError from '@/components/core-app/ScreenLoadError'
import Trades from '@/components/core-app/screens/Trades'
import type { TradeRecord, TradesData } from '@/lib/core-app/trades'
import { tradesScreenMessages } from '@/lib/core-app/messages/tradesScreen'
import { messagesFor } from '@/lib/i18n/messages'

/**
 * The Trades screen's slow half, streamed in under a Trade Center that has already painted
 * (2026-11-06).
 *
 * ⚠ WHY THIS IS A SEPARATE BOUNDARY. On a cold load the Sleeper trade history takes 19–30s (measured
 * read-only against production; see `readTradesSections` in lib/core-app/trades.ts). The page used to
 * await the whole screen's data before drawing anything, so the header, the league strip and the
 * builder — none of which read the history — sat behind a skeleton for that long. Now the page awaits
 * only `startTradesRead`'s shell and hands the rest here as a promise.
 *
 * What lands is exactly what rendered before: `<Trades data hidePending />` over the same `TradesData`.
 *
 * 🛑 A FAILED READ SHOWS THE SCREEN'S OWN "DID NOT LOAD" CARD IN THIS SLOT, not an error boundary and
 * not a blank: it is the state a failed trades read has always shown (ScreenLoadError), now confined to
 * the part that failed, with the same try-again link. The header above it stays usable.
 */
export async function TradesHistorySection({
  data,
  screen,
  retryHref,
  language,
}: {
  data: Promise<TradesData>
  /** The screen's nav label, as the page names it for ScreenLoadError. */
  screen: string
  retryHref: string
  language: string
}) {
  let resolved: TradesData
  try {
    resolved = await data
  } catch (e: unknown) {
    console.error('[core/trades] history read failed', e)
    return <ScreenLoadError screen={screen} retryHref={retryHref} language={language} headingLevel={2} />
  }
  return <Trades data={resolved} hidePending />
}

/**
 * The placeholder while the history streams: a grading banner over trade cards, in the
 * `af-sk-block` fill the /core skeletons share (PR #3261), so it themes with dark, light and AF mode
 * and stills under reduced motion. Shaped like what lands so the page does not jump.
 */
export function TradesHistorySkeleton({ language }: { language: string }) {
  const m = messagesFor(tradesScreenMessages, language)
  return (
    <div className="af-sk-trades" aria-busy="true" data-testid="trades-history-skeleton">
      <p className="af-sk-sr">{m.historyLoading}</p>
      <div className="af-sk-block af-sk-trades-banner" aria-hidden />
      <div className="af-sk-block af-sk-trades-title" aria-hidden />
      <div className="af-sk-trades-list" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => (
          <div className="af-sk-block af-sk-trade" key={i} />
        ))}
      </div>
    </div>
  )
}

/** The history slot: the skeleton until the section's data arrives. */
export function TradesHistorySlot(props: { data: Promise<TradesData>; screen: string; retryHref: string; language: string }) {
  return (
    <Suspense fallback={<TradesHistorySkeleton language={props.language} />}>
      <TradesHistorySection {...props} />
    </Suspense>
  )
}

/**
 * The completed Sleeper trades the Trade Center's offers and timeline merge in — the same list the
 * page passed before, once the read lands. A failed read gives an empty list here; the section's
 * own error card is what reports the failure.
 */
export function completedHistoryOf(data: Promise<TradesData>): Promise<readonly TradeRecord[]> {
  return data
    .then((d) => (d.league.platform === 'sleeper' && d.history.available ? d.history.data : []))
    .catch(() => [])
}
