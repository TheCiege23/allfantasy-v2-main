import { describe, expect, it } from 'vitest'
import { teardownIframeWidget } from '../../../../sdk-runtime/iframe/src/browser/teardown'
import { IframeHostBootstrap } from '../../../../sdk-runtime/iframe/src/index'
import type { WindowLike, WindowMessageListener } from '../../../../sdk-runtime/iframe/src/index'

const WIDGET_ID = 'widget_league_001'
const NONCE = 'n0nce_abcdef123456'
const CHILD_ORIGIN = 'https://widgets.allfantasy.app'

function makeWindowLike() {
  const sent: unknown[] = []
  const listeners: WindowMessageListener[] = []
  const window: WindowLike = {
    postMessage: (message) => { sent.push(message) },
    addEventListener: (_t, l) => { listeners.push(l) },
    removeEventListener: (_t, l) => {
      const i = listeners.indexOf(l)
      if (i >= 0) listeners.splice(i, 1)
    },
  }
  return { window, sent, listeners }
}

describe('teardownIframeWidget', () => {
  it('calls host.dispose() before removing the element', () => {
    const parent = makeWindowLike()
    const child = makeWindowLike()
    const order: string[] = []

    const trackedChild: WindowLike = {
      ...child.window,
      postMessage: (message) => { order.push('dispose_sent'); child.sent.push(message) },
    }

    const host = new IframeHostBootstrap({
      parentWindow: parent.window, childWindow: trackedChild, childOrigin: CHILD_ORIGIN,
      widgetId: WIDGET_ID, nonce: NONCE,
    })

    const element = { remove: () => { order.push('element_removed') } }
    teardownIframeWidget(host, element)

    expect(order).toEqual(['dispose_sent', 'element_removed'])
  })

  it('disposes the host (isDisposed becomes true)', () => {
    const parent = makeWindowLike()
    const child = makeWindowLike()
    const host = new IframeHostBootstrap({
      parentWindow: parent.window, childWindow: child.window, childOrigin: CHILD_ORIGIN,
      widgetId: WIDGET_ID, nonce: NONCE,
    })

    const element = { remove: () => {} }
    teardownIframeWidget(host, element)

    expect(host.isDisposed).toBe(true)
  })

  it('removes the element', () => {
    const parent = makeWindowLike()
    const child = makeWindowLike()
    const host = new IframeHostBootstrap({
      parentWindow: parent.window, childWindow: child.window, childOrigin: CHILD_ORIGIN,
      widgetId: WIDGET_ID, nonce: NONCE,
    })

    let removed = false
    const element = { remove: () => { removed = true } }
    teardownIframeWidget(host, element)

    expect(removed).toBe(true)
  })

  it('is deterministic — calling twice on an already-disposed host does not throw and still removes', () => {
    const parent = makeWindowLike()
    const child = makeWindowLike()
    const host = new IframeHostBootstrap({
      parentWindow: parent.window, childWindow: child.window, childOrigin: CHILD_ORIGIN,
      widgetId: WIDGET_ID, nonce: NONCE,
    })

    let removeCalls = 0
    const element = { remove: () => { removeCalls++ } }
    teardownIframeWidget(host, element)
    expect(() => teardownIframeWidget(host, element)).not.toThrow()
    expect(removeCalls).toBe(2)
  })
})
