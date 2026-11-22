/**
 * The executor half of a leaguemate's record (2026-11-16): a Competitive Edge refusal goes onto
 * `proToolsRefused`, the list the chat's AF Pro line and upgrade button rest on — and a granted
 * record does not.
 */
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ build: vi.fn() }))
vi.mock('@/lib/chimmy/managerRecordGrounding', () => ({ buildManagerRecordContext: h.build }))

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
})
