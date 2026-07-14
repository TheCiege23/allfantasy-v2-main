import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.join(process.cwd(), 'lib/schedule-runtime/resolveNflRedraftScheduleRuntime.ts'), 'utf8')

// Found via direct call-graph audit (Gate C completion phase, 2026-07-12), not
// yet physically reproduced under real concurrent load: advanceNflRedraftScheduleWeek
// read the season's currentWeek/status, computed a transition, then wrote it back
// with a bare `prisma.redraftSeason.update({ where: { id } })` — no guard on the
// prior state the transition was computed from. Two concurrent invocations could
// both read the same starting state and the second write would silently clobber
// the first's intended effect. This mirrors the exact class of defect physically
// reproduced and fixed in the FAAB settlement path this same phase
// (see faab-settlement-atomic-update-contract.test.ts), applied here as a
// direct-evidence-based fix per the phase's acceptable-evidence list.
describe('week advancement mutation is guarded against concurrent overwrite', () => {
  const fn = source.slice(source.indexOf('export async function advanceNflRedraftScheduleWeek'))

  it('does not use a bare update keyed only on id', () => {
    expect(fn).not.toContain('await prisma.redraftSeason.update({\n    where: { id: input.seasonId },')
  })

  it('uses a conditional updateMany guarded on the exact prior state the transition was computed from', () => {
    expect(fn).toContain('prisma.redraftSeason.updateMany')
    expect(fn).toMatch(/where:\s*\{\s*id:\s*input\.seasonId,\s*currentWeek:\s*resolved\.state\.currentWeek,\s*status:\s*resolved\.state\.status\s*\}/)
  })

  it('returns a truthful conflict result when the guarded update affects zero rows', () => {
    expect(fn).toContain('if (claimed.count === 0)')
    expect(fn).toContain("code: 'CONCURRENT_MODIFICATION'")
  })
})
