import { describe, expect, it } from 'vitest'
import { createBrowserWindowBridge } from '../../../../sdk-runtime/iframe/src/browser/windowBridge'
import type { BrowserWindowSource } from '../../../../sdk-runtime/iframe/src/browser/windowBridge'
import type { WindowMessageListener } from '../../../../sdk-runtime/iframe/src/windowLike'

function makeMockBrowserWindow() {
  const sent: Array<{ message: unknown; targetOrigin: string }> = []
  const domListeners: Array<(event: MessageEvent) => void> = []
  const source: BrowserWindowSource = {
    postMessage: (message: unknown, targetOrigin: string) => { sent.push({ message, targetOrigin }) },
    addEventListener: ((_type: string, listener: (event: MessageEvent) => void) => {
      domListeners.push(listener)
    }) as BrowserWindowSource['addEventListener'],
    removeEventListener: ((_type: string, listener: (event: MessageEvent) => void) => {
      const i = domListeners.indexOf(listener)
      if (i >= 0) domListeners.splice(i, 1)
    }) as BrowserWindowSource['removeEventListener'],
  }
  return { source, sent, domListeners }
}

describe('createBrowserWindowBridge — postMessage', () => {
  it('forwards message and targetOrigin to the underlying window', () => {
    const { source, sent } = makeMockBrowserWindow()
    const bridge = createBrowserWindowBridge(source)
    bridge.postMessage({ hello: 'world' }, 'https://partner.example.com')
    expect(sent).toEqual([{ message: { hello: 'world' }, targetOrigin: 'https://partner.example.com' }])
  })
})

describe('createBrowserWindowBridge — addEventListener translates MessageEvent to MessageEventLike', () => {
  it('delivers data/origin from a real MessageEvent shape to our listener', () => {
    const { source, domListeners } = makeMockBrowserWindow()
    const bridge = createBrowserWindowBridge(source)

    const received: Array<{ data: unknown; origin: string }> = []
    const ours: WindowMessageListener = (event) => received.push(event)
    bridge.addEventListener('message', ours)

    expect(domListeners).toHaveLength(1)
    // Simulate the real DOM firing a MessageEvent by invoking the captured
    // DOM listener directly with a MessageEvent-shaped object.
    domListeners[0]({ data: { foo: 'bar' }, origin: 'https://widgets.allfantasy.app' } as MessageEvent)

    expect(received).toEqual([{ data: { foo: 'bar' }, origin: 'https://widgets.allfantasy.app' }])
  })

  it('registers exactly one underlying DOM listener per call to addEventListener', () => {
    const { source, domListeners } = makeMockBrowserWindow()
    const bridge = createBrowserWindowBridge(source)
    bridge.addEventListener('message', () => {})
    bridge.addEventListener('message', () => {})
    expect(domListeners).toHaveLength(2)
  })
})

describe('createBrowserWindowBridge — removeEventListener', () => {
  it('removes the underlying DOM listener for the matching WindowMessageListener', () => {
    const { source, domListeners } = makeMockBrowserWindow()
    const bridge = createBrowserWindowBridge(source)

    const ours: WindowMessageListener = () => {}
    bridge.addEventListener('message', ours)
    expect(domListeners).toHaveLength(1)

    bridge.removeEventListener('message', ours)
    expect(domListeners).toHaveLength(0)
  })

  it('does not throw when removing a listener that was never added', () => {
    const { source } = makeMockBrowserWindow()
    const bridge = createBrowserWindowBridge(source)
    expect(() => bridge.removeEventListener('message', () => {})).not.toThrow()
  })

  it('removing one listener does not remove a different listener', () => {
    const { source, domListeners } = makeMockBrowserWindow()
    const bridge = createBrowserWindowBridge(source)

    const a: WindowMessageListener = () => {}
    const b: WindowMessageListener = () => {}
    bridge.addEventListener('message', a)
    bridge.addEventListener('message', b)
    expect(domListeners).toHaveLength(2)

    bridge.removeEventListener('message', a)
    expect(domListeners).toHaveLength(1)
  })

  it('a listener removed then re-added still delivers events (map entry replaced correctly)', () => {
    const { source, domListeners } = makeMockBrowserWindow()
    const bridge = createBrowserWindowBridge(source)

    const received: unknown[] = []
    const ours: WindowMessageListener = (event) => received.push(event.data)

    bridge.addEventListener('message', ours)
    bridge.removeEventListener('message', ours)
    bridge.addEventListener('message', ours)
    expect(domListeners).toHaveLength(1)

    domListeners[0]({ data: 'x', origin: 'https://widgets.allfantasy.app' } as MessageEvent)
    expect(received).toEqual(['x'])
  })
})
