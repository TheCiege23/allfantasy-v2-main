// @vitest-environment node
/**
 * Commissioner draft actions (lib/draft-room/commissionerDraftActions.ts, 2026-11-15):
 *   - a draft Sleeper owns refuses commissioner writes, because Sleeper's sync would silently undo them;
 *   - each commissioner action is written to the league log with the commissioner, and members read it in plain words.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ draftSession: { findFirst: vi.fn() } }))
const audit = vi.hoisted(() => ({ logAction: vi.fn(async () => ({ id: 'a1' })) }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/server/services/auditService', () => audit)

import {
  DRAFT_COMMISSIONER_ACTION,
  SLEEPER_MIRRORED_DRAFT_CODE,
  recordCommissionerDraftAction,
  refuseIfSleeperMirrored,
} from '@/lib/draft-room/commissionerDraftActions'
import { describeLogEntry, rosterIdsNamedBy, type AuditRow } from '@/lib/league-log/leagueLog'

beforeEach(() => vi.clearAllMocks())

describe('a draft mirrored from Sleeper', () => {
  it('refuses the write and says where to make it', async () => {
    db.draftSession.findFirst.mockResolvedValue({ sleeperDraftId: '9981' })
    const refusal = await refuseIfSleeperMirrored('L1')
    expect(refusal?.status).toBe(409)
    expect(refusal?.body.code).toBe(SLEEPER_MIRRORED_DRAFT_CODE)
    expect(refusal?.body.error).toMatch(/Sleeper/)
  })

  it('an AF draft, or no draft at all, is left alone', async () => {
    db.draftSession.findFirst.mockResolvedValue({ sleeperDraftId: null })
    expect(await refuseIfSleeperMirrored('L1')).toBeNull()
    db.draftSession.findFirst.mockResolvedValue(null)
    expect(await refuseIfSleeperMirrored('L1')).toBeNull()
  })
})

describe('recording', () => {
  it('writes one row with the commissioner and the action', async () => {
    await recordCommissionerDraftAction('L1', 'commish', 'set_timer_seconds', { seconds: 60 })
    expect(audit.logAction).toHaveBeenCalledWith(expect.objectContaining({
      leagueId: 'L1',
      userId: 'commish',
      actionType: DRAFT_COMMISSIONER_ACTION,
      metadata: { action: 'set_timer_seconds', seconds: 60 },
    }))
  })

  it('the timer ticks the room fires on its own are not a decision, and are not logged', async () => {
    for (const tick of ['auction_tick', 'slow_tick', 'keeper_tick', '']) await recordCommissionerDraftAction('L1', 'commish', tick)
    expect(audit.logAction).not.toHaveBeenCalled()
  })

  it('a failed log write never fails the action', async () => {
    audit.logAction.mockRejectedValueOnce(new Error('db down'))
    await expect(recordCommissionerDraftAction('L1', 'commish', 'pause')).resolves.toBeUndefined()
  })
})

describe('what the league reads', () => {
  const row = (metadata: Record<string, unknown>): AuditRow => ({
    id: 'r', actionType: DRAFT_COMMISSIONER_ACTION, entityId: 'L1', userId: 'commish', beforeState: null, afterState: null, metadata, createdAt: new Date(),
  })
  const names = { users: { commish: 'Pat' }, teams: { r7: 'Gridiron Gang' } }

  it('names the action, the pick and the team', () => {
    const line = (m: Record<string, unknown>, lang: 'en' | 'es' = 'en') => JSON.stringify(describeLogEntry(row(m), { lang, names, forCommissioner: false }))
    expect(line({ action: 'pause' })).toContain('Paused the draft')
    expect(line({ action: 'set_timer_seconds', seconds: 60 })).toContain('Set the pick clock to 60 seconds')
    expect(line({ action: 'commissioner_pick', overall: 14, rosterId: 'r7' })).toContain('Made pick #14 for Gridiron Gang')
    expect(line({ action: 'pick_edit', overall: 3 }, 'es')).toContain('Cambió la elección #3')
    expect(line({ action: 'something_new' })).toContain('Made a change in the draft room')
    expect(rosterIdsNamedBy([row({ action: 'commissioner_pick', rosterId: 'r7' })])).toContain('r7')
  })
})
