import { describe, expect, it } from 'vitest'
import {
  isValidOriginFormat,
  validateOriginFormat,
  isOriginAllowed,
  assertExplicitTargetOrigin,
} from '../../../sdk-runtime/iframe/src/index'

describe('isValidOriginFormat', () => {
  it('accepts a plain https origin', () => {
    expect(isValidOriginFormat('https://partner.example.com')).toBe(true)
  })
  it('accepts an http origin', () => {
    expect(isValidOriginFormat('http://localhost')).toBe(true)
  })
  it('accepts an origin with a port', () => {
    expect(isValidOriginFormat('https://partner.example.com:8443')).toBe(true)
  })
  it('rejects an origin with a path', () => {
    expect(isValidOriginFormat('https://partner.example.com/path')).toBe(false)
  })
  it('rejects an origin with a trailing slash', () => {
    expect(isValidOriginFormat('https://partner.example.com/')).toBe(false)
  })
  it('rejects an origin with a query string', () => {
    expect(isValidOriginFormat('https://partner.example.com?x=1')).toBe(false)
  })
  it('rejects the wildcard', () => {
    expect(isValidOriginFormat('*')).toBe(false)
  })
  it('rejects a scheme-less string', () => {
    expect(isValidOriginFormat('partner.example.com')).toBe(false)
  })
  it('rejects an empty string', () => {
    expect(isValidOriginFormat('')).toBe(false)
  })
})

describe('validateOriginFormat', () => {
  it('passes for a valid origin', () => {
    expect(validateOriginFormat('https://partner.example.com').valid).toBe(true)
  })
  it('fails with a specific message for the wildcard', () => {
    const result = validateOriginFormat('*')
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('wildcard'))).toBe(true)
  })
  it('fails for a malformed origin', () => {
    expect(validateOriginFormat('not-a-url').valid).toBe(false)
  })
})

describe('isOriginAllowed — exact match only', () => {
  const allowlist = ['https://partner.example.com', 'https://widgets.sleeper.app']

  it('accepts an exact match', () => {
    expect(isOriginAllowed('https://partner.example.com', allowlist)).toBe(true)
  })
  it('rejects an origin not on the list', () => {
    expect(isOriginAllowed('https://evil.example.com', allowlist)).toBe(false)
  })
  it('rejects a substring-attack origin (evil.partner.example.com.attacker.com)', () => {
    expect(isOriginAllowed('https://partner.example.com.attacker.com', allowlist)).toBe(false)
  })
  it('rejects a prefix-only match', () => {
    expect(isOriginAllowed('https://partner.example.com.evil.com', allowlist)).toBe(false)
  })
  it('rejects a different scheme for an otherwise-matching host', () => {
    expect(isOriginAllowed('http://partner.example.com', allowlist)).toBe(false)
  })
  it('rejects a different port for an otherwise-matching host', () => {
    expect(isOriginAllowed('https://partner.example.com:8443', allowlist)).toBe(false)
  })
  it('empty allowlist rejects everything', () => {
    expect(isOriginAllowed('https://partner.example.com', [])).toBe(false)
  })
})

describe('assertExplicitTargetOrigin', () => {
  it('throws for the wildcard', () => {
    expect(() => assertExplicitTargetOrigin('*')).toThrow(/never be "\*"/)
  })
  it('does not throw for a real origin', () => {
    expect(() => assertExplicitTargetOrigin('https://partner.example.com')).not.toThrow()
  })
})
