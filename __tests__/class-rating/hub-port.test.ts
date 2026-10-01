// @vitest-environment node
/**
 * The PR #1753 rankings-hub port onto the Class core (owner ruling, 2026-10-01): what the port must
 * keep true that #1753 itself did not.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ManagerClass } from '@/lib/class-rating/reads'

const cls = vi.hoisted(() => ({ value: { status: 'unrated' } as ManagerClass, level: 9 as number | null }))
vi.mock('@/lib/class-rating/reads', () => ({ getManagerClass: vi.fn(async () => cls.value) }))
vi.mock('@/lib/prisma', () => ({
  prisma: { userProfile: { findUnique: vi.fn(async () => (cls.level == null ? null : { xpLevel: cls.level, legacyCareerLevel: null })) } },
}))

import { loadManagerStanding } from '@/lib/chimmy-context/providers/managerStanding'
import { parseScope } from '@/lib/core-app/rankings'

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')

describe('the Class tab replaces #1753\'s Skill tab', () => {
  it('a #1753 `?scope=skill` link still lands on the Class tab', () => {
    expect(parseScope('skill', false)).toBe('class')
    expect(parseScope('class', false)).toBe('class')
  })

  it('🛑 never prints a win probability — ADR F2.10a policy 6 forbids presenting a rating as a game prediction', () => {
    // Comments are stripped: the screen's own note explaining WHY the numbers were removed names them.
    const screen = read('components/core-app/screens/Rankings.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    // Forbid the SHAPE, not one word: any "chance" of winning/beating, and the two #1753 fields that carried it.
    expect(screen).not.toMatch(/win(?:ning)? chance|chance (?:of|to) (?:win|beat)|beats an average manager/i)
    expect(screen).not.toMatch(/vsAverage|\.expected\b/)
    const view = read('lib/class-rating/classView.ts')
    expect(view).not.toMatch(/winProbability|vsAverage/)
  })

  it('🛑 nothing in the port still reaches #1753\'s own rating, ±2 band or XP gate', () => {
    for (const f of [
      'lib/core-app/rankings.ts',
      'components/core-app/screens/Rankings.tsx',
      'lib/chimmy-context/providers/managerStanding.ts',
      'lib/decision-os/trade/tradeReviewContext.ts',
      'lib/core-app/rankingsLeaguePower.ts',
    ]) {
      expect(read(f), f).not.toMatch(/rank\/skillRating|league-join\/managerClass|resolveJoinRankGate|MANAGER_CLASS_BAND/)
    }
  })
})

describe('Chimmy\'s standing speaks in Class divisions, never an XP band', () => {
  it('an established manager gets their division band', async () => {
    cls.value = { status: 'established', rating: 1572, rd: 61, games: 40, classLevel: 17, division: 4, percentile: 0.69, computedAt: '2026-10-01T10:00:00.000Z' }
    const s = await loadManagerStanding('u1')
    expect(s.managerLevel).toBe(9)
    expect(s.classRange).toContain('Division 4 (Class 17) — public leagues match this manager with Divisions 3–5')
    expect(s.skillLines?.[0]).toContain('NFL Class 17 (Division 4), rating 1572 ±61, top 31%')
  })

  it('🛑 the XP level is never turned into a matching band', async () => {
    cls.value = { status: 'unrated' }
    const s = await loadManagerStanding('u1')
    expect(s.managerLevel).toBe(9)
    expect(s.classRange).toBeUndefined()
    cls.value = { status: 'provisional', rating: 1490, rd: 160, games: 3, establishedAtRd: 100, computedAt: '2026-10-01T10:00:00.000Z' }
    const p = await loadManagerStanding('u1')
    expect(p.classRange).toMatch(/^Provisional/)
    expect(JSON.stringify(p)).not.toMatch(/Level \d+–\d+/)
  })
})
