import { describe, expect, it } from 'vitest'
import { createIframeContentWindowBridge } from '../../../../sdk-runtime/iframe/src/browser/iframeElementAdapter'
import type { IframeElementSource } from '../../../../sdk-runtime/iframe/src/browser/iframeElementAdapter'
import type { BrowserWindowSource } from '../../../../sdk-runtime/iframe/src/browser/windowBridge'

function makeMockContentWindow(): BrowserWindowSource {
  return {
    postMessage: () => {},
    addEventListener: (() => {}) as BrowserWindowSource['addEventListener'],
    removeEventListener: (() => {}) as BrowserWindowSource['removeEventListener'],
  }
}

describe('createIframeContentWindowBridge', () => {
  it('throws when contentWindow is null', () => {
    const element: IframeElementSource = { contentWindow: null }
    expect(() => createIframeContentWindowBridge(element)).toThrow(/contentWindow is not available/)
  })

  it('returns a working WindowLike bridge when contentWindow is present', () => {
    const contentWindow = makeMockContentWindow()
    const element: IframeElementSource = { contentWindow }
    const bridge = createIframeContentWindowBridge(element)

    expect(bridge).toHaveProperty('postMessage')
    expect(bridge).toHaveProperty('addEventListener')
    expect(bridge).toHaveProperty('removeEventListener')
  })

  it('the returned bridge forwards postMessage to the underlying contentWindow', () => {
    let received: { message: unknown; targetOrigin: string } | null = null
    const contentWindow: BrowserWindowSource = {
      postMessage: (message, targetOrigin) => { received = { message, targetOrigin } },
      addEventListener: (() => {}) as BrowserWindowSource['addEventListener'],
      removeEventListener: (() => {}) as BrowserWindowSource['removeEventListener'],
    }
    const bridge = createIframeContentWindowBridge({ contentWindow })

    bridge.postMessage({ x: 1 }, 'https://widgets.allfantasy.app')
    expect(received).toEqual({ message: { x: 1 }, targetOrigin: 'https://widgets.allfantasy.app' })
  })
})
