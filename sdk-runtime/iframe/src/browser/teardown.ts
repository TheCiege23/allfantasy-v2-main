/**
 * Decision OS — Phase 7.11 Browser Iframe Adapter: teardown helper.
 *
 * Order matters: the host sends its final 'dispose' message to the child
 * BEFORE the iframe element is removed from the document. Removing the
 * element first would tear down the child's browsing context, likely
 * dropping the final message before it's delivered.
 */

import type { IframeHostBootstrap } from '../iframeHost'

export interface RemovableElement {
  remove(): void
}

export function teardownIframeWidget(host: IframeHostBootstrap, iframeElement: RemovableElement): void {
  host.dispose()
  iframeElement.remove()
}
