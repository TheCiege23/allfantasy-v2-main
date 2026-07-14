import { describe, expect, it } from 'vitest'
import {
  assertDecisionOSInsightGrounded,
  createDeterministicAiBoundary,
  createExplanationOnlyAiBoundary,
  type DecisionOSInsight,
} from '@/lib/decision-os/core/decision'

function baseInsight(overrides: Partial<DecisionOSInsight> = {}): DecisionOSInsight {
  return {
    id: 'insight-1',
    recommendationType: 'waiver_recommendation',
    targetUserId: 'user-1',
    leagueId: 'league-1',
    plugin: {
      pluginId: 'redraft',
      leagueType: 'redraft',
      inheritedBehavior: ['core-waiver-engine'],
      overriddenBehavior: [],
    },
    riskLevel: 'low',
    actionability: 'recommended',
    confidence: 82,
    dataCompleteness: 90,
    evidence: [
      {
        id: 'ev-waiver-pool',
        sourceType: 'engine_state',
        sourceId: 'waiver-pool:league-1',
        label: 'Available waiver pool',
        trust: 'authoritative',
      },
    ],
    derivationChain: [
      {
        id: 'step-rank',
        label: 'Rank waiver candidates',
        inputEvidenceIds: ['ev-waiver-pool'],
        ruleId: 'waiver.rank.composite_score',
        output: 'Top candidate selected from deterministic score.',
      },
    ],
    explanation: 'Claim the top ranked player because the deterministic score clears the threshold.',
    aiBoundary: createDeterministicAiBoundary(),
    ...overrides,
  }
}

describe('Decision OS integration contract', () => {
  it('accepts grounded deterministic insights with evidence and derivation', () => {
    expect(() => assertDecisionOSInsightGrounded(baseInsight())).not.toThrow()
  })

  it('allows AI only as explanation with facts locked down', () => {
    const insight = baseInsight({
      aiBoundary: createExplanationOnlyAiBoundary({ model: 'openai:gpt-4.1' }),
    })

    expect(insight.aiBoundary).toMatchObject({
      usedAi: true,
      role: 'explanation_only',
      mayInventFacts: false,
      mayOverrideEngineMath: false,
      mustCiteEvidence: true,
    })
    expect(() => assertDecisionOSInsightGrounded(insight)).not.toThrow()
  })

  it('rejects insights without evidence', () => {
    expect(() => assertDecisionOSInsightGrounded(baseInsight({ evidence: [] }))).toThrow(
      /requires at least one evidence source/,
    )
  })

  it('rejects derivation chains that reference missing evidence', () => {
    expect(() =>
      assertDecisionOSInsightGrounded(
        baseInsight({
          derivationChain: [
            {
              id: 'step-bad',
              label: 'Bad step',
              inputEvidenceIds: ['missing'],
              ruleId: 'bad.rule',
              output: 'Invalid',
            },
          ],
        }),
      ),
    ).toThrow(/missing evidence/)
  })

  it('rejects any AI boundary that can invent facts', () => {
    expect(() =>
      assertDecisionOSInsightGrounded({
        ...baseInsight(),
        aiBoundary: {
          usedAi: true,
          role: 'explanation_only',
          mayInventFacts: true as false,
          mayOverrideEngineMath: false,
          mustCiteEvidence: true,
        },
      }),
    ).toThrow(/cannot invent facts/)
  })
})
