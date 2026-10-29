/**
 * Turning the orphan-team AI draft manager on from the AI settings panel must stick.
 *
 * updateLeagueAISettings read `League.settings`, then called updateDraftUISettings (which writes the
 * orphan keys into `League.settings`), then wrote its own copy built from the EARLIER read — putting
 * the orphan keys straight back. Uses the real DraftUISettingsResolver over a stateful prisma mock,
 * so the test sees what the database holds (the sibling resolver test mocks the draft-UI writer out,
 * which is why it could not see this).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: { league: { findUnique: vi.fn(), update: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))

import { getLeagueAISettings, updateLeagueAISettings } from '@/lib/ai-settings/LeagueAISettingsResolver'

let settingsInDb: Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  settingsInDb = { inviteCode: 'KEEP-ME' }
  m.prisma.league.findUnique.mockImplementation(async () => ({ id: 'L', sport: 'NFL', leagueVariant: null, settings: structuredClone(settingsInDb) }))
  m.prisma.league.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    if ('settings' in data) settingsInDb = structuredClone(data.settings as Record<string, unknown>)
    return { id: 'L', settings: settingsInDb }
  })
})

describe('updateLeagueAISettings: the orphan AI manager toggle sticks', () => {
  it('enabling it alongside another AI toggle persists both', async () => {
    const result = await updateLeagueAISettings('L', { aiDraftManagerOrphanEnabled: true, aiChatChimmyEnabled: false })

    expect(settingsInDb.draft_orphan_team_ai_manager_enabled).toBe(true)
    expect(settingsInDb.draft_orphan_drafter_mode).toBe('ai')
    expect(settingsInDb.ai_feature_ai_chat_chimmy_enabled).toBe(false)
    expect(settingsInDb.inviteCode).toBe('KEEP-ME')
    expect(result.aiDraftManagerOrphanEnabled).toBe(true)
    expect((await getLeagueAISettings('L')).aiDraftManagerOrphanEnabled).toBe(true)
  })

  it('disabling it persists', async () => {
    settingsInDb = { draft_orphan_team_ai_manager_enabled: true, draft_orphan_drafter_mode: 'ai' }
    await updateLeagueAISettings('L', { aiDraftManagerOrphanEnabled: false })
    expect(settingsInDb.draft_orphan_team_ai_manager_enabled).toBe(false)
    expect(settingsInDb.draft_orphan_drafter_mode).toBe('cpu')
  })
})
