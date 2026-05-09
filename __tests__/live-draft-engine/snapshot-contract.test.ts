/**
 * Snapshot contract regression guard (no Prisma, no DB).
 * Verifies DraftSessionSnapshot includes the Phase 1 viewer-context fields.
 */

import { describe, expect, it } from 'vitest'
import type { DraftSessionSnapshot } from '@/lib/live-draft-engine/types'

const BASE: DraftSessionSnapshot = {
  id: 'sess-1',
  leagueId: 'league-1',
  status: 'in_progress',
  draftType: 'snake',
  rounds: 15,
  teamCount: 12,
  thirdRoundReversal: true,
  onClockTradeTimerBehavior: 'inherit_remaining',
  inDraftPlayerTradesEnabled: false,
  customRankingsEnabled: false,
  timerSeconds: 90,
  timerEndAt: null,
  pausedRemainingSeconds: null,
  slotOrder: [],
  tradedPicks: [],
  version: 1,
  picks: [],
  currentPick: null,
  timer: { status: 'running', remainingSeconds: 90, timerEndAt: null },
  updatedAt: '2025-01-01T00:00:00.000Z',
  pausedByUserId: null,
  allowPicksDuringOvernightPause: false,
  viewerAutopick: null,
}

describe('DraftSessionSnapshot contract — Phase 1 fields', () => {
  it('includes pausedByUserId (null default)', () => {
    expect('pausedByUserId' in BASE).toBe(true)
    expect(BASE.pausedByUserId).toBeNull()
  })

  it('pausedByUserId holds the commissioner user id when set', () => {
    const s: DraftSessionSnapshot = { ...BASE, status: 'paused', pausedByUserId: 'user-xyz' }
    expect(s.pausedByUserId).toBe('user-xyz')
  })

  it('includes allowPicksDuringOvernightPause (false default)', () => {
    expect('allowPicksDuringOvernightPause' in BASE).toBe(true)
    expect(BASE.allowPicksDuringOvernightPause).toBe(false)
  })

  it('allowPicksDuringOvernightPause can be set true', () => {
    const s: DraftSessionSnapshot = { ...BASE, allowPicksDuringOvernightPause: true }
    expect(s.allowPicksDuringOvernightPause).toBe(true)
  })

  it('includes viewerAutopick (null until Commit 5)', () => {
    expect('viewerAutopick' in BASE).toBe(true)
    expect(BASE.viewerAutopick).toBeNull()
  })

  it('viewerAutopick accepts full Pro preference shape', () => {
    const s: DraftSessionSnapshot = {
      ...BASE,
      viewerAutopick: {
        enabled: true,
        mode: 'ai_queue',
        isProEligible: true,
        updatedAt: '2026-05-09T01:23:45.000Z',
      },
    }
    expect(s.viewerAutopick?.enabled).toBe(true)
    expect(s.viewerAutopick?.mode).toBe('ai_queue')
    expect(s.viewerAutopick?.isProEligible).toBe(true)
    expect(s.viewerAutopick?.updatedAt).toBe('2026-05-09T01:23:45.000Z')
  })

  it('viewerAutopick accepts standard mode', () => {
    const s: DraftSessionSnapshot = {
      ...BASE,
      viewerAutopick: { enabled: true, mode: 'standard', isProEligible: false, updatedAt: null },
    }
    expect(s.viewerAutopick?.mode).toBe('standard')
    expect(s.viewerAutopick?.isProEligible).toBe(false)
    expect(s.viewerAutopick?.updatedAt).toBeNull()
  })

  it('viewerAutopick.updatedAt is null when no row has been written', () => {
    const s: DraftSessionSnapshot = {
      ...BASE,
      viewerAutopick: { enabled: false, mode: 'standard', isProEligible: false, updatedAt: null },
    }
    expect(s.viewerAutopick?.updatedAt).toBeNull()
  })
})
