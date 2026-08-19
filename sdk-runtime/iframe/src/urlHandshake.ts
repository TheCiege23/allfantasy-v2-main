/**
 * Decision OS — Phase 7.14 Iframe Widget URL Handshake.
 *
 * The safe URL-based handoff of `widgetId`/`nonce`/`parentOrigin` between
 * the host facade (Phase 7.12, which builds the iframe's `src`) and the
 * child facade (Phase 7.13, which reads them back out once running inside
 * the iframe). Pure string manipulation — no `URL`/`URLSearchParams`, no
 * DOM globals — this lives in the no-dom top-level layer alongside 7.9/7.10,
 * not `browser/` or `facade/` (mirrors `httpClient.ts`'s manual query-string
 * approach in sdk-runtime/core).
 *
 * Namespaced param names (`af_*`) avoid colliding with a widget's own
 * application query params (e.g. its own router).
 *
 * SECURITY: the four params below are the ONLY things this module ever
 * reads or writes. There is no field, no code path, no fallback that
 * touches an API key, an auth credential, a tenant secret, raw intelligence
 * data, or any internal Decision OS field — `IframeWidgetUrlParams` is
 * structurally incapable of carrying one.
 */

import { IFRAME_PROTOCOL_VERSION } from './protocol'
import { isValidNonceFormat } from './protocol'
import { isValidOriginFormat } from './origin'

// ── Param names ───────────────────────────────────────────────────────────────

export const URL_HANDSHAKE_PARAM_NAMES = {
  widgetId: 'af_widget_id',
  nonce: 'af_nonce',
  parentOrigin: 'af_parent_origin',
  protocolVersion: 'af_protocol_version',
} as const

// ── Widget ID format ──────────────────────────────────────────────────────────

/** Matches the `widget_${entityId}_${widgetMode}` convention used throughout Phase 7. */
const WIDGET_ID_FORMAT_RE = /^widget_[A-Za-z0-9_-]+$/

export function isValidWidgetIdFormat(widgetId: string): boolean {
  return WIDGET_ID_FORMAT_RE.test(widgetId)
}

// ── Params shape ──────────────────────────────────────────────────────────────

/**
 * The complete, exhaustive set of fields this handshake carries. No other
 * field may ever be added here — see the SECURITY note above.
 */
export interface IframeWidgetUrlParams {
  widgetId: string
  nonce: string
  parentOrigin: string
  protocolVersion: string
}

// ── Manual query-string encode/decode (no URLSearchParams) ───────────────────

function encodeQueryString(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&')
}

function decodeQueryString(queryString: string): Record<string, string> {
  const trimmed = queryString.startsWith('?') ? queryString.slice(1) : queryString
  if (trimmed.length === 0) return {}

  const result: Record<string, string> = {}
  for (const pair of trimmed.split('&')) {
    if (pair.length === 0) continue
    const eqIndex = pair.indexOf('=')
    const rawKey = eqIndex === -1 ? pair : pair.slice(0, eqIndex)
    const rawValue = eqIndex === -1 ? '' : pair.slice(eqIndex + 1)
    try {
      result[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue)
    } catch {
      // Malformed percent-encoding — skip this pair rather than throwing;
      // the caller finds out via a missing/invalid-format error below.
      continue
    }
  }
  return result
}

function appendQueryString(baseSrc: string, queryString: string): string {
  if (queryString.length === 0) return baseSrc
  const separator = baseSrc.includes('?') ? '&' : '?'
  return `${baseSrc}${separator}${queryString}`
}

// ── Builder (host side) ────────────────────────────────────────────────────────

export interface BuildIframeWidgetUrlOptions {
  /** The iframe content's own base URL, without the handshake query params. */
  baseSrc: string
  widgetId: string
  nonce: string
  parentOrigin: string
  /** Defaults to IFRAME_PROTOCOL_VERSION. */
  protocolVersion?: string
}

/**
 * Appends the four handshake params to `baseSrc`. Deterministic — same
 * options always produce the same URL (param order is alphabetically
 * sorted). Never reads or requires anything credential-shaped.
 */
export function buildIframeWidgetUrl(options: BuildIframeWidgetUrlOptions): string {
  const params: Record<string, string> = {
    [URL_HANDSHAKE_PARAM_NAMES.widgetId]: options.widgetId,
    [URL_HANDSHAKE_PARAM_NAMES.nonce]: options.nonce,
    [URL_HANDSHAKE_PARAM_NAMES.parentOrigin]: options.parentOrigin,
    [URL_HANDSHAKE_PARAM_NAMES.protocolVersion]: options.protocolVersion ?? IFRAME_PROTOCOL_VERSION,
  }
  return appendQueryString(options.baseSrc, encodeQueryString(params))
}

// ── Parser (child side) ────────────────────────────────────────────────────────

export type ParseIframeWidgetUrlParamsResult =
  | { ok: true; params: IframeWidgetUrlParams }
  | { ok: false; errors: string[] }

/**
 * Parses and validates the four handshake params out of a raw query string
 * (e.g. `window.location.search`, with or without the leading `?`).
 * Deterministic runtime validation — every required param present, every
 * format valid, protocol version compatible — or a full list of what's
 * wrong. Never throws on malformed input.
 */
export function parseIframeWidgetUrlParams(queryString: string): ParseIframeWidgetUrlParamsResult {
  const raw = decodeQueryString(queryString)
  const errors: string[] = []

  const widgetId = raw[URL_HANDSHAKE_PARAM_NAMES.widgetId]
  const nonce = raw[URL_HANDSHAKE_PARAM_NAMES.nonce]
  const parentOrigin = raw[URL_HANDSHAKE_PARAM_NAMES.parentOrigin]
  const protocolVersion = raw[URL_HANDSHAKE_PARAM_NAMES.protocolVersion]

  if (!widgetId) {
    errors.push(`missing required param '${URL_HANDSHAKE_PARAM_NAMES.widgetId}'`)
  } else if (!isValidWidgetIdFormat(widgetId)) {
    errors.push(`param '${URL_HANDSHAKE_PARAM_NAMES.widgetId}' has an invalid format`)
  }

  if (!nonce) {
    errors.push(`missing required param '${URL_HANDSHAKE_PARAM_NAMES.nonce}'`)
  } else if (!isValidNonceFormat(nonce)) {
    errors.push(`param '${URL_HANDSHAKE_PARAM_NAMES.nonce}' has an invalid format`)
  }

  if (!parentOrigin) {
    errors.push(`missing required param '${URL_HANDSHAKE_PARAM_NAMES.parentOrigin}'`)
  } else if (!isValidOriginFormat(parentOrigin)) {
    errors.push(`param '${URL_HANDSHAKE_PARAM_NAMES.parentOrigin}' has an invalid format`)
  }

  if (!protocolVersion) {
    errors.push(`missing required param '${URL_HANDSHAKE_PARAM_NAMES.protocolVersion}'`)
  } else if (protocolVersion !== IFRAME_PROTOCOL_VERSION) {
    errors.push(
      `param '${URL_HANDSHAKE_PARAM_NAMES.protocolVersion}' value '${protocolVersion}' does not match '${IFRAME_PROTOCOL_VERSION}'`,
    )
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    params: {
      widgetId: widgetId as string,
      nonce: nonce as string,
      parentOrigin: parentOrigin as string,
      protocolVersion: protocolVersion as string,
    },
  }
}
