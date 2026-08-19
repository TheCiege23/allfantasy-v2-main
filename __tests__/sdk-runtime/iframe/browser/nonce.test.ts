import { describe, expect, it } from 'vitest'
import { generateNonce } from '../../../../sdk-runtime/iframe/src/browser/nonce'
import type { RandomSource } from '../../../../sdk-runtime/iframe/src/browser/nonce'
import { isValidNonceFormat } from '../../../../sdk-runtime/iframe/src/protocol'

function makeFakeRandomSource(fillValue: number): RandomSource {
  return {
    getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint8Array) {
        array.fill(fillValue)
      }
      return array
    },
  }
}

describe('generateNonce', () => {
  it('produces a deterministic output for a deterministic random source', () => {
    const source = makeFakeRandomSource(0)
    const a = generateNonce(source)
    const b = generateNonce(source)
    expect(a).toBe(b)
  })

  it('different fill values produce different nonces', () => {
    const a = generateNonce(makeFakeRandomSource(0))
    const b = generateNonce(makeFakeRandomSource(1))
    expect(a).not.toBe(b)
  })

  it('always satisfies isValidNonceFormat', () => {
    for (const fill of [0, 1, 42, 100, 255]) {
      expect(isValidNonceFormat(generateNonce(makeFakeRandomSource(fill)))).toBe(true)
    }
  })

  it('produces a 24-character nonce', () => {
    expect(generateNonce(makeFakeRandomSource(7))).toHaveLength(24)
  })

  it('only uses alphanumeric characters', () => {
    const nonce = generateNonce(makeFakeRandomSource(200))
    expect(/^[A-Za-z0-9]+$/.test(nonce)).toBe(true)
  })

  it('uses the real global crypto by default and produces distinct nonces across calls', () => {
    const nonces = new Set<string>()
    for (let i = 0; i < 50; i++) {
      nonces.add(generateNonce())
    }
    // 50 independently-random 24-char nonces colliding would indicate a real bug.
    expect(nonces.size).toBe(50)
  })

  it('every call using the real crypto source satisfies isValidNonceFormat', () => {
    for (let i = 0; i < 10; i++) {
      expect(isValidNonceFormat(generateNonce())).toBe(true)
    }
  })
})
