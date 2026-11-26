// @vitest-environment node
/**
 * GUARD: no `SportsPlayer` read keyed by a Sleeper id may run without a `sport`.
 *
 * Sleeper numbers each sport's players separately — NFL 1466 Travis Kelce / NBA 1466 JaVale
 * McGee — and `SportsPlayer.sleeperId` is indexed, not unique. #4298 fixed two reads that labelled
 * every NFL market book's Kelce "JaVale McGee / C"; this keeps a third from appearing. The scanner
 * is `scripts/check-sleeper-id-sport-scope.mjs`; its ALLOWLIST carries a reason per entry.
 *
 * Every detector case below is checked in BOTH directions — the planted violation fires and its
 * scoped twin does not — because a guard that has never gone red is not evidence.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
// A plain .mjs module (the same file `node scripts/check-sleeper-id-sport-scope.mjs` runs).
import { scanRepo, scanSource, applyAllowlist, ALLOWLIST } from '../../scripts/check-sleeper-id-sport-scope.mjs'

type Finding = { file: string; line: number; method: string; status: string }
const ROOT = path.resolve(__dirname, '../..')
const flagged = (src: string): Finding[] => scanSource(src, 'planted.ts')

describe('sleeperId sport-scope guard — the repo', () => {
  it('has no unallowlisted SportsPlayer read keyed by sleeperId without a sport', () => {
    const { violations } = applyAllowlist(scanRepo(ROOT))
    expect(violations.map((v: Finding) => `${v.status} ${v.file}:${v.line}`)).toEqual([])
  })

  it('carries no stale allowlist entry (a fixed site must leave the list in the same commit)', () => {
    expect(applyAllowlist(scanRepo(ROOT)).stale).toEqual([])
  })

  it('justifies every allowlist entry', () => {
    for (const [file, entry] of Object.entries(ALLOWLIST as Record<string, { count: number; reason: string }>)) {
      expect(entry.reason?.length ?? 0, file).toBeGreaterThan(20)
      expect(entry.count, file).toBeGreaterThan(0)
    }
  })

  it('POSITIVE CONTROL: un-fixing #4298 in formatMarkets.ts is caught', () => {
    const real = readFileSync(path.join(ROOT, 'lib/trade-market/formatMarkets.ts'), 'utf8')
    expect(real).toContain("where: { sport: 'NFL', sleeperId: { in: part } }")
    expect(scanSource(real, 'lib/trade-market/formatMarkets.ts')).toEqual([])
    const reverted = real.replace("where: { sport: 'NFL', sleeperId: { in: part } }", 'where: { sleeperId: { in: part } }')
    expect(reverted).not.toBe(real)
    expect(scanSource(reverted, 'lib/trade-market/formatMarkets.ts')).toHaveLength(1)
  })

  it('an allowlisted file still fails on a SECOND unscoped read', () => {
    const one = { file: 'a.ts', line: 1, method: 'findMany', status: 'unscoped' }
    const two = { ...one, line: 9 }
    const list = { 'a.ts': { count: 1, reason: 'x'.repeat(30) } }
    expect(applyAllowlist([one], list).violations).toHaveLength(0)
    expect(applyAllowlist([one, two], list).violations).toHaveLength(1)
  })
})

describe('sleeperId sport-scope guard — the detector', () => {
  it('fires on the #4298 shape and not on its scoped twin', () => {
    expect(flagged('await prisma.sportsPlayer.findMany({ where: { sleeperId: { in: ids } }, select: { name: true } })')).toHaveLength(1)
    expect(flagged("await prisma.sportsPlayer.findMany({ where: { sport: 'NFL', sleeperId: { in: ids } } })")).toHaveLength(0)
    expect(flagged('await prisma.sportsPlayer.findMany({ where: { sport, sleeperId: { in: ids } } })')).toHaveLength(0)
  })

  it('fires across a line break, on findFirst / findUnique / count, and through `?.`', () => {
    expect(flagged('await prisma.sportsPlayer\n  .findMany({ where: { sleeperId: { in: ids } } })')).toHaveLength(1)
    expect(flagged('await db.sportsPlayer.findFirst({ where: { sleeperId: id } })')).toHaveLength(1)
    expect(flagged('await tx.sportsPlayer.count({ where: { sleeperId } })')).toHaveLength(1)
    expect(flagged('await (prisma as any).sportsPlayer?.findMany?.({ where: { sleeperId: { in: ids } } })')).toHaveLength(1)
  })

  it('reads only the where clause: a selected sleeperId or a comment is not a filter', () => {
    expect(flagged("await prisma.sportsPlayer.findMany({ where: { sport: 'NBA' }, select: { sleeperId: true } })")).toHaveLength(0)
    expect(flagged("// prisma.sportsPlayer.findMany({ where: { sleeperId: { in: ids } } })\nconst x = 1")).toHaveLength(0)
    expect(flagged("const s = 'prisma.sportsPlayer.findMany({ where: { sleeperId: 1 } })'")).toHaveLength(0)
  })

  it('a sport inside a string is not a sport filter', () => {
    expect(flagged("await prisma.sportsPlayer.findMany({ where: { sleeperId: { in: ids }, name: 'sport: x' } })")).toHaveLength(1)
  })

  it('resolves a where held in a variable', () => {
    expect(flagged('const where = { sleeperId: { in: ids } }\nawait prisma.sportsPlayer.findMany({ where })')).toHaveLength(1)
    expect(flagged("const where = { sport: 'NFL', sleeperId: { in: ids } }\nawait prisma.sportsPlayer.findMany({ where })")).toHaveLength(0)
    expect(flagged('const w = { sleeperId: { in: ids } }\nawait prisma.sportsPlayer.findMany({ where: w, take: 5 })')).toHaveLength(1)
  })

  it('resolves a spread scope one level', () => {
    expect(flagged("const scope = league.sport ? { sport: league.sport } : {}\nawait prisma.sportsPlayer.findMany({ where: { ...scope, sleeperId } })")).toHaveLength(0)
    expect(flagged('const scope = { team: t }\nawait prisma.sportsPlayer.findMany({ where: { ...scope, sleeperId } })')).toHaveLength(1)
  })

  it('treats the Sleeper-id helpers as sleeperId filters, scoped only with a real sport argument', () => {
    expect(flagged('await prisma.sportsPlayer.findMany({ where: sleeperIdWhere(ids) })')).toHaveLength(1)
    expect(flagged('await prisma.sportsPlayer.findMany({ where: sleeperIdWhere(ids, sport ?? undefined) })')).toHaveLength(1)
    expect(flagged('await prisma.sportsPlayer.findMany({ where: ourIdOrSleeperIdWhere(ids) })')).toHaveLength(1)
    expect(flagged('await prisma.sportsPlayer.findMany({ where: { age: { not: null }, AND: [ourIdOrSleeperIdWhere(ids)] } })')).toHaveLength(1)
    expect(flagged('await prisma.sportsPlayer.findMany({ where: sleeperIdWhere(ids, sport) })')).toHaveLength(0)
    expect(flagged("await prisma.sportsPlayer.findMany({ where: ourIdOrSleeperIdWhere(ids, 'NFL') })")).toHaveLength(0)
    expect(flagged('await prisma.sportsPlayer.findMany({ where: sleeperIdsBySportWhere(entries) })')).toHaveLength(0)
  })

  it('reads a ternary where as its branches', () => {
    expect(flagged('await prisma.sportsPlayer.findMany({ where: c ? { sport, sleeperId: { in: a } } : { sport, sleeperId: { in: b } } })')).toHaveLength(0)
    expect(flagged('await prisma.sportsPlayer.findMany({ where: c ? { sleeperId: { in: a } } : { id: { in: b } } })')).toHaveLength(1)
  })

  it('ignores reads that never touch sleeperId, and writes keyed by the unique key', () => {
    expect(flagged("await prisma.sportsPlayer.findMany({ where: { externalId: { in: ids }, source: 'rolling_insights' } })")).toHaveLength(0)
    expect(flagged('await prisma.sportsPlayer.upsert({ where: { sport_externalId_source: k }, create: c, update: u })')).toHaveLength(0)
  })

  it('fires on an unscoped updateMany keyed by sleeperId — it would write the other sport\'s row', () => {
    expect(flagged('await prisma.sportsPlayer.updateMany({ where: { sleeperId: id }, data: { team } })')).toHaveLength(1)
  })
})
