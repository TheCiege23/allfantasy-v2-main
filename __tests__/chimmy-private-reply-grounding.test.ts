import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  openaiChatText: vi.fn(),
  loadLeagueGroundingForUser: vi.fn(),
  buildLeagueStandingsContext: vi.fn(),
  buildHeadToHeadGrounding: vi.fn(),
}))

vi.mock('@/lib/openai-client', () => ({ openaiChatText: h.openaiChatText }))
vi.mock('@/lib/chimmy/chimmy-league-snapshot', () => ({
  loadLeagueGroundingForUser: h.loadLeagueGroundingForUser,
}))
vi.mock('@/lib/chimmy/leagueStandingsGrounding', () => ({
  buildLeagueStandingsContext: h.buildLeagueStandingsContext,
}))
vi.mock('@/lib/chimmy/headToHeadGrounding', () => ({
  buildHeadToHeadGrounding: h.buildHeadToHeadGrounding,
}))
vi.mock('@/lib/chat-core/mentionPrivacyFilter', () => ({
  stripChimmyMentionPrefix: (s: string) => s.replace(/^@chimmy\s*/i, ''),
}))

import { generateChimmyPrivateReply } from '@/lib/chat-core/chimmyPrivateReply'

/** The system prompt the model was actually handed. */
function systemPrompt() {
  return h.openaiChatText.mock.calls[0][0].messages[0].content as string
}

beforeEach(() => {
  vi.clearAllMocks()
  h.openaiChatText.mockResolvedValue({ ok: true, text: 'Start Kelce.' })
  h.loadLeagueGroundingForUser.mockResolvedValue({ ok: true, snapshot: { id: 'l1' } })
  h.buildLeagueStandingsContext.mockResolvedValue('STANDINGS: Casey 5-1')
  h.buildHeadToHeadGrounding.mockResolvedValue({ text: 'H2H: Casey 3-1 vs Jordan', managers: 2, source: 'sleeper' })
})

describe('generateChimmyPrivateReply grounding', () => {
  /*
   * The leagueId argument was named `_leagueId` and never read, so this ran
   * against a model told "never invent league stats" and given no league.
   */
  it('hands the model the league facts it is answering about', async () => {
    await generateChimmyPrivateReply('@chimmy who do I start?', { leagueId: 'l1', userId: 'u1' })

    expect(systemPrompt()).toContain('STANDINGS: Casey 5-1')
    expect(systemPrompt()).toContain('H2H: Casey 3-1 vs Jordan')
  })

  /*
   * A model that does not know it is missing the data is the one that fills the
   * gap in confidently.
   */
  it('says there is no league when there is no league', async () => {
    await generateChimmyPrivateReply('@chimmy hi', {})

    expect(systemPrompt()).toMatch(/not attached to a league/i)
    expect(h.buildLeagueStandingsContext).not.toHaveBeenCalled()
  })

  /* Grounding a league somebody is not in would leak another league's data. */
  it('refuses to ground a league the asker is not a member of', async () => {
    h.loadLeagueGroundingForUser.mockResolvedValue({ ok: false, reason: 'not_member' })

    await generateChimmyPrivateReply('@chimmy standings?', { leagueId: 'l1', userId: 'u1' })

    expect(systemPrompt()).toContain('not_member')
    expect(systemPrompt()).toMatch(/could not read them/i)
    expect(h.buildLeagueStandingsContext).not.toHaveBeenCalled()
  })

  it('treats a thrown access check as no access', async () => {
    h.loadLeagueGroundingForUser.mockRejectedValue(new Error('db down'))

    await generateChimmyPrivateReply('@chimmy standings?', { leagueId: 'l1', userId: 'u1' })

    expect(systemPrompt()).toMatch(/could not be loaded/i)
    expect(h.buildLeagueStandingsContext).not.toHaveBeenCalled()
  })

  it('still answers when only some grounding is available', async () => {
    h.buildHeadToHeadGrounding.mockResolvedValue(null)

    await generateChimmyPrivateReply('@chimmy who do I start?', { leagueId: 'l1', userId: 'u1' })

    expect(systemPrompt()).toContain('STANDINGS: Casey 5-1')
  })

  it('says a real league has nothing stored rather than staying silent', async () => {
    h.buildLeagueStandingsContext.mockResolvedValue(null)
    h.buildHeadToHeadGrounding.mockResolvedValue(null)

    await generateChimmyPrivateReply('@chimmy who do I start?', { leagueId: 'l1', userId: 'u1' })

    expect(systemPrompt()).toMatch(/no standings or matchup history/i)
    expect(systemPrompt()).toMatch(/Do not invent/i)
  })

  it('survives a grounding builder throwing', async () => {
    h.buildLeagueStandingsContext.mockRejectedValue(new Error('boom'))

    const out = await generateChimmyPrivateReply('@chimmy hi', { leagueId: 'l1', userId: 'u1' })

    expect(out).toBe('Start Kelce.')
  })

  it('asks for a question when given only the mention', async () => {
    const out = await generateChimmyPrivateReply('@chimmy', { leagueId: 'l1', userId: 'u1' })

    expect(out).toMatch(/what would you like help with/i)
    expect(h.openaiChatText).not.toHaveBeenCalled()
  })

  it('degrades to a plain message when the model is unreachable', async () => {
    h.openaiChatText.mockResolvedValue({ ok: false, text: '' })

    const out = await generateChimmyPrivateReply('@chimmy hi', { leagueId: 'l1', userId: 'u1' })

    expect(out).toMatch(/trouble reaching the AI/i)
  })
})
