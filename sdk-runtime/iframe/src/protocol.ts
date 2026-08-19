/**
 * Decision OS — Phase 7.9 Iframe Adapter: postMessage protocol contract.
 *
 * Versioned message envelope + builders + deterministic runtime validators.
 * `event.data` from a real `postMessage` handler always arrives as
 * `unknown` — these validators are what a future runtime calls before
 * trusting it. No `window.addEventListener`, no `window.postMessage` here.
 */

import { IFRAME_PROTOCOL_VERSION } from './types'
import type {
  ChildToParentMessage,
  ChildToParentMessageType,
  ChildToParentPayloadMap,
  IframeInitPayload,
  MessageValidationResult,
  ParentToChildMessage,
  ParentToChildMessageType,
  ParentToChildPayloadMap,
} from './types'
import type { SDKConfig } from '../../../lib/decision-os/sdk/types'

export { IFRAME_PROTOCOL_VERSION }

export const PARENT_TO_CHILD_MESSAGE_TYPES: readonly ParentToChildMessageType[] = [
  'init', 'refresh_request', 'visibility_change', 'theme_update', 'dispose',
]

export const CHILD_TO_PARENT_MESSAGE_TYPES: readonly ChildToParentMessageType[] = [
  'ready', 'lifecycle_change', 'degraded', 'error', 'interaction', 'resize',
]

// ── Nonce format ──────────────────────────────────────────────────────────────

const NONCE_FORMAT_RE = /^[A-Za-z0-9_-]{8,}$/

export function isValidNonceFormat(nonce: string): boolean {
  return NONCE_FORMAT_RE.test(nonce)
}

// ── Safe payload extraction ────────────────────────────────────────────────────

/**
 * Extracts ONLY the fields safe to post across the frame boundary from a
 * full SDKConfig. `sdkConfig.auth` (which carries the credential) is
 * deliberately never read here — this is the concrete function proving the
 * "API keys must never be posted via postMessage" requirement, not just a
 * type-level omission.
 */
export function buildInitPayloadFromSdkConfig(sdkConfig: SDKConfig): IframeInitPayload {
  return {
    widgetMode: sdkConfig.widgetMode,
    entityId: sdkConfig.entityId,
    entityType: sdkConfig.entityType,
    theme: sdkConfig.theme,
    locale: sdkConfig.locale,
    presentationVersion: sdkConfig.version.presentationVersion,
  }
}

// ── Message builders ──────────────────────────────────────────────────────────

export function buildParentToChildMessage<T extends ParentToChildMessageType>(
  type: T,
  widgetId: string,
  nonce: string,
  payload: ParentToChildPayloadMap[T],
  opts: { timestamp?: string } = {},
): Extract<ParentToChildMessage, { type: T }> {
  return {
    direction: 'parent_to_child',
    type,
    protocolVersion: IFRAME_PROTOCOL_VERSION,
    nonce,
    widgetId,
    timestamp: opts.timestamp ?? new Date().toISOString(),
    payload,
  } as Extract<ParentToChildMessage, { type: T }>
}

export function buildChildToParentMessage<T extends ChildToParentMessageType>(
  type: T,
  widgetId: string,
  nonce: string,
  payload: ChildToParentPayloadMap[T],
  opts: { timestamp?: string } = {},
): Extract<ChildToParentMessage, { type: T }> {
  return {
    direction: 'child_to_parent',
    type,
    protocolVersion: IFRAME_PROTOCOL_VERSION,
    nonce,
    widgetId,
    timestamp: opts.timestamp ?? new Date().toISOString(),
    payload,
  } as Extract<ChildToParentMessage, { type: T }>
}

// ── Structural payload checks (per message type) ──────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function validateParentToChildPayload(type: ParentToChildMessageType, payload: unknown): string[] {
  if (!isRecord(payload)) return [`payload for type '${type}' must be an object`]
  const errors: string[] = []
  switch (type) {
    case 'init':
      for (const key of ['widgetMode', 'entityId', 'entityType', 'theme', 'locale', 'presentationVersion']) {
        if (!(key in payload)) errors.push(`init payload missing required key '${key}'`)
      }
      break
    case 'visibility_change':
      if (typeof payload.visible !== 'boolean') errors.push("visibility_change payload requires boolean 'visible'")
      break
    case 'theme_update':
      if (!('theme' in payload)) errors.push("theme_update payload missing required key 'theme'")
      break
    case 'refresh_request':
    case 'dispose':
      // Empty payloads — nothing to check.
      break
  }
  return errors
}

function validateChildToParentPayload(type: ChildToParentMessageType, payload: unknown): string[] {
  if (!isRecord(payload)) return [`payload for type '${type}' must be an object`]
  const errors: string[] = []
  switch (type) {
    case 'ready':
      if (typeof payload.sdkVersion !== 'string') errors.push("ready payload requires string 'sdkVersion'")
      break
    case 'lifecycle_change':
      if (typeof payload.state !== 'string') errors.push("lifecycle_change payload requires string 'state'")
      break
    case 'degraded':
      if (typeof payload.completeness !== 'number') errors.push("degraded payload requires number 'completeness'")
      break
    case 'error':
      for (const key of ['code', 'message', 'retryable']) {
        if (!(key in payload)) errors.push(`error payload missing required key '${key}'`)
      }
      break
    case 'interaction':
      if (typeof payload.target !== 'string') errors.push("interaction payload requires string 'target'")
      break
    case 'resize':
      if (typeof payload.heightPx !== 'number') errors.push("resize payload requires number 'heightPx'")
      break
  }
  return errors
}

// ── Envelope validation ────────────────────────────────────────────────────────

function validateEnvelope(
  raw: unknown,
  expectedDirection: 'parent_to_child' | 'child_to_parent',
  allowedTypes: readonly string[],
): MessageValidationResult {
  const errors: string[] = []

  if (!isRecord(raw)) {
    return { valid: false, errors: ['message must be an object'] }
  }

  if (raw.direction !== expectedDirection) {
    errors.push(`direction must be '${expectedDirection}', got '${String(raw.direction)}'`)
  }
  if (typeof raw.type !== 'string' || !allowedTypes.includes(raw.type)) {
    errors.push(`type '${String(raw.type)}' is not a valid message type for direction '${expectedDirection}'`)
  }
  if (raw.protocolVersion !== IFRAME_PROTOCOL_VERSION) {
    errors.push(`protocolVersion '${String(raw.protocolVersion)}' does not match '${IFRAME_PROTOCOL_VERSION}'`)
  }
  if (typeof raw.nonce !== 'string' || !isValidNonceFormat(raw.nonce)) {
    errors.push('nonce is missing or does not match the required format')
  }
  if (typeof raw.widgetId !== 'string' || raw.widgetId.trim() === '') {
    errors.push('widgetId must be a non-empty string')
  }
  if (typeof raw.timestamp !== 'string' || Number.isNaN(Date.parse(raw.timestamp))) {
    errors.push('timestamp must be a valid ISO 8601 string')
  }

  return { valid: errors.length === 0, errors }
}

/** Validates a raw, untrusted value (e.g. a real `event.data`) as a ParentToChildMessage. */
export function validateParentToChildMessage(raw: unknown): MessageValidationResult {
  const envelopeResult = validateEnvelope(raw, 'parent_to_child', PARENT_TO_CHILD_MESSAGE_TYPES)
  if (!envelopeResult.valid) return envelopeResult

  const rec = raw as Record<string, unknown>
  const payloadErrors = validateParentToChildPayload(rec.type as ParentToChildMessageType, rec.payload)
  return { valid: payloadErrors.length === 0, errors: payloadErrors }
}

/** Validates a raw, untrusted value (e.g. a real `event.data`) as a ChildToParentMessage. */
export function validateChildToParentMessage(raw: unknown): MessageValidationResult {
  const envelopeResult = validateEnvelope(raw, 'child_to_parent', CHILD_TO_PARENT_MESSAGE_TYPES)
  if (!envelopeResult.valid) return envelopeResult

  const rec = raw as Record<string, unknown>
  const payloadErrors = validateChildToParentPayload(rec.type as ChildToParentMessageType, rec.payload)
  return { valid: payloadErrors.length === 0, errors: payloadErrors }
}
