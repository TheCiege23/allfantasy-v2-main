'use client'

/**
 * Sports OS point 9's visible half: the timestamp on a value that may be cached.
 *
 * `lib/sports-os/freshness.ts` makes it structurally impossible for a loader to hand a screen a
 * cached value without its age. This is the other end — the part that makes the age impossible for
 * the READER to miss. A stale board that says nothing is exactly the silent staleness the envelope
 * exists to prevent; carrying `fetchedAt` all the way to a component that then ignores it would be
 * the whole point thrown away one step from the finish.
 *
 * ⚠ `last-known` ALWAYS WARNS, EVEN WHEN THE VALUE IS YOUNG. It does not mean "slightly old", it
 * means a refresh FAILED and this is the previous answer. A board thirty seconds old whose refresh
 * is erroring is something the reader is entitled to know about, and `shouldWarnAboutFreshness`
 * encodes exactly that.
 *
 * ── Why this is a client component, and why it takes `initialLabel` ──────────
 *
 * 🛑 A RELATIVE TIMESTAMP RENDERED ON THE SERVER IS WRONG TWICE.
 *
 * First, it freezes: the server computes "just now" and the HTML says "just now" for as long as the
 * tab is open, which is a confident lie about the one thing this component exists to report.
 * Second, recomputing it during hydration is a mismatch — React renders the server's string, the
 * client computes a different one, and `Standings.tsx` already carries a note about pinning a
 * locale for exactly this reason.
 *
 * So the SERVER computes the first label and passes it as a prop. First paint uses that prop, so
 * hydration is byte-identical by construction. Only AFTER mount does the effect start recomputing
 * from the real clock, and it keeps ticking so a tab left open does not drift.
 */

import { useEffect, useState } from 'react'
import { freshnessLabel, shouldWarnAboutFreshness, type FreshnessMeta } from '@/lib/sports-os/freshness'
import './af-freshness.css'

export type FreshnessChipProps = {
  meta: FreshnessMeta
  /**
   * The label as the SERVER computed it. Rendered on first paint so SSR and hydration agree; see
   * the note above. Never recomputed from it — it is a starting value, not a fallback.
   */
  initialLabel: string
  /** `shouldWarnAboutFreshness` as the server computed it, for the same reason. */
  initialWarn: boolean
  /** Leading word. "Updated" for a board, "Prices" for a market, and so on. */
  prefix?: string
}

/** How often the label re-derives once mounted. Coarse, because the label itself is coarse. */
const TICK_MS = 30_000

export function FreshnessChip({ meta, initialLabel, initialWarn, prefix = 'Updated' }: FreshnessChipProps) {
  /*
   * `null` until mounted, which is also what the SERVER renders — that is what makes the first
   * client render identical to the server's. Do NOT seed this with `Date.now()`.
   */
  const [nowMs, setNowMs] = useState<number | null>(null)

  useEffect(() => {
    const tick = () => setNowMs(Date.now())
    tick()
    const id = window.setInterval(tick, TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  // Nothing was ever fetched. A chip reading "never" over a board is noise, not information.
  if (meta.source === 'none') return null

  const label = nowMs === null ? initialLabel : freshnessLabel(meta, nowMs)
  const warn = nowMs === null ? initialWarn : shouldWarnAboutFreshness(meta, nowMs)
  const lastKnown = meta.source === 'last-known'

  const state = lastKnown ? 'last-known' : warn ? 'stale' : 'fresh'
  const iso = meta.fetchedAt > 0 ? new Date(meta.fetchedAt).toISOString() : undefined

  return (
    <span className="af-fresh" data-state={state}>
      <span className="af-fresh-dot" aria-hidden />
      <span className="af-fresh-text">
        {lastKnown ? 'Last known' : prefix}{' '}
        {/*
          The machine-readable absolute instant rides along in `dateTime`, so the exact moment is
          available to a screen reader and a hover without printing a locale-formatted string that
          would differ between server and client.
        */}
        <time dateTime={iso}>{label}</time>
      </span>
      {lastKnown ? <span className="af-fresh-note">refresh failed</span> : null}
    </span>
  )
}

export default FreshnessChip
