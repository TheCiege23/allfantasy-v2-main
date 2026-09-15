import { describe, expect, it } from 'vitest'

import {
  CLIENT_IGNORED_RESOURCE_OPS,
  CLIENT_SAMPLE_RATES,
  beforeStartClientSpan,
  classifyClientDevice,
  clientSpanAttributes,
  clientTracesSampler,
} from '@/lib/observability/clientTelemetry'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'

describe('classifyClientDevice', () => {
  it('reads an iPad that claims to be a Mac from its touch points', () => {
    expect(classifyClientDevice({ userAgent: MAC_SAFARI, maxTouchPoints: 5 })).toBe('tablet')
    expect(classifyClientDevice({ userAgent: MAC_SAFARI, maxTouchPoints: 0 })).toBe('desktop')
  })

  it('trusts User-Agent Client Hints and flags automation as a bot', () => {
    expect(classifyClientDevice({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/126', userAgentData: { mobile: true } })).toBe('mobile')
    expect(classifyClientDevice({ userAgent: IPHONE, webdriver: true })).toBe('bot')
    expect(classifyClientDevice(undefined)).toBe('unknown')
  })
})

describe('clientSpanAttributes', () => {
  it('stamps screen, device, network and viewport for a /core page', () => {
    expect(
      clientSpanAttributes('/core/matchup', { userAgent: IPHONE, connection: { effectiveType: '3g', saveData: true } }, 390),
    ).toEqual({
      'af.surface': 'core',
      'af.screen': 'matchup',
      'af.device': 'mobile',
      'af.net': '3g',
      'af.save_data': 'yes',
      'af.viewport': 'narrow',
    })
  })

  it('reports an unknown network rather than inventing one', () => {
    expect(clientSpanAttributes('/', { userAgent: MAC_SAFARI }, 1440)).toMatchObject({ 'af.net': 'unknown', 'af.viewport': 'wide' })
    expect(clientSpanAttributes('/', { connection: { effectiveType: 'wifi' } }, undefined)['af.net']).toBe('unknown')
  })
})

describe('beforeStartClientSpan', () => {
  it('classifies from the concrete path the span is named with, keeping existing attributes', () => {
    const out = beforeStartClientSpan({ name: '/core/waivers', attributes: { 'sentry.op': 'navigation' } })
    expect(out.name).toBe('/core/waivers')
    expect(out.attributes).toMatchObject({ 'sentry.op': 'navigation', 'af.surface': 'core', 'af.screen': 'waivers' })
  })

  it('falls back to the current location when the name is not a path', () => {
    window.history.replaceState({}, '', '/core/week')
    const out = beforeStartClientSpan({ name: 'pageload' })
    expect(out.attributes).toMatchObject({ 'af.screen': 'week' })
  })
})

describe('clientTracesSampler', () => {
  it('traces /core far more than marketing pages, and bots not at all', () => {
    expect(clientTracesSampler({ attributes: { 'af.surface': 'core' } })).toBe(CLIENT_SAMPLE_RATES.core)
    expect(clientTracesSampler({ attributes: { 'af.surface': 'landing' } })).toBe(CLIENT_SAMPLE_RATES.other)
    expect(clientTracesSampler({ attributes: { 'af.surface': 'core', 'af.device': 'bot' } })).toBe(0)
    expect(CLIENT_SAMPLE_RATES.core).toBeGreaterThan(CLIENT_SAMPLE_RATES.other)
  })

  it('classifies from the location when the span carries no surface', () => {
    expect(clientTracesSampler({ name: '/core/:screen*?', location: { pathname: '/login' } })).toBe(CLIENT_SAMPLE_RATES.auth)
  })

  it('follows a parent decision when there is one', () => {
    expect(clientTracesSampler({ parentSampled: true, attributes: { 'af.surface': 'landing' } })).toBe(1)
    expect(clientTracesSampler({ parentSampled: false, attributes: { 'af.surface': 'core' } })).toBe(0)
  })
})

describe('CLIENT_IGNORED_RESOURCE_OPS', () => {
  it('names the resource ops Sentry actually emitted for this app, exactly as the SDK matches them', () => {
    // From the spans dataset, 7 days to 2026-09-15: every resource.* op the browser produced.
    for (const op of ['resource.script', 'resource.link', 'resource.img', 'resource.beacon', 'resource.other']) {
      expect(CLIENT_IGNORED_RESOURCE_OPS).toContain(op)
    }
    // The SDK matches with Array#includes, so a prefix like 'resource.' would silently match nothing.
    expect(CLIENT_IGNORED_RESOURCE_OPS.every((op) => /^resource\.[a-z]+$/.test(op))).toBe(true)
  })
})
