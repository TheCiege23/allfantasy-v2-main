/**
 * Decision OS — Widget Host/Child Facades.
 *
 * The single public entrypoint for each side of an embedded AllFantasy
 * widget: `createAllFantasyWidgetHost` (Phase 7.12, the partner page) and
 * `createAllFantasyWidgetIframeClient` (Phase 7.13, the code running inside
 * the widget's own iframe). Both hide their respective protocol/bootstrap/
 * browser-bridge layers behind a small config object and typed callbacks. A
 * SEPARATE barrel — NOT re-exported from `sdk-runtime/iframe/src/index.ts`
 * — for the same reason `browser/index.ts` is separate: that main index is
 * typechecked with no "dom" lib, and this layer needs it.
 */

export type {
  AllFantasyWidgetHostCallbacks,
  AllFantasyWidgetHostConfig,
  AllFantasyWidgetHost,
} from './types'

export { createAllFantasyWidgetHost } from './widgetHost'

export type {
  AllFantasyWidgetIframeClientCallbacks,
  AllFantasyWidgetIframeClientConfig,
  AllFantasyWidgetIframeClient,
} from './iframeClientTypes'

export { createAllFantasyWidgetIframeClient } from './widgetIframeClient'

export type { AllFantasyWidgetIframeClientFromUrlConfig } from './widgetIframeClientFromUrl'
export { createAllFantasyWidgetIframeClientFromUrl } from './widgetIframeClientFromUrl'
