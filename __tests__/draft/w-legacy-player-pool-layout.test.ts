/**
 * Commit W.2 — legacy mock-draft PlayerPool Sleeper-style layout.
 *
 * The legacy `app/draft/components/PlayerPool.tsx` previously rendered
 * the position-filter chips inside a `flex flex-wrap gap-1` container,
 * which on IDP / specialty leagues with many positions wrapped into
 * what looked like a "wall of position chips" — visually indistinguish-
 * able from the player list. The empty state was also silent: when
 * `filtered.length === 0`, the `<tbody>` rendered nothing, leaving the
 * user staring at a chip wall over empty space.
 *
 * W.2 restructures the layout so:
 *   1. Position chips live in a single-row horizontal-scroll strip
 *      (`overflow-x-auto whitespace-nowrap`) — no more wrap wall.
 *   2. The filter bar carries its own `border-b-2` divider so the
 *      visual boundary between filters and results is explicit.
 *   3. Each chip is rendered as a `role="radio"` with a stable
 *      per-position test id (`legacy-draft-pool-position-filter-{POS}`).
 *   4. The results area always renders an empty-state copy + a
 *      "Clear filters" CTA (when at least one narrowing filter is
 *      active) when `filtered.length === 0`. No more silent empty
 *      `<tbody>`.
 *   5. New stable test ids land for the filter bar, results region,
 *      and empty state so e2e / component tests can target each
 *      surface deterministically.
 *
 * Static-source assertions only — does not exercise React render.
 *
 * What did NOT change:
 *   - filter behavior (pos / search / hideDrafted / watchOnly /
 *     rookiesOnly state remains identical)
 *   - the player row schema, draft / queue actions
 *   - the new snake redraft route
 *     (`components/app/draft-room/PlayerPanel.tsx`) — this slice
 *     touches the legacy component only.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('Legacy PlayerPool — filter bar layout', () => {
  const src = read('app/draft/components/PlayerPool.tsx')

  it('filter bar carries the canonical test id', () => {
    expect(src).toMatch(/data-testid="legacy-draft-pool-filter-bar"/)
  })

  it('position-filter row uses horizontal scroll + no-wrap (NOT flex-wrap)', () => {
    expect(src).toMatch(
      /data-testid="legacy-draft-pool-position-filter-bar"[\s\S]*?role="radiogroup"/,
    )
    // Specifically check the className on the position row carries the
    // overflow-x-auto + whitespace-nowrap pair, and does NOT carry the
    // old `flex-wrap` class on this same container.
    const posBarMatch = src.match(
      /className="([^"]+)"\s*\n\s*data-testid="legacy-draft-pool-position-filter-bar"/,
    )
    expect(posBarMatch).not.toBeNull()
    const cls = posBarMatch![1]
    expect(cls).toMatch(/overflow-x-auto/)
    expect(cls).toMatch(/whitespace-nowrap/)
    expect(cls).not.toMatch(/flex-wrap/)
  })

  it('every position chip renders as role="radio" with a stable per-position testid', () => {
    expect(src).toMatch(/role="radio"/)
    expect(src).toMatch(
      /data-testid=\{`legacy-draft-pool-position-filter-\$\{p\.toLowerCase\(\)\}`\}/,
    )
    expect(src).toMatch(/aria-checked=\{pos === p\}/)
  })

  it('filter bar uses a stronger border divider so it visually separates from the results', () => {
    expect(src).toMatch(/border-b-2/)
  })

  it('search input carries a stable testid', () => {
    expect(src).toMatch(/data-testid="legacy-draft-pool-search"/)
  })
})

describe('Legacy PlayerPool — results region + empty state', () => {
  const src = read('app/draft/components/PlayerPool.tsx')

  it('results region carries the canonical test id', () => {
    expect(src).toMatch(/data-testid="legacy-draft-pool-results"/)
  })

  it('empty state renders when filtered.length === 0', () => {
    expect(src).toMatch(
      /\{filtered\.length === 0 \?[\s\S]+?data-testid="legacy-draft-pool-empty-state"/,
    )
  })

  it('empty-state copy distinguishes "loading" from "all-filtered-out"', () => {
    expect(src).toMatch(/Loading the player pool/)
    expect(src).toMatch(/Widen the search, switch position, or clear filters/)
  })

  it('clear-filters CTA renders ONLY when a narrowing filter is active', () => {
    expect(src).toMatch(
      /const hasActiveNarrowingFilter =\s*pos !== 'ALL' \|\| debounced\.length > 0 \|\| watchOnly \|\| rookiesOnly/,
    )
    expect(src).toMatch(
      /\{hasActiveNarrowingFilter \?[\s\S]+?data-testid="legacy-draft-pool-clear-filters"/,
    )
  })

  it('clearAllFilters resets every filter back to defaults', () => {
    expect(src).toMatch(
      /const clearAllFilters = useCallback\(\(\) => \{[\s\S]+?setPos\('ALL'\)[\s\S]+?setSearch\(''\)[\s\S]+?setHideDrafted\(true\)[\s\S]+?setWatchOnly\(false\)[\s\S]+?setRookiesOnly\(false\)/,
    )
  })
})

describe('Legacy PlayerPool — preserved behavior (no mechanics changes)', () => {
  const src = read('app/draft/components/PlayerPool.tsx')

  it('still calls onDraft / onQueue from row buttons', () => {
    expect(src).toMatch(/onClick=\{\(\) => onDraft\(p\)\}/)
    expect(src).toMatch(/onClick=\{\(\) => onQueue\(p\)\}/)
  })

  it('still gates the Draft button on canDraft + drafted-id check', () => {
    expect(src).toMatch(/disabled=\{!canDraft \|\| draftedIds\.has\(p\.id\)\}/)
  })

  it('still uses the same filter predicate (no behavior drift)', () => {
    expect(src).toMatch(
      /if \(hideDrafted && draftedIds\.has\(p\.id\)\) return false[\s\S]+?if \(pos !== 'ALL' && p\.position !== pos\) return false[\s\S]+?if \(debounced && !p\.name\.toLowerCase\(\)\.includes\(debounced\)\) return false/,
    )
  })

  it('still renders injury chip per row with stable testid', () => {
    expect(src).toMatch(/data-testid=\{`draft-player-injury-\$\{p\.id\}`\}/)
  })

  it('still renders the player-row testid that other tests rely on', () => {
    expect(src).toMatch(/data-testid=\{`draft-player-row-\$\{p\.id\}`\}/)
  })
})

describe('W.1 i18n leak fix still in place', () => {
  it('DraftShell tab strip resolver still uses the resilient label fallback', () => {
    const src = read('app/draft/components/DraftShell.tsx')
    expect(src).toMatch(
      /typeof translated === 'string' && translated && translated !== tab\.i18nKey/,
    )
    expect(src).not.toMatch(/t\('draftRoom\.legacy\.queueTab'\)\s*\?\?/)
  })

  it('translation source still defines the legacy tab keys', () => {
    const en = read('lib/i18n/translations-en.ts')
    const es = read('lib/i18n/translations-es-parity.ts')
    expect(en).toMatch(/"draftRoom\.legacy\.queueTab":\s*"Queue"/)
    expect(es).toMatch(/"draftRoom\.legacy\.queueTab":\s*"Cola"/)
  })
})

describe('New snake redraft route is untouched (W.2 is legacy-only)', () => {
  it('components/app/draft-room/PlayerPanel.tsx still has Commit N rookies/vets imports', () => {
    const pp = read('components/app/draft-room/PlayerPanel.tsx')
    expect(pp).toMatch(
      /import \{[^}]*isRookieEligibleForFilter[^}]*isVetEligibleForFilter[^}]*\} from '@\/lib\/draft-room\/rookieFilterPredicate'/,
    )
  })

  it('components/app/draft-room/DraftRoomPageClient.tsx still has the Commit J 409 handler', () => {
    const drpc = read('components/app/draft-room/DraftRoomPageClient.tsx')
    expect(drpc).toMatch(
      /res\.status === 409 && \(data as \{ code\?: unknown \}\)\?\.code === 'DRAFT_SESSION_MISMATCH'/,
    )
  })
})
