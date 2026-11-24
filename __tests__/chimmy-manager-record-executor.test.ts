/**
 * The executor half of a leaguemate's record (2026-11-16): a Competitive Edge refusal goes onto
 * `proToolsRefused`, the list the chat's AF Pro line and upgrade button rest on — and a granted
 * record does not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ build: vi.fn(), killed: [] as string[] }))
vi.mock('@/lib/chimmy/managerRecordGrounding', () => ({ buildManagerRecordContext: h.build }))
vi.mock('@/lib/decision-os/flags', () => ({
  resolveDecisionOsFeedFlags: async () => ({ enabled: (f: string) => !h.killed.includes(f), killed: h.killed }),
}))

beforeEach(() => {
  h.build.mockReset()
  h.killed = []
})

import { executeChimmyTool, type ChimmyToolContext } from '@/lib/chimmy/tools/chimmyTools'

const ctx = (): ChimmyToolContext => ({ leagueId: 'L1', userId: 'u1', depth: 'free', proToolsRefused: [] } as ChimmyToolContext)

describe('get_manager_record in the executor', () => {
  it('a locked record is a refusal the upgrade button rests on — once, however often it is asked', async () => {
    h.build.mockResolvedValue({ text: 'NOT RUN: …', locked: true })
    const c = ctx()
    expect(await executeChimmyTool('get_manager_record', { manager: 'Mike' }, c)).toBe('NOT RUN: …')
    await executeChimmyTool('get_manager_record', {}, c)
    expect(c.proToolsRefused).toEqual(['get_manager_record'])
    expect(h.build).toHaveBeenLastCalledWith({ leagueId: 'L1', userId: 'u1', manager: null })
  })

  it('a granted record adds no button, and a free CHIMMY plan alone does not refuse it', async () => {
    h.build.mockResolvedValue({ text: 'MANAGER RECORD (facts only) …', locked: false })
    const c = ctx()
    expect(await executeChimmyTool('get_manager_record', { manager: 'Mike' }, c)).toContain('MANAGER RECORD')
    expect(c.proToolsRefused).toEqual([])
  })

  /*
   * 2026-11-24 re-score: the packet's `managerRecords` kill switch now turns the tool off too, as `get_league_health`
   * honours `commissionerHealthDecision`. Killed: nothing is read, and the model is told not to describe anyone.
   */
  it('honours the managerRecords kill switch — nothing is read, and no upgrade button is added', async () => {
    h.killed = ['managerRecords']
    h.build.mockResolvedValue({ text: 'MANAGER RECORD (facts only) …', locked: false })
    const c = ctx()
    const out = await executeChimmyTool('get_manager_record', { manager: 'Mike' }, c)
    expect(out).toContain('switched off')
    expect(out).toContain("do not describe any manager's")
    expect(h.build).not.toHaveBeenCalled()
    expect(c.proToolsRefused).toEqual([])
  })

  it('another feed killed does not turn it off', async () => {
    h.killed = ['commissionerHealthDecision']
    h.build.mockResolvedValue({ text: 'MANAGER RECORD (facts only) …', locked: false })
    expect(await executeChimmyTool('get_manager_record', { manager: 'Mike' }, ctx())).toContain('MANAGER RECORD')
  })
})
