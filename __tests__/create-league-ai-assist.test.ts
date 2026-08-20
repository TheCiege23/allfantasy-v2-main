import { describe, expect, it } from 'vitest'
import { hydrateCreateLeagueInitialState } from '@/lib/create-league-v2/create-league-initial-hydration'
import { inferLeagueAiRecommendationFromDescription } from '@/lib/create-league-v2/ai/heuristic-infer'
import { normalizeLeagueAiRecommendation } from '@/lib/create-league-v2/ai/normalize-recommendation'
import { applyLeagueAiRecommendationToState } from '@/lib/create-league-v2/ai/apply-recommendation'
import { parseLeagueAiRecommendationJson } from '@/lib/create-league-v2/ai/types'
import type { LeagueAiRecommendation } from '@/lib/create-league-v2/ai/types'

function baseState() {
  return hydrateCreateLeagueInitialState(null, 'quick')
}

describe('create league AI assist (Phase 3C)', () => {
  it('infers dynasty template for dynasty + taxi wording', () => {
    const rec = inferLeagueAiRecommendationFromDescription('Hardcore dynasty league with taxi squads for NFL')
    expect(rec.recommendedTemplateId).toBe('dynasty')
    expect(rec.confidence).toBeGreaterThan(0.8)
    expect(rec.extractedSettings.sport).toBe('NFL')
    expect(rec.unsupportedRequests).toHaveLength(0)
  })

  it('infers best ball from description', () => {
    const rec = inferLeagueAiRecommendationFromDescription('Make me a best ball league')
    expect(rec.recommendedTemplateId).toBe('best_ball')
    expect(rec.unsupportedRequests).toHaveLength(0)
  })

  it('flags unsupported survivor intent without inventing a template', () => {
    const rec = inferLeagueAiRecommendationFromDescription('I want a survivor office pool')
    expect(rec.recommendedTemplateId).toBeNull()
    expect(rec.unsupportedRequests.length).toBeGreaterThan(0)
  })

  it('infers casual redraft for office / beginner tone', () => {
    const rec = inferLeagueAiRecommendationFromDescription('I want a casual office league for beginners')
    expect(rec.recommendedTemplateId).toBe('casual_redraft')
    expect(rec.unsupportedRequests).toHaveLength(0)
  })

  it('infers public visibility for paid serious redraft phrasing', () => {
    const rec = inferLeagueAiRecommendationFromDescription('I want a public paid league for serious players')
    expect(rec.extractedSettings.standardDiscoveryVisibility).toBe('public')
    expect(rec.recommendedTemplateId).toBe('competitive_redraft')
  })

  it('normalize strips unknown template ids and records a warning', () => {
    const rec = normalizeLeagueAiRecommendation({
      recommendedTemplateId: 'not_a_real_template' as LeagueAiRecommendation['recommendedTemplateId'],
      confidence: 0.9,
      explanation: 'x',
      extractedSettings: {},
      warnings: [],
      unsupportedRequests: [],
    })
    expect(rec.recommendedTemplateId).toBeNull()
    expect(rec.warnings.some((w) => w.includes('unknown template'))).toBe(true)
  })

  it('parseLeagueAiRecommendationJson rejects invalid JSON', () => {
    const r = parseLeagueAiRecommendationJson('{')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('JSON')
  })

  it('parseLeagueAiRecommendationJson rejects objects missing required fields', () => {
    const r = parseLeagueAiRecommendationJson({ confidence: 0.5 })
    expect(r.ok).toBe(false)
  })

  it('applyLeagueAiRecommendationToState hydrates template + sport without throwing', () => {
    const start = baseState()
    const rec = inferLeagueAiRecommendationFromDescription('Dynasty NBA league')
    const next = applyLeagueAiRecommendationToState(start, rec)
    expect(next.selectedTemplateId).toBe('dynasty')
    expect(next.sport).toBe('NBA')
    expect(next.leagueType).toBe('dynasty')
  })

  it('preserves user-touched league name when applying AI recommendation', () => {
    const start = {
      ...baseState(),
      name: 'Commissioner Custom Name',
      nameTouched: true,
    }
    const rec = inferLeagueAiRecommendationFromDescription('casual redraft')
    const next = applyLeagueAiRecommendationToState(start, rec)
    expect(next.name).toBe('Commissioner Custom Name')
    expect(next.nameTouched).toBe(true)
  })

  it('preserves unrelated user fields (e.g. language) when applying', () => {
    const start = { ...baseState(), language: 'es' as const }
    const rec = inferLeagueAiRecommendationFromDescription('guillotine NFL')
    const next = applyLeagueAiRecommendationToState(start, rec)
    expect(next.language).toBe('es')
    expect(next.selectedTemplateId).toBe('guillotine')
  })

  it('accepts valid JSON payloads from a future provider', () => {
    const payload: LeagueAiRecommendation = {
      recommendedTemplateId: 'dynasty',
      confidence: 0.77,
      explanation: 'Structured fixture',
      extractedSettings: { teamCount: 12, sport: 'NFL' },
      warnings: [],
      unsupportedRequests: [],
    }
    const r = parseLeagueAiRecommendationJson(JSON.stringify(payload))
    expect(r.ok).toBe(true)
    if (r.ok) {
      const applied = applyLeagueAiRecommendationToState(baseState(), r.value)
      expect(applied.selectedTemplateId).toBe('dynasty')
    }
  })
})
