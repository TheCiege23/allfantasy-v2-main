/**
 * Chimmy quoted a league's internal setting keys back to its commissioner (found live 2026-11-16):
 * "`draftDateRequiredForSetup: false`", "`scheduleGenerated: false`", "the raw league record says
 * 'rolling'". They came from `scoring.rawSources.settingsJson` — the WHOLE stored settings blob — which
 * get_selected_league_rules passed to the model. With "Share with league", such an answer can reach
 * every member. The blob no longer leaves the server; the normalized values still do.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ ctx: vi.fn(), category: vi.fn(() => null) }))
vi.mock('@/lib/league-context-engine', () => ({ resolveNormalizedLeagueContext: h.ctx }))
vi.mock('@/lib/category-scoring/nativeCategoryScoringContext', () => ({ nativeCategoryScoringContext: h.category }))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueStoryline: { findFirst: vi.fn(async () => null) } } }))

import { buildSelectedLeagueRules } from '@/lib/chimmy/tools/selectedLeagueRules'

const SETTINGS_BLOB = { draftDateRequiredForSetup: false, scheduleGenerated: false, sportConfig: { tePremium: 0.25 }, waiverType: 'rolling' }

beforeEach(() => {
  vi.clearAllMocks()
  h.category.mockReturnValue(null)
  h.ctx.mockResolvedValue({
    ok: true,
    context: {
      leagueName: 'Blah2',
      season: 2026,
      sport: 'NFL',
      platform: 'manual',
      scoring: {
        schemaVersion: 1,
        scoringModel: 'points',
        pointsByStat: { rec: 1, rec_yd: 0.1 },
        rawSources: { leagueScoringColumn: 'ppr', settingsJson: SETTINGS_BLOB, embeddedScoringSettings: null, categoryOrModifierPayload: null },
        labels: { receptionFormat: 'ppr', tePremiumExtra: null, isSuperflex: false, isTwoQB: false },
      },
      roster: { starters: ['QB', 'RB'] },
      waiver: { type: 'faab', budget: 100 },
      trade: { reviewHours: 24 },
      playoff: { teams: 6 },
      matchupPeriod: null,
      lineupBehavior: null,
      flags: {},
      importHealth: { lastSyncedAt: null },
    },
  })
})

describe('get_selected_league_rules', () => {
  it('🛑 never sends the stored settings blob or its keys to the model', async () => {
    const out = await buildSelectedLeagueRules('L1', 'u1')
    for (const leaked of ['rawSources', 'settingsJson', 'draftDateRequiredForSetup', 'scheduleGenerated', 'sportConfig', '"rolling"']) {
      expect(out).not.toContain(leaked)
    }
  })

  it('still sends every normalized value an answer needs', async () => {
    const out = await buildSelectedLeagueRules('L1', 'u1')
    expect(out).toContain('"pointsByStat":{"rec":1,"rec_yd":0.1}')
    expect(out).toContain('"receptionFormat":"ppr"')
    expect(out).toContain('"budget":100')
  })

  it('still detects category scoring from the blob, server-side', async () => {
    h.category.mockReturnValue({ categories: ['PTS'] } as never)
    const out = await buildSelectedLeagueRules('L1', 'u1')
    expect(h.category).toHaveBeenCalledWith(SETTINGS_BLOB, 'NFL')
    expect(out).toContain('"scoringModel":"category"')
    expect(out).not.toContain('scheduleGenerated')
  })

  it('tells the model the field names are internal', async () => {
    expect(await buildSelectedLeagueRules('L1', 'u1')).toMatch(/field names below are internal.*Never quote one to the user/)
    const prompt = readFileSync(path.resolve(__dirname, '..', '..', 'lib/chimmy/tools/toolLoopSystemPrompt.ts'), 'utf8')
    expect(prompt).toMatch(/NEVER show the user an internal field name or code from tool data/)
  })
})
