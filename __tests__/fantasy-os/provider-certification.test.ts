import { describe, it, expect } from 'vitest'
import {
  PROVIDER_CERTIFICATION,
  summarizeProviderCertification,
  isProviderConnectable,
  type ProviderCertRecord,
} from '@/lib/sports-data-gateway/providers/certificationStatus'

/**
 * Phase 5H-d — provider certification ledger consistency. Encodes the rule: a provider is "connected" ONLY with
 * real request evidence; credential presence alone is never enough; blocked/unwired providers stay honest.
 */

const rec = (p: string): ProviderCertRecord => PROVIDER_CERTIFICATION.find((r) => r.provider === p)!

describe('5H-d — certification ledger is evidence-gated', () => {
  it('every CERTIFIED or VERIFIED provider has a real lastVerifiedAt (evidence) and at least one capability', () => {
    for (const r of PROVIDER_CERTIFICATION) {
      if (r.status === 'CERTIFIED' || r.status === 'VERIFIED') {
        expect(r.lastVerifiedAt, `${r.provider} marked ${r.status} without lastVerifiedAt`).toBeTruthy()
        expect(r.capabilitiesVerified.length, `${r.provider} ${r.status} with no verified capability`).toBeGreaterThan(0)
        expect(r.sportsVerified.length, `${r.provider} ${r.status} with no verified sport`).toBeGreaterThan(0)
      }
    }
  })

  it('every BLOCKED / REQUIRES_WIRING provider has a reason and NO verified evidence (not presented as connected)', () => {
    for (const r of PROVIDER_CERTIFICATION) {
      if (r.status === 'BLOCKED' || r.status === 'REQUIRES_WIRING') {
        expect(r.blockedReason, `${r.provider} ${r.status} without a reason`).toBeTruthy()
        expect(r.lastVerifiedAt, `${r.provider} ${r.status} must not claim verification`).toBeNull()
        expect(r.capabilitiesVerified).toEqual([])
      }
    }
  })

  it('credentialPresent is a structural boolean — never a secret value', () => {
    for (const r of PROVIDER_CERTIFICATION) {
      expect(typeof r.credentialPresent, `${r.provider} credentialPresent must be boolean`).toBe('boolean')
    }
  })

  it('the honest verdicts from the 5H-d proving run hold', () => {
    // keyless certified end-to-end
    for (const p of ['espn', 'sleeper', 'fantasycalc']) expect(rec(p).status).toBe('CERTIFIED')
    // keyed, real request succeeded → canonical contract, persistence REQ-MIGRATION
    for (const p of ['thesportsdb', 'cfbd', 'api_sports']) expect(rec(p).status).toBe('VERIFIED')
    // real request failed (provider 500)
    expect(rec('clearsports').status).toBe('BLOCKED')
    // credential present but client not cleanly probeable
    expect(rec('rolling_insights').status).toBe('REQUIRES_WIRING')
  })

  it('FantasyCalc value persistence is REQ-MIGRATION, not falsely certified', () => {
    expect(rec('fantasycalc').persistence).toBe('requires_migration')
  })

  it('only ESPN + Sleeper claim certified-snapshot persistence (the only providers on the certified plane)', () => {
    const snapshotProviders = PROVIDER_CERTIFICATION.filter((r) => r.persistence === 'certified_snapshot').map((r) => r.provider).sort()
    expect(snapshotProviders).toEqual(['espn', 'sleeper'])
  })
})

describe('5H-d — connectable gating', () => {
  it('only certified/verified providers are connectable; blocked/unwired are not', () => {
    const s = summarizeProviderCertification()
    expect(s.connectable.sort()).toEqual(['api_sports', 'cfbd', 'espn', 'fantasycalc', 'sleeper', 'thesportsdb'])
    expect(isProviderConnectable('clearsports')).toBe(false)
    expect(isProviderConnectable('rolling_insights')).toBe(false)
    expect(isProviderConnectable('espn')).toBe(true)
    expect(isProviderConnectable('thesportsdb')).toBe(true)
  })
})
