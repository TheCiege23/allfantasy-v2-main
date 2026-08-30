import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { FreshnessBadge } from '@/components/live/LiveScoresClient'

/*
 * The "updated Ns ago" badge on /core/live.
 *
 * ⚠ WHY THIS SUITE EXISTS, AND IT IS THE WHOLE POINT. The badge's own docblock
 * has always promised that "an unparseable or MISSING `fetchedAt` renders no age
 * at all rather than 'just now'". Nothing tested it, and the missing case could
 * not actually arrive: `fetchedAt` was typed `string`, and `getLivePageData`
 * filled a failed or undated fetch with `new Date().toISOString()`. So the
 * promise sat there, true by construction and unexercised, until the loader
 * stopped inventing the value — at which point the prop type was still `string`
 * and the component would have taken null and rendered the epoch.
 *
 * A documented behaviour with no test is a claim, not a guarantee.
 */

const NOW = new Date('2026-08-30T18:00:00Z').getTime()

function ageText(el: HTMLElement): string | null {
  const m = el.textContent?.match(/updated .* ago/)
  return m ? m[0] : null
}

describe('FreshnessBadge', () => {
  it('states the age when it knows it', () => {
    const { container } = render(
      <FreshnessBadge
        fetchedAt={new Date(NOW - 45_000).toISOString()}
        now={NOW}
        anyLive={false}
        isRefreshing={false}
      />,
    )
    expect(ageText(container)).toBe('updated 45s ago')
  })

  /*
   * ⚠ THE REGRESSION. `new Date(null)` is the EPOCH, not an invalid date, so
   * `Number.isNaN` never catches it — the badge would have read "updated
   * 20,000d ago" rather than saying nothing. The null check has to run BEFORE
   * `new Date`, which is why this asserts the rendered text and not just the
   * absence of a crash.
   */
  it('makes NO freshness claim when the loader could not date the feed', () => {
    const { container } = render(
      <FreshnessBadge fetchedAt={null} now={NOW} anyLive={false} isRefreshing={false} />,
    )
    expect(ageText(container)).toBeNull()
    // The badge itself still renders — it is the AGE that is absent, not the status.
    expect(container.textContent).toContain('Idle')
  })

  it('makes no claim for an unparseable timestamp either', () => {
    const { container } = render(
      <FreshnessBadge fetchedAt="not a date" now={NOW} anyLive={false} isRefreshing={false} />,
    )
    expect(ageText(container)).toBeNull()
  })

  /* Before mount there is no clock, so there is no age to state. */
  it('makes no claim before the clock exists', () => {
    const { container } = render(
      <FreshnessBadge
        fetchedAt={new Date(NOW - 45_000).toISOString()}
        now={null}
        anyLive={false}
        isRefreshing={false}
      />,
    )
    expect(ageText(container)).toBeNull()
  })

  /* Status and age are separate facts — a live slate with an undatable feed
     still says Live, it just does not say when. */
  it('keeps the live status independent of the age', () => {
    const { container } = render(
      <FreshnessBadge fetchedAt={null} now={NOW} anyLive isRefreshing={false} />,
    )
    expect(container.textContent).toContain('Live')
    expect(ageText(container)).toBeNull()
  })
})
