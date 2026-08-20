import { describe, it, expect } from 'vitest'
import { buildYahooReturnUrl } from '@/lib/yahoo/oauthConfig'

const APP = 'https://www.allfantasy.ai'

/**
 * Observed in production 2026-08-20: a user picked Yahoo on /import, approved on
 * Yahoo, and landed on a page showing their SLEEPER leagues with no error at all.
 *
 * The callback had built `${returnTo}?yahoo_error=...` where returnTo was already
 * `/import?provider=yahoo`, producing a second `?`. That is not a separator, so
 * `provider` parsed as the entire tail and did not match a known provider, and the
 * page fell back to Sleeper. These assert the parse, not the string, because the
 * parse is what actually broke.
 */
describe('buildYahooReturnUrl', () => {
  it('keeps provider parseable when returnTo already has a query string', () => {
    const out = buildYahooReturnUrl('/import?provider=yahoo', APP, {
      yahoo_error: 'user_fetch_failed',
    })
    const params = new URL(out).searchParams
    expect(params.get('provider')).toBe('yahoo')
    expect(params.get('yahoo_error')).toBe('user_fetch_failed')
  })

  it('never emits a second question mark', () => {
    const out = buildYahooReturnUrl('/import?provider=yahoo', APP, { yahoo_error: 'no_code' })
    expect(out.split('?').length - 1).toBe(1)
  })

  it('applies to the success path too — a working connect kept the chosen provider', () => {
    const out = buildYahooReturnUrl('/import?provider=yahoo', APP, {
      yahoo_connected: '1',
      yahoo_user: 'ABC123GUID',
    })
    const params = new URL(out).searchParams
    expect(params.get('provider')).toBe('yahoo')
    expect(params.get('yahoo_connected')).toBe('1')
    expect(params.get('yahoo_user')).toBe('ABC123GUID')
  })

  it('still works when returnTo has no query string', () => {
    const out = buildYahooReturnUrl('/import', APP, { yahoo_error: 'invalid_state' })
    expect(new URL(out).searchParams.get('yahoo_error')).toBe('invalid_state')
    expect(new URL(out).pathname).toBe('/import')
  })

  it('encodes a description containing spaces and punctuation', () => {
    // Yahoo's actual sentence for a missing Fantasy Sports permission.
    const desc = 'This application is not authorized to perform this action.'
    const out = buildYahooReturnUrl('/import?provider=yahoo', APP, { yahoo_error_desc: desc })
    expect(new URL(out).searchParams.get('yahoo_error_desc')).toBe(desc)
  })

  it('drops empty values rather than emitting a blank param', () => {
    const out = buildYahooReturnUrl('/import', APP, { yahoo_error: 'x', yahoo_error_desc: '' })
    expect(new URL(out).searchParams.has('yahoo_error_desc')).toBe(false)
  })

  it('does not let returnTo escape to another origin', () => {
    // sanitizeYahooReturnTo guarantees a leading slash upstream; assert the
    // resolution stays on our host even if that ever regresses.
    expect(new URL(buildYahooReturnUrl('/import', APP, {})).origin).toBe(APP)
  })
})
