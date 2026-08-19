import { describe, expect, it } from 'vitest'
import { formatManagerDnaForPrompt } from '@/lib/decision-os/phase6/dna/formatForPrompt'
import type { ManagerDnaProfile } from '@/lib/decision-os/phase6/dna/types'

function baseProfile(overrides: Partial<ManagerDnaProfile> = {}): ManagerDnaProfile {
  return {
    managerId: 'manager-1',
    leagueId: 'league-1',
    primaryIdentity: 'serial_trader',
    confidence: 0.75,
    decisionStyle: 'reactive',
    transactionStyle: 'trade_dominant',
    riskTendency: 'risk_taking',
    engagementReliability: 'reliable',
    traits: [
      { trait: 'active_trade_initiator', strength: 'strong', evidence: ['5 trade proposal spike(s) detected'] },
    ],
    derivation: ['serial_trader: score=0.750, threshold=0.5 → SELECTED'],
    warnings: [],
    completeness: 90,
    ...overrides,
  }
}

describe('formatManagerDnaForPrompt', () => {
  it('returns empty string for an unknown/insufficient-data identity (matches legacy silence behavior)', () => {
    expect(
      formatManagerDnaForPrompt(
        baseProfile({ primaryIdentity: 'unknown', confidence: 0, traits: [], derivation: [], warnings: ['insufficient_data: completeness below minimum threshold'] }),
      ),
    ).toBe('')
  })

  it('returns non-empty text for a confidently-classified profile', () => {
    const text = formatManagerDnaForPrompt(baseProfile())
    expect(text.length).toBeGreaterThan(0)
  })

  it('is a pure function of its input (stable/deterministic — same input produces byte-identical output)', () => {
    const profile = baseProfile()
    expect(formatManagerDnaForPrompt(profile)).toBe(formatManagerDnaForPrompt(profile))
    expect(formatManagerDnaForPrompt(baseProfile())).toBe(formatManagerDnaForPrompt(baseProfile()))
  })

  it('title-cases the identity label and all four behavioral dimensions', () => {
    const text = formatManagerDnaForPrompt(baseProfile())
    expect(text).toContain('Identity: Serial Trader')
    expect(text).toContain('Decision Style: Reactive')
    expect(text).toContain('Transaction Style: Trade Dominant')
    expect(text).toContain('Risk Tendency: Risk Taking')
    expect(text).toContain('Engagement Reliability: Reliable')
  })

  it('renders confidence as a rounded percentage alongside data completeness', () => {
    const text = formatManagerDnaForPrompt(baseProfile({ confidence: 0.754, completeness: 88 }))
    expect(text).toContain('Confidence: 75% (data completeness: 88%)')
  })

  it('renders traits with strength and evidence when present', () => {
    const text = formatManagerDnaForPrompt(
      baseProfile({
        traits: [
          { trait: 'waiver_wire_aggressor', strength: 'moderate', evidence: ['3 waiver aggression window(s) detected'] },
        ],
      }),
    )
    expect(text).toContain('### Behavioral Traits:')
    expect(text).toContain('- Waiver Wire Aggressor (moderate) — 3 waiver aggression window(s) detected')
  })

  it('omits the traits section entirely when there are no traits', () => {
    const text = formatManagerDnaForPrompt(baseProfile({ traits: [] }))
    expect(text).not.toContain('### Behavioral Traits:')
  })

  it('renders a Data Notes section when warnings are present, omits it when empty', () => {
    const withWarnings = formatManagerDnaForPrompt(
      baseProfile({ warnings: ['conflicting_signals: conservative roster pattern alongside trade spike — set_and_forget may understate trade activity'] }),
    )
    expect(withWarnings).toContain('### Data Notes:')
    expect(withWarnings).toContain('conflicting_signals: conservative roster pattern alongside trade spike')

    const withoutWarnings = formatManagerDnaForPrompt(baseProfile({ warnings: [] }))
    expect(withoutWarnings).not.toContain('### Data Notes:')
  })

  it('never leaks the internal derivation audit trail into the prompt text', () => {
    const text = formatManagerDnaForPrompt(
      baseProfile({ derivation: ['ghost_manager: score=0.100, threshold=0.5', 'serial_trader: score=0.750, threshold=0.5 → SELECTED'] }),
    )
    expect(text).not.toContain('threshold=0.5')
    expect(text).not.toContain('SELECTED')
  })

  it('includes the closing tailoring instruction present in the legacy formatter', () => {
    const text = formatManagerDnaForPrompt(baseProfile())
    expect(text).toContain(
      "IMPORTANT: Tailor your analysis tone and advice to this manager's profile. Reference their tendencies when relevant.",
    )
  })

  it('matches the exact frozen text contract for a representative profile (regression snapshot)', () => {
    const text = formatManagerDnaForPrompt(
      baseProfile({
        primaryIdentity: 'waiver_hawk',
        confidence: 0.68,
        decisionStyle: 'methodical',
        transactionStyle: 'waiver_dominant',
        riskTendency: 'risk_taking',
        engagementReliability: 'reliable',
        traits: [
          { trait: 'waiver_wire_aggressor', strength: 'strong', evidence: ['4 waiver aggression window(s) detected'] },
        ],
        warnings: [],
        completeness: 95,
      }),
    )
    expect(text).toBe(
      [
        '',
        '## MANAGER DNA PROFILE',
        'Identity: Waiver Hawk',
        'Confidence: 68% (data completeness: 95%)',
        '',
        '### Behavioral Dimensions:',
        '- Decision Style: Methodical',
        '- Transaction Style: Waiver Dominant',
        '- Risk Tendency: Risk Taking',
        '- Engagement Reliability: Reliable',
        '',
        '### Behavioral Traits:',
        '- Waiver Wire Aggressor (strong) — 4 waiver aggression window(s) detected',
        '',
        "IMPORTANT: Tailor your analysis tone and advice to this manager's profile. Reference their tendencies when relevant.",
      ].join('\n'),
    )
  })
})
