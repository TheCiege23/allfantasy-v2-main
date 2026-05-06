import { describe, expect, it } from 'vitest'
import {
  explainProviderCapability,
  getProviderCapabilityRoles,
  providerSupportsDomain,
} from '@/lib/providers/providerDomainCapabilities'

describe('providerDomainCapabilities', () => {
  it('marks clearsports as fallback for NFL injuries', () => {
    const roles = getProviderCapabilityRoles('clearsports', 'NFL')
    expect(roles.injuries).toBe('fallback')
    expect(providerSupportsDomain('clearsports', 'injuries', 'NFL')).toBe(true)
    expect(explainProviderCapability('clearsports', 'injuries', 'NFL')).toContain('fallback')
  })

  it('marks allfantasy_internal primary for trade_value', () => {
    const roles = getProviderCapabilityRoles('allfantasy_internal', 'NBA')
    expect(roles.trade_value).toBe('primary')
  })
})
