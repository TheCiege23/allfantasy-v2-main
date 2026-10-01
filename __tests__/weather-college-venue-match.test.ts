import { describe, expect, it } from 'vitest'
import { venueNamesAgree } from '@/lib/weather/collegeVenue'

/**
 * The NCAAF venue matcher decides whether a feed's venue string is the home stadium.
 *
 * Measured on the 2026-10-01 09:00Z weather cron: 17 `venueMismatch` rows, every sampled one
 * a HOME game the feed and CFBD spell differently. The previous rule (whole-string containment)
 * rejected them all. A false YES is worse than a false NO — it forecasts the home campus for a
 * neutral-site game — so the neutral cases below are the ones that must never move.
 */
describe('venueNamesAgree', () => {
  it('🛑 accepts home games the feed and CFBD spell differently', () => {
    const home: Array<[string, string]> = [
      ['Fisher Stadium', 'Fisher Field'],
      ['Bethpage Stadium', 'Bethpage Federal Credit Union Stadium'],
      ['Bobby Bowden Field at Doak S. Campbell Stadium', 'Doak Campbell Stadium'],
      ['Los Angeles Memorial Coliseum', 'LA Memorial Coliseum'],
      ['Sanford Stadium', 'Sanford Stadium'],
      ['Gerald J. Ford Stadium', 'Gerald J. Ford Stadium'],
      ['Doak Campbell Stadium', 'Bobby Bowden Field at Doak S. Campbell Stadium'],
    ]
    for (const [feed, cfbd] of home) expect(venueNamesAgree(feed, cfbd), `${feed} / ${cfbd}`).toBe(true)
  })

  it('🛑 still rejects a neutral site, including one sharing a short or generic word', () => {
    const neutral: Array<[string, string]> = [
      ['Camping World Stadium', 'Bryant-Denny Stadium'],
      ['Mercedes-Benz Stadium', 'Sanford Stadium'],
      // "ford" is four letters: Detroit's Ford Field is NOT SMU's Gerald J. Ford Stadium.
      ['Ford Field', 'Gerald J. Ford Stadium'],
      // Every campus has one of these; a shared "Memorial Stadium" names no place.
      ['Memorial Stadium', 'Veterans Memorial Stadium'],
      ['University Stadium', 'University Field'],
      ['Stadium', 'Fisher Field'],
      ['', 'Fisher Field'],
    ]
    for (const [feed, cfbd] of neutral) expect(venueNamesAgree(feed, cfbd), `${feed} / ${cfbd}`).toBe(false)
  })

  it('⚠ a rename with no word in common is still a mismatch (needs an alias, not a looser rule)', () => {
    expect(venueNamesAgree('Broadview Stadium', 'UB Stadium')).toBe(false)
    expect(venueNamesAgree('Ryan Field 2026', 'Lanny and Sharon Martin Stadium')).toBe(false)
  })
})
