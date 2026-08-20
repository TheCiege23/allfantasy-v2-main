/**
 * Phase 3B — League creation templates (metadata, hydration, summary).
 */

import { describe, expect, it } from 'vitest'

import { DEFAULT_V2_STATE } from '@/lib/create-league-v2/state'
import { buildCanonicalCreatePayload } from '@/lib/create-league-v2/submit'
import { buildCreateLeagueReviewSnapshot } from '@/lib/create-league-v2/reviewCanonicalSnapshot'
import {
  LEAGUE_CREATION_TEMPLATES,
  getLeagueCreationTemplateMeta,
  isLeagueCreationTemplateId,
  listLeagueCreationTemplates,
} from '@/lib/create-league-v2/templates/catalog'
import { LEAGUE_CREATION_TEMPLATE_IDS } from '@/lib/create-league-v2/templates/types'
import { applyLeagueCreationTemplate } from '@/lib/create-league-v2/templates/hydrate'
import { buildTemplateModeSummaryRows } from '@/lib/create-league-v2/templates/summary'

describe('template catalog', () => {
  it('has exactly five supported templates with required fields', () => {
    expect(LEAGUE_CREATION_TEMPLATE_IDS).toHaveLength(5)
    for (const id of LEAGUE_CREATION_TEMPLATE_IDS) {
      const m = getLeagueCreationTemplateMeta(id)
      expect(m.id).toBe(id)
      expect(m.title.trim().length).toBeGreaterThan(2)
      expect(m.shortDescription.length).toBeGreaterThan(20)
      expect(m.recommendedPlayerType.length).toBeGreaterThan(3)
      expect(m.gameplayStyle.length).toBeGreaterThan(3)
      expect(m.rosterStyle.length).toBeGreaterThan(3)
      expect(m.waiverStyle.length).toBeGreaterThan(3)
      expect(m.draftStyle.length).toBeGreaterThan(3)
      expect(m.scoringStyle.length).toBeGreaterThan(3)
      expect(['casual', 'moderate', 'advanced']).toContain(m.complexity)
      expect(m.visibilityRecommendation.length).toBeGreaterThan(5)
      expect(m.commissionerGuidance.length).toBeGreaterThan(5)
    }
  })

  it('listLeagueCreationTemplates returns stable ordering', () => {
    const list = listLeagueCreationTemplates()
    expect(list.map((x) => x.id)).toEqual([...LEAGUE_CREATION_TEMPLATE_IDS])
  })

  it('isLeagueCreationTemplateId validates ids', () => {
    expect(isLeagueCreationTemplateId('dynasty')).toBe(true)
    expect(isLeagueCreationTemplateId('fake')).toBe(false)
  })
})

describe('applyLeagueCreationTemplate', () => {
  it('preserves sport when applying template', () => {
    const base = { ...DEFAULT_V2_STATE, creationMode: 'templates' as const, sport: 'NBA', nameTouched: true, name: 'Hold' }
    const next = applyLeagueCreationTemplate('dynasty', base)
    expect(next.sport).toBe('NBA')
    expect(next.leagueType).toBe('dynasty')
    expect(next.selectedTemplateId).toBe('dynasty')
  })

  it('preserves compatible regional fields (timezone, language)', () => {
    const base = {
      ...DEFAULT_V2_STATE,
      creationMode: 'templates' as const,
      timezone: 'America/Los_Angeles',
      language: 'es' as const,
      nameTouched: true,
      name: 'Pacific',
    }
    const next = applyLeagueCreationTemplate('casual_redraft', base)
    expect(next.timezone).toBe('America/Los_Angeles')
    expect(next.language).toBe('es')
  })

  it('keeps review snapshot + canonical payload aligned after dynasty template', () => {
    const base = { ...DEFAULT_V2_STATE, creationMode: 'templates' as const, nameTouched: true, name: 'Dynasty Template Test' }
    const state = applyLeagueCreationTemplate('dynasty', base)
    const snap = buildCreateLeagueReviewSnapshot(state)
    const payload = buildCanonicalCreatePayload(state)
    expect(snap.engineOk).toBe(true)
    expect(typeof payload.concept).toBe('string')
    expect(payload.sport).toBe(state.sport)
    expect(payload.teamCount).toBe(state.teamCount)
  })
})

describe('buildTemplateModeSummaryRows', () => {
  it('returns intro rows when no template selected', () => {
    const rows = buildTemplateModeSummaryRows({ ...DEFAULT_V2_STATE, creationMode: 'templates', selectedTemplateId: null })
    expect(rows.length).toBeGreaterThan(0)
  })

  it('includes template title after selection', () => {
    const state = applyLeagueCreationTemplate('guillotine', {
      ...DEFAULT_V2_STATE,
      creationMode: 'templates',
      nameTouched: true,
      name: 'Cut league',
    })
    const rows = buildTemplateModeSummaryRows(state)
    expect(rows.some((r) => r.label === 'Template' && r.value === LEAGUE_CREATION_TEMPLATES.guillotine.title)).toBe(true)
  })
})
