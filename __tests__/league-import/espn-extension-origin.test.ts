/**
 * ESPN one-click browser extension — origin trust check (AF_ESPN_EXTENSION_CONNECT_BUILD.md
 * §3-4). Pure function: only ADDS a rejection for a cross-origin request that isn't the app or
 * the configured extension. Must never reject the no-Origin-header / same-origin cases the
 * existing manual paste form relies on.
 */
import { describe, it, expect } from 'vitest'
import { isAllowedLeagueAuthRequestOrigin } from '@/lib/extension/allowedRequestOrigin'

const APP_ORIGIN = 'https://www.allfantasy.ai'

describe('isAllowedLeagueAuthRequestOrigin', () => {
  it('allows a request with no Origin header (the existing manual-paste-form case)', () => {
    expect(
      isAllowedLeagueAuthRequestOrigin({ originHeader: null, appOrigin: APP_ORIGIN, extensionId: null }),
    ).toBe(true)
  })

  it('allows a same-origin request', () => {
    expect(
      isAllowedLeagueAuthRequestOrigin({ originHeader: APP_ORIGIN, appOrigin: APP_ORIGIN, extensionId: null }),
    ).toBe(true)
  })

  it('allows the configured extension origin', () => {
    expect(
      isAllowedLeagueAuthRequestOrigin({
        originHeader: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
        appOrigin: APP_ORIGIN,
        extensionId: 'abcdefghijklmnopabcdefghijklmnop',
      }),
    ).toBe(true)
  })

  it('fails closed: rejects a chrome-extension origin when no extension ID is configured yet', () => {
    expect(
      isAllowedLeagueAuthRequestOrigin({
        originHeader: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
        appOrigin: APP_ORIGIN,
        extensionId: null,
      }),
    ).toBe(false)
    expect(
      isAllowedLeagueAuthRequestOrigin({
        originHeader: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
        appOrigin: APP_ORIGIN,
        extensionId: '',
      }),
    ).toBe(false)
  })

  it('rejects a chrome-extension origin that does not match the configured extension ID', () => {
    expect(
      isAllowedLeagueAuthRequestOrigin({
        originHeader: 'chrome-extension://some-other-unrelated-extension-id',
        appOrigin: APP_ORIGIN,
        extensionId: 'abcdefghijklmnopabcdefghijklmnop',
      }),
    ).toBe(false)
  })

  it('rejects an unrelated cross-origin request', () => {
    expect(
      isAllowedLeagueAuthRequestOrigin({
        originHeader: 'https://evil.example.com',
        appOrigin: APP_ORIGIN,
        extensionId: 'abcdefghijklmnopabcdefghijklmnop',
      }),
    ).toBe(false)
  })
})
