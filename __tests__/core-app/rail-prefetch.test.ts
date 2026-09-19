import { describe, expect, it } from 'vitest'

import {
  MAX_RAIL_WARMS,
  RAIL_AUTO_PREFETCH_LIMIT,
  railAutoPrefetchEnabled,
  shouldWarmRailLeague,
} from '@/components/core-app/railPrefetch'

/*
 * 🛑 THE RAIL'S LINKS ALWAYS "PREFETCHED", AND IT WAS ALWAYS THE WRONG THING.
 *
 * `LeagueTabsPrewarm` read this out of Next's source for the tab strip: a `<Link>` with no
 * explicit `prefetch` resolves to `PrefetchKind.AUTO`, and AUTO on a dynamic route stops at the
 * nearest `loading.tsx` — which `/core/[[...screen]]` has. It warms the skeleton the page is
 * already rendering, never the league data behind the click.
 *
 * The rail is not a tab strip: `page.tsx` builds it from `playedLeagues.map(...)` with no cap,
 * and one production account carries sixty-odd teams. Twelve tabs were judged too many to warm;
 * sixty skeletons is the same waste with none of the benefit.
 *
 * ⚠ NONE OF THIS IS OBSERVABLE IN `next dev` — both prefetch paths short-circuit on
 * NODE_ENV === 'development', so a dev probe reads exactly like a change that does nothing.
 * That is why the decisions are pure and tested here rather than measured in a dev run.
 */

describe('railAutoPrefetchEnabled', () => {
  it('leaves Next’s automatic prefetch on for a short rail', () => {
    expect(railAutoPrefetchEnabled(1)).toBe(true)
    expect(railAutoPrefetchEnabled(RAIL_AUTO_PREFETCH_LIMIT)).toBe(true)
  })

  it('turns it off once the rail is long enough for the cost to stop being bounded', () => {
    expect(railAutoPrefetchEnabled(RAIL_AUTO_PREFETCH_LIMIT + 1)).toBe(false)
    /* The account this exists for. */
    expect(railAutoPrefetchEnabled(60)).toBe(false)
  })

  /*
   * ⚠ THE BOUNDARY IS THE WHOLE BEHAVIOUR, so it is asserted from both sides. An off-by-one
   * here is invisible in production: nothing goes red, the rail simply speculates more or less
   * than intended and nobody can tell which.
   */
  it('is a closed boundary, not an open one', () => {
    expect(railAutoPrefetchEnabled(RAIL_AUTO_PREFETCH_LIMIT)).not.toBe(
      railAutoPrefetchEnabled(RAIL_AUTO_PREFETCH_LIMIT + 1),
    )
  })

  it('handles an empty rail without speculating about nothing', () => {
    expect(railAutoPrefetchEnabled(0)).toBe(true)
  })
})

describe('shouldWarmRailLeague', () => {
  const base = {
    leagueId: 'L1',
    selectedLeagueId: null as string | null,
    warmed: new Set<string>(),
    saveData: false,
  }

  it('warms a league the reader points at', () => {
    expect(shouldWarmRailLeague(base)).toBe(true)
  })

  it('never re-warms the league already on screen', () => {
    expect(shouldWarmRailLeague({ ...base, selectedLeagueId: 'L1' })).toBe(false)
    /* …but a different league on the same page is still worth warming. */
    expect(shouldWarmRailLeague({ ...base, selectedLeagueId: 'L2' })).toBe(true)
  })

  it('treats a pointer crossing the same tile twice as one intent', () => {
    expect(shouldWarmRailLeague({ ...base, warmed: new Set(['L1']) })).toBe(false)
  })

  it('stops a sweep down a long rail from ordering a render per crest', () => {
    const swept = new Set(Array.from({ length: MAX_RAIL_WARMS }, (_, i) => `swept-${i}`))
    expect(swept.size).toBe(MAX_RAIL_WARMS)
    expect(shouldWarmRailLeague({ ...base, warmed: swept })).toBe(false)
    /* One below the cap still warms — the limit is a cap, not an off switch. */
    swept.delete('swept-0')
    expect(shouldWarmRailLeague({ ...base, warmed: swept })).toBe(true)
  })

  it('spends nothing speculative when the reader asked to save data', () => {
    expect(shouldWarmRailLeague({ ...base, saveData: true })).toBe(false)
  })

  it('refuses an empty league id rather than prefetching /core?league=', () => {
    expect(shouldWarmRailLeague({ ...base, leagueId: '' })).toBe(false)
  })

  /*
   * ⚠ EACH REFUSAL IS A DIFFERENT KIND OF WASTE, and they are asserted separately so that a
   * later change to one cannot silently remove another — the failure mode being that the
   * function still returns false for the case you tested and true for the one you did not.
   */
  it('refuses for the right reason when several refusals apply at once', () => {
    expect(
      shouldWarmRailLeague({
        leagueId: 'L1',
        selectedLeagueId: 'L1',
        warmed: new Set(['L1']),
        saveData: true,
      }),
    ).toBe(false)
  })
})
