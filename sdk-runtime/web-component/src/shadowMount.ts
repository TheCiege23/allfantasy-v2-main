/**
 * Decision OS — Phase 7.16 Web Component Adapter: Shadow DOM mount boundary.
 *
 * Three small DOM utilities, deliberately split by lifetime:
 *   - `attachShadowMountRoot` — called AT MOST ONCE per host element. The
 *     DOM spec throws `NotSupportedError` if `attachShadow()` is called
 *     twice on the same element, and a CLOSED shadow root's `.shadowRoot`
 *     getter always returns null (even from the host element's own class
 *     methods) — so the caller (AllFantasyWidgetElement) must capture and
 *     hold the return value itself across the element's lifetime, never
 *     re-derive it from `host.shadowRoot`.
 *   - `mountShadowContainer` / `unmountShadowContainer` — safe to call
 *     repeatedly (once per `connectedCallback`/`disconnectedCallback`
 *     cycle) against an already-attached shadow root, without ever
 *     re-attaching it.
 *
 * Default mode is 'closed' — the strongest DOM-level isolation this embed
 * target supports (PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md's web_component
 * security model). 'open' exists only for test harnesses that need to
 * inspect rendered content; production hosts should never request it.
 */

export type WidgetShadowMode = 'open' | 'closed'

const CONTAINER_MARKER_ATTRIBUTE = 'data-allfantasy-widget-root'

/** Attaches a NEW shadow root. Callers must invoke this at most once per host element. */
export function attachShadowMountRoot(host: HTMLElement, mode: WidgetShadowMode): ShadowRoot {
  return host.attachShadow({ mode })
}

/**
 * Creates a fresh container element inside an already-attached shadow root,
 * removing any previous content first. Safe to call repeatedly without
 * re-attaching the shadow root itself.
 */
export function mountShadowContainer(shadowRoot: ShadowRoot): HTMLElement {
  unmountShadowContainer(shadowRoot)
  const container = document.createElement('div')
  container.setAttribute(CONTAINER_MARKER_ATTRIBUTE, '')
  shadowRoot.appendChild(container)
  return container
}

/** Removes all content from the shadow root. Idempotent — safe on an already-empty root. */
export function unmountShadowContainer(shadowRoot: ShadowRoot): void {
  while (shadowRoot.firstChild) {
    shadowRoot.removeChild(shadowRoot.firstChild)
  }
}
