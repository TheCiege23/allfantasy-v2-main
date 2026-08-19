/**
 * Decision OS — Phase 7.16 Widget Runtime Web Component Adapter.
 *
 * `<allfantasy-widget>` — a closed-Shadow-DOM custom element rendering IPM
 * presentation models (Phase 7.0/7.2) fetched through the sdk-runtime core
 * (Phase 7.6/7.7), reusing the React adapter (Phase 7.8) internally to
 * render. Computes nothing — no scores, no severities, no colors are
 * derived here.
 */

// ── Custom element ────────────────────────────────────────────────────────────
export { AllFantasyWidgetElement } from './AllFantasyWidgetElement'

// ── Registration ──────────────────────────────────────────────────────────────
export { defineAllFantasyWidgetElement, DEFAULT_TAG_NAME } from './register'

// ── Attribute contract ────────────────────────────────────────────────────────
export { ELEMENT_ATTRIBUTE_NAMES, OBSERVED_ATTRIBUTES, parseElementAttributes } from './attributes'
export type { ParsedElementAttributes, ParseElementAttributesResult, AttributeGetter } from './attributes'

// ── Config assembly + validation ──────────────────────────────────────────────
export { buildWidgetConfigFromAttributes, validateElementConfig } from './config'
export type { ElementConfigValidationResult } from './config'

// ── Shadow DOM mount boundary ─────────────────────────────────────────────────
export { attachShadowMountRoot, mountShadowContainer, unmountShadowContainer } from './shadowMount'
export type { WidgetShadowMode } from './shadowMount'

// ── Credential storage ────────────────────────────────────────────────────────
export { setElementCredentials, getElementCredentials, clearElementCredentials } from './credentials'
export type { ElementCredentials } from './credentials'

// ── Default runtime deps ──────────────────────────────────────────────────────
export { defaultFetchImpl, defaultClock } from './defaults'
