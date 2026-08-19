import { describe, expect, it } from 'vitest'
import { safePostMessage, buildChildToParentMessage } from '../../../sdk-runtime/iframe/src/index'
import type { WindowLike } from '../../../sdk-runtime/iframe/src/index'

function makeRecordingWindow() {
  const sent: Array<{ message: unknown; targetOrigin: string }> = []
  const window: WindowLike = {
    postMessage: (message, targetOrigin) => { sent.push({ message, targetOrigin }) },
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  return { window, sent }
}

describe('safePostMessage', () => {
  it('forwards the message and targetOrigin to the underlying window', () => {
    const { window, sent } = makeRecordingWindow()
    const message = buildChildToParentMessage('ready', 'w1', 'n0nce_abcdef123', { sdkVersion: '7.4.0' })

    safePostMessage(window, message, 'https://partner.example.com')

    expect(sent).toHaveLength(1)
    expect(sent[0].message).toBe(message)
    expect(sent[0].targetOrigin).toBe('https://partner.example.com')
  })

  it('throws and never calls postMessage when targetOrigin is the wildcard', () => {
    const { window, sent } = makeRecordingWindow()
    const message = buildChildToParentMessage('ready', 'w1', 'n0nce_abcdef123', { sdkVersion: '7.4.0' })

    expect(() => safePostMessage(window, message, '*')).toThrow(/never be "\*"/)
    expect(sent).toHaveLength(0)
  })
})
