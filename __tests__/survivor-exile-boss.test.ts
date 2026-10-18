import { describe, expect, it } from 'vitest'
import { buildExileBoard, canViewExileBoard, computeExileBossScore, settleExileBossWeek } from '@/lib/survivor/exileBoss'
import { readSurvivorLateSeasonSettings, validateSurvivorLateSeasonPatch } from '@/lib/survivor/lateSeasonSettings'

describe('computeExileBossScore', () => {
  it('median of active scores (odd and even counts)', () => {
    expect(computeExileBossScore({ mode: 'median' }, [130, 90, 110])).toBe(110)
    expect(computeExileBossScore({ mode: 'median' }, [90, 100, 110, 130])).toBe(105)
  })
  it('top-N average, clamped to the number of scores', () => {
    expect(computeExileBossScore({ mode: 'topN', topN: 2 }, [90, 100, 110, 130])).toBe(120)
    expect(computeExileBossScore({ mode: 'topN', topN: 10 }, [100, 110])).toBe(105)
  })
  it('fixed ignores scores; unknown when there is nothing to compute from', () => {
    expect(computeExileBossScore({ mode: 'fixed', fixedScore: 118.4 }, [])).toBe(118.4)
    expect(computeExileBossScore({ mode: 'fixed', fixedScore: null }, [1, 2])).toBeNull()
    expect(computeExileBossScore({ mode: 'median' }, [])).toBeNull()
  })
})

describe('settleExileBossWeek', () => {
  const tieKey = (id: string) => id
  it('wipes everyone below, keeps everyone at/above safe, one winner above', () => {
    const out = settleExileBossWeek({ boss: 118.4, wipeOnLoss: true, tieKey, rows: [
      { userId: 'tc', displayName: 'TC', score: 131.2, tokens: 2 },
      { userId: 'o11', displayName: 'O11', score: 122.9, tokens: 1 },
      { userId: 'o3', displayName: 'O3', score: 97, tokens: 2 },
    ] })
    expect(out.winnerUserId).toBe('tc')
    expect(out.rows).toEqual([
      { userId: 'tc', finalStatus: 'won_week', tokensAfter: 3, wipedTokens: 0, earnedToken: true },
      { userId: 'o11', finalStatus: 'safe', tokensAfter: 1, wipedTokens: 0, earnedToken: false },
      { userId: 'o3', finalStatus: 'wiped', tokensAfter: 0, wipedTokens: 2, earnedToken: false },
    ])
  })
  it('respects shields, the wipe toggle and the token cap', () => {
    const out = settleExileBossWeek({ boss: 100, wipeOnLoss: true, tokenCap: 3, tieKey, rows: [
      { userId: 'a', displayName: 'A', score: 150, tokens: 3 },
      { userId: 'b', displayName: 'B', score: 50, tokens: 2, shielded: true },
    ] })
    expect(out.rows[0]).toMatchObject({ finalStatus: 'won_week', earnedToken: false, tokensAfter: 3 })
    expect(out.rows[1]).toMatchObject({ finalStatus: 'wiped', wipedTokens: 0, tokensAfter: 2 })
    const noWipe = settleExileBossWeek({ boss: 100, wipeOnLoss: false, tieKey, rows: [{ userId: 'b', displayName: 'B', score: 50, tokens: 2 }] })
    expect(noWipe.rows[0]).toMatchObject({ wipedTokens: 0, tokensAfter: 2 })
  })
  it('nobody wins when nobody is strictly above', () => {
    expect(settleExileBossWeek({ boss: 100, wipeOnLoss: true, tieKey, rows: [{ userId: 'a', displayName: 'A', score: 100, tokens: 1 }] }).winnerUserId).toBeNull()
  })
})

describe('buildExileBoard', () => {
  it('ranks, computes margins and live chips; no final statuses while live', () => {
    const rows = buildExileBoard({ boss: 96.3, final: false, rows: [
      { userId: 'b', displayName: 'Open Team 11', score: 88.1, projected: 123, tokens: 1 },
      { userId: 'a', displayName: 'TheCiege26', score: 104.6, projected: 131, tokens: 2 },
    ] })
    expect(rows.map((r) => [r.rank, r.userId, r.margin, r.liveStatus, r.finalStatus])).toEqual([
      [1, 'a', 8.3, 'ahead', null],
      [2, 'b', -8.2, 'behind', null],
    ])
  })
  it('final rows carry outcome and wiped coins; ties share a rank', () => {
    const rows = buildExileBoard({ boss: 100, final: true, rows: [
      { userId: 'a', displayName: 'A', score: 90, tokens: 0, finalStatus: 'wiped', wipedTokens: 2 },
      { userId: 'b', displayName: 'B', score: 90, tokens: 1, finalStatus: 'wiped', wipedTokens: 0 },
    ] })
    expect(rows.map((r) => r.rank)).toEqual([1, 1])
    expect(rows[0]).toMatchObject({ finalStatus: 'wiped', wipedTokens: 2, liveStatus: null })
  })
})

describe('late-season settings', () => {
  it('defaults: 3 finalists, commissioner naming, median boss', () => {
    expect(readSurvivorLateSeasonSettings(null)).toMatchObject({ finalistCount: 3, mergeNamingMode: 'commissioner', exileBossMode: 'median' })
  })
  it('reads finalistCount from settings, plan or the legacy final-3 column', () => {
    expect(readSurvivorLateSeasonSettings({ finalistCount: 2 }).finalistCount).toBe(2)
    expect(readSurvivorLateSeasonSettings({ survivorFoundationSettings: { finalistCount: 2 } }).finalistCount).toBe(2)
    expect(readSurvivorLateSeasonSettings({}, { survivorFinal3: false }).finalistCount).toBe(2)
    expect(readSurvivorLateSeasonSettings({ finalistCount: 7 }).finalistCount).toBe(3)
  })
  it('a fixed boss with no number falls back to the median', () => {
    expect(readSurvivorLateSeasonSettings({ exileBossMode: 'fixed' }).exileBossMode).toBe('median')
    expect(readSurvivorLateSeasonSettings({ exileBossMode: 'fixed', exileBossFixedScore: '110.5' })).toMatchObject({ exileBossMode: 'fixed', exileBossFixedScore: 110.5 })
  })
  it('validates commissioner patches', () => {
    expect(validateSurvivorLateSeasonPatch({ finalistCount: 4 }).ok).toBe(false)
    expect(validateSurvivorLateSeasonPatch({ exileBossMode: 'fixed' }).ok).toBe(false)
    expect(validateSurvivorLateSeasonPatch({ exileBossMode: 'topN', exileBossTopN: 3 })).toEqual({ ok: true, patch: { exileBossMode: 'topN', exileBossTopN: 3 } })
  })
})

describe('canViewExileBoard (token math stays on Exile)', () => {
  it('exiles and a non-playing commissioner only', () => {
    expect(canViewExileBoard({ playerState: 'exile', isCommissioner: false, fairPlayLimited: false, isPlayer: true })).toBe(true)
    expect(canViewExileBoard({ playerState: 'active', isCommissioner: false, fairPlayLimited: false, isPlayer: true })).toBe(false)
    expect(canViewExileBoard({ playerState: 'jury', isCommissioner: false, fairPlayLimited: false, isPlayer: true })).toBe(false)
    expect(canViewExileBoard({ playerState: null, isCommissioner: true, fairPlayLimited: false, isPlayer: false })).toBe(true)
    expect(canViewExileBoard({ playerState: 'active', isCommissioner: true, fairPlayLimited: true, isPlayer: true })).toBe(false)
  })
})
