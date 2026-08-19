/**
 * Decision OS — Phase 7.16 Web Component Adapter: credential storage.
 *
 * Per PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md's web_component security
 * model: "closed Shadow DOM + credential in module-private WeakMap". The
 * `WeakMap` instance below never leaves this module — only these three
 * accessor functions do. A host sets `element.setCredentials(auth, apiKey)`
 * (see `AllFantasyWidgetElement.tsx`) but the credential is never reflected
 * as an attribute, never enumerable on the element instance, and never
 * serialized by `outerHTML`/`JSON.stringify(element)`/DevTools element
 * inspection — only code holding a reference to this exact module can read
 * it back out, and only by holding a reference to the exact element instance.
 */

import type { SDKAuth } from '../../../lib/decision-os/sdk/types'

export interface ElementCredentials {
  auth: SDKAuth
  apiKey: string
}

const CREDENTIALS = new WeakMap<object, ElementCredentials>()

export function setElementCredentials(element: object, credentials: ElementCredentials): void {
  CREDENTIALS.set(element, credentials)
}

export function getElementCredentials(element: object): ElementCredentials | null {
  return CREDENTIALS.get(element) ?? null
}

export function clearElementCredentials(element: object): void {
  CREDENTIALS.delete(element)
}
