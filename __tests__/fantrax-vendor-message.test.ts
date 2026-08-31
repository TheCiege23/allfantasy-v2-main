// @vitest-environment node
/**
 * Fantrax writes its error copy for a web page, and we put it on screen.
 *
 * 🛑 THE REAL ONE, OBSERVED IN PRODUCTION ON 2026-08-31. A user hit a vendor
 * outage on /import and the red box showed them literal `<br/><br/>` and a
 * `<b style="font-size:14px">` — React escaping the markup, correctly, so a
 * message that already said "something went wrong" read as though something had
 * gone wrong twice.
 *
 * ⚠ THE FIX IS TO STRIP, NEVER TO RENDER. Passing this through
 * `dangerouslySetInnerHTML` so the tags format would inject a third party's
 * markup — including a `style` attribute — into our page straight from a
 * response body. A vendor error string is untrusted input however ordinary it
 * looks, so the test below pins that tags come out as text-free, not as HTML.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { getFantraxLeagueInfo, humanizeVendorMessage } from '@/lib/league-import/fantrax/fantraxApi'

/** Verbatim from the production screenshot. Not a paraphrase. */
const REAL = `We're sorry, but we can't process that request at this time. This could be an error on our part, and we apologize if this is the case. An alert has been sent to our support department, and we'll look into this.<br/><br/> <b style="font-size:14px">This problem should be resolved within the next 1-24 hours.</b><br/><br/> If you're in a hurry to have this fixed, or want to follow up with this issue, please let us know via our support/feedback page.`

describe('humanizeVendorMessage', () => {
  it('removes the markup from the real production message', () => {
    const out = humanizeVendorMessage(REAL)
    expect(out).not.toContain('<')
    expect(out).not.toContain('>')
    expect(out).not.toContain('br/')
    expect(out).not.toContain('style=')
  })

  it('keeps the sentence the user actually needs', () => {
    const out = humanizeVendorMessage(REAL)
    expect(out).toContain('This problem should be resolved within the next 1-24 hours.')
    expect(out).toContain('support department')
  })

  /**
   * ⚠ A TAG BECOMES A SPACE, NOT NOTHING. Deleting it outright would weld the
   * sentences either side into "...look into this.This problem should be...".
   */
  it('does not weld sentences together where a tag was', () => {
    expect(humanizeVendorMessage('one.<br/><br/>two.')).toBe('one. two.')
    expect(humanizeVendorMessage(REAL)).not.toMatch(/\.[A-Z]/)
  })

  it('collapses the whitespace a stripped tag leaves behind', () => {
    expect(humanizeVendorMessage('a <b>b</b>   <i>c</i>')).toBe('a b c')
  })

  it('decodes the entities a page-oriented message carries', () => {
    expect(humanizeVendorMessage('rock &amp; roll')).toBe('rock & roll')
    expect(humanizeVendorMessage('we&#39;re sorry')).toBe("we're sorry")
    expect(humanizeVendorMessage('a&nbsp;b')).toBe('a b')
  })

  /**
   * 🛑 IT ONLY EVER REMOVES. `getFantraxLeagues` takes a Secret ID, which is a
   * credential its failure messages deliberately never echo. A sanitiser that
   * could ADD characters might reintroduce something; this one cannot, and the
   * test says so rather than leaving it to the reader.
   */
  it('never grows the message', () => {
    for (const s of [REAL, 'plain text', 'a &amp; b', '<b>x</b>', '  spaced  ']) {
      expect(humanizeVendorMessage(s).length).toBeLessThanOrEqual(s.length)
    }
  })

  it('handles an absent message without throwing', () => {
    expect(humanizeVendorMessage(null)).toBe('')
    expect(humanizeVendorMessage(undefined)).toBe('')
    expect(humanizeVendorMessage('')).toBe('')
    expect(humanizeVendorMessage('   ')).toBe('')
  })

  /** A message with no markup is already fine and must survive untouched. */
  it('leaves an ordinary message alone', () => {
    expect(humanizeVendorMessage('League not found')).toBe('League not found')
  })
})

/**
 * 🛑 THAT THE SANITISER EXISTS IS NOT THE POINT — THAT THE REQUEST PATH USES IT
 * IS.
 *
 * Caught by a mutation control while writing this file: reverting the one call
 * site back to `asRecord.error.message` — so the raw HTML flows to the UI again,
 * the exact production bug — left every test above GREEN. They exercised the
 * function in isolation and said nothing about whether anything called it. A
 * suite that passes with the fix removed is not protecting the fix.
 *
 * So this drives a real `fxeaGet` caller with a stubbed vendor response.
 */
describe('the request path uses it', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('strips markup from a 200-with-error before the caller ever sees it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: { message: 'Broken.<br/><br/><b style="font-size:14px">Try later.</b>' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )

    const res = await getFantraxLeagueInfo('v2kzedypmm8jp61b')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.failure.message).not.toContain('<')
    expect(res.failure.message).not.toContain('style=')
    expect(res.failure.message).toBe('Broken. Try later.')
  })

  /**
   * ⚠ AND THE `not_found` CLASSIFICATION MUST STILL WORK ON THE CLEANED STRING.
   * The kind is decided by matching /not found/i against the message; if
   * sanitising ran after that test, or mangled the words, a missing league would
   * start reporting as a generic api_error and the UI would stop telling the
   * user their league id is wrong.
   */
  it('still classifies a not-found league after sanitising', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: 'League <b>not found</b>' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    const res = await getFantraxLeagueInfo('nope')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.failure.kind).toBe('not_found')
    expect(res.failure.message).toBe('League not found')
  })
})
