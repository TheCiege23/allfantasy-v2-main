import { describe, expect, it } from 'vitest'
import {
  IFRAME_SANDBOX_TOKENS,
  IFRAME_SANDBOX_ATTRIBUTE,
  IFRAME_FORBIDDEN_SANDBOX_PAIR,
  containsForbiddenSandboxCombination,
  validateSandboxTokens,
  buildCspFrameAncestors,
} from '../../../sdk-runtime/iframe/src/index'

describe('IFRAME_SANDBOX_ATTRIBUTE', () => {
  it('is "allow-scripts allow-popups"', () => {
    expect(IFRAME_SANDBOX_ATTRIBUTE).toBe('allow-scripts allow-popups')
  })
  it('matches the joined tokens', () => {
    expect(IFRAME_SANDBOX_ATTRIBUTE).toBe(IFRAME_SANDBOX_TOKENS.join(' '))
  })
  it('does not itself contain allow-same-origin', () => {
    expect(IFRAME_SANDBOX_TOKENS).not.toContain('allow-same-origin')
  })
})

describe('containsForbiddenSandboxCombination', () => {
  it('detects allow-scripts + allow-same-origin together', () => {
    expect(containsForbiddenSandboxCombination(['allow-scripts', 'allow-same-origin'])).toBe(true)
  })
  it('does not flag allow-scripts alone', () => {
    expect(containsForbiddenSandboxCombination(['allow-scripts'])).toBe(false)
  })
  it('does not flag allow-same-origin alone', () => {
    expect(containsForbiddenSandboxCombination(['allow-same-origin'])).toBe(false)
  })
  it('does not flag the recommended default tokens', () => {
    expect(containsForbiddenSandboxCombination([...IFRAME_SANDBOX_TOKENS])).toBe(false)
  })
  it('detects the pair regardless of order', () => {
    expect(containsForbiddenSandboxCombination(['allow-same-origin', 'allow-popups', 'allow-scripts'])).toBe(true)
  })
})

describe('validateSandboxTokens', () => {
  it('passes for the recommended default', () => {
    expect(validateSandboxTokens([...IFRAME_SANDBOX_TOKENS]).valid).toBe(true)
  })
  it('fails for the forbidden combination', () => {
    const result = validateSandboxTokens([...IFRAME_FORBIDDEN_SANDBOX_PAIR])
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe('buildCspFrameAncestors', () => {
  it('joins origins with a space, prefixed by frame-ancestors', () => {
    expect(buildCspFrameAncestors(['https://partner.example.com', 'https://widgets.sleeper.app'])).toBe(
      'frame-ancestors https://partner.example.com https://widgets.sleeper.app',
    )
  })
  it('handles a single origin', () => {
    expect(buildCspFrameAncestors(['https://partner.example.com'])).toBe('frame-ancestors https://partner.example.com')
  })
  it('is deterministic', () => {
    const origins = ['https://a.example.com', 'https://b.example.com']
    expect(buildCspFrameAncestors(origins)).toBe(buildCspFrameAncestors(origins))
  })
})
