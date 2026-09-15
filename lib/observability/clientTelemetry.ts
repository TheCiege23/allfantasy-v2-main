/**
 * Browser tracing policy: which page loads are traced, and what each one is tagged with.
 *
 * WHY. Until this module the browser traced a flat 5% of page loads. Measured over the week to
 * 2026-09-15 that was ~14 real /core page loads in Sentry — nothing a per-screen, per-device load or
 * interaction budget can be computed from — while `resource.*` spans (one per script, stylesheet
 * and image) were most of what the browser did send.
 *
 * So: trace /core generously, drop resource spans, and stamp every page-load and navigation span
 * with its screen, device class and network type AT START, when the URL is still the one the user
 * asked for (a page-load span is sent seconds later, possibly after they have moved on).
 *
 * Browser-safe: no Node APIs, and every access to `window`/`navigator` is guarded.
 */

import { classifyDevice, classifyRequest, type DeviceClass } from './requestContext'

export type NavigatorLike = {
  userAgent?: string
  webdriver?: boolean
  maxTouchPoints?: number
  userAgentData?: { mobile?: boolean }
  connection?: { effectiveType?: string; saveData?: boolean }
}

/** Page-load/navigation sample rates by surface. /core is the surface the budgets are about. */
export const CLIENT_SAMPLE_RATES = {
  core: 0.5,
  auth: 0.25,
  league: 0.25,
  other: 0.05,
} as const

/**
 * `resource.<initiatorType>` ops, matched exactly by the SDK. Each is one span per fetched file; LCP,
 * CLS, INP, TTFB and FCP are recorded on the page-load span and are unaffected.
 */
export const CLIENT_IGNORED_RESOURCE_OPS = [
  'resource.script',
  'resource.link',
  'resource.css',
  'resource.img',
  'resource.image',
  'resource.other',
  'resource.beacon',
  'resource.fetch',
  'resource.xmlhttprequest',
  'resource.iframe',
  'resource.video',
  'resource.audio',
  'resource.track',
  'resource.use',
  'resource.embed',
  'resource.object',
]

const EFFECTIVE_TYPES = new Set(['slow-2g', '2g', '3g', '4g'])

export function classifyClientDevice(nav: NavigatorLike | undefined): DeviceClass {
  if (!nav) return 'unknown'
  if (nav.webdriver) return 'bot'
  const ua = nav.userAgent ?? ''
  const hint = nav.userAgentData?.mobile === true ? '?1' : nav.userAgentData?.mobile === false ? '?0' : null
  const device = classifyDevice(ua, hint)
  // iPadOS reports a desktop Safari user-agent; a "Macintosh" with a touch screen is an iPad.
  if (device === 'desktop' && /macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1) return 'tablet'
  return device
}

export function clientSpanAttributes(
  pathname: string,
  nav: NavigatorLike | undefined,
  viewportWidth: number | undefined,
): Record<string, string> {
  const { surface, screen } = classifyRequest({ url: pathname })
  const effectiveType = nav?.connection?.effectiveType
  const attributes: Record<string, string> = {
    'af.surface': surface,
    'af.device': classifyClientDevice(nav),
    'af.net': typeof effectiveType === 'string' && EFFECTIVE_TYPES.has(effectiveType) ? effectiveType : 'unknown',
  }
  if (screen) attributes['af.screen'] = screen
  if (nav?.connection?.saveData) attributes['af.save_data'] = 'yes'
  if (typeof viewportWidth === 'number' && Number.isFinite(viewportWidth)) {
    attributes['af.viewport'] = viewportWidth < 768 ? 'narrow' : viewportWidth < 1200 ? 'medium' : 'wide'
  }
  return attributes
}

type StartSpanOptionsLike = { name: string; attributes?: Record<string, unknown> }

/**
 * `browserTracingIntegration({ beforeStartSpan })`. The Next.js integration starts page-load and
 * navigation spans named with the concrete pathname and parameterises the name later, so the name
 * at start is the most accurate path available.
 */
export function beforeStartClientSpan<O extends StartSpanOptionsLike>(options: O): O {
  try {
    const win = typeof window !== 'undefined' ? window : undefined
    const path = typeof options.name === 'string' && options.name.startsWith('/') ? options.name : (win?.location?.pathname ?? '/')
    const attributes = clientSpanAttributes(path, win?.navigator as NavigatorLike | undefined, win?.innerWidth)
    return { ...options, attributes: { ...(options.attributes ?? {}), ...attributes } } as O
  } catch {
    return options
  }
}

type ClientSamplingContextLike = {
  name?: string
  attributes?: Record<string, unknown>
  parentSampled?: boolean
  location?: { pathname?: string }
}

export function clientTracesSampler(context: ClientSamplingContextLike): number {
  try {
    if (typeof context.parentSampled === 'boolean') return context.parentSampled ? 1 : 0
    const attributes = context.attributes ?? {}
    if (attributes['af.device'] === 'bot') return 0
    const surface =
      typeof attributes['af.surface'] === 'string'
        ? attributes['af.surface']
        : classifyRequest({ url: context.location?.pathname ?? context.name ?? '/' }).surface
    if (surface === 'core') return CLIENT_SAMPLE_RATES.core
    if (surface === 'auth') return CLIENT_SAMPLE_RATES.auth
    if (surface === 'league') return CLIENT_SAMPLE_RATES.league
    return CLIENT_SAMPLE_RATES.other
  } catch {
    return 0
  }
}
