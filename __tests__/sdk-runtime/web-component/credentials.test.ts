import { describe, expect, it } from 'vitest'
import {
  clearElementCredentials,
  getElementCredentials,
  setElementCredentials,
} from '../../../sdk-runtime/web-component/src/credentials'
import type { SDKAuth } from '../../../lib/decision-os/sdk/types'

function makeAuth(credential = 'tok_test_secret_credential'): SDKAuth {
  return {
    method: 'api_key',
    credential,
    tenantId: 'tenant_abc',
    expiresAt: null,
    scopes: ['intelligence:league:read'],
  }
}

describe('credentials WeakMap accessors', () => {
  it('returns null for an element with no credentials set', () => {
    const el = {}
    expect(getElementCredentials(el)).toBeNull()
  })

  it('set then get returns the same credentials', () => {
    const el = {}
    const auth = makeAuth()
    setElementCredentials(el, { auth, apiKey: 'ak_test_key' })
    expect(getElementCredentials(el)).toEqual({ auth, apiKey: 'ak_test_key' })
  })

  it('different element instances do not share credential state', () => {
    const elA = {}
    const elB = {}
    setElementCredentials(elA, { auth: makeAuth('cred_a'), apiKey: 'key_a' })
    setElementCredentials(elB, { auth: makeAuth('cred_b'), apiKey: 'key_b' })
    expect(getElementCredentials(elA)?.apiKey).toBe('key_a')
    expect(getElementCredentials(elB)?.apiKey).toBe('key_b')
  })

  it('a later set overwrites an earlier one for the same element', () => {
    const el = {}
    setElementCredentials(el, { auth: makeAuth('first'), apiKey: 'key_first' })
    setElementCredentials(el, { auth: makeAuth('second'), apiKey: 'key_second' })
    expect(getElementCredentials(el)?.apiKey).toBe('key_second')
    expect(getElementCredentials(el)?.auth.credential).toBe('second')
  })

  it('clear removes stored credentials', () => {
    const el = {}
    setElementCredentials(el, { auth: makeAuth(), apiKey: 'ak_test_key' })
    clearElementCredentials(el)
    expect(getElementCredentials(el)).toBeNull()
  })

  it('clearing an element that never had credentials is a safe no-op', () => {
    const el = {}
    expect(() => clearElementCredentials(el)).not.toThrow()
  })
})
