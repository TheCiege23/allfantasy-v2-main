import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Survivor Challenges (2026-11-24, the simplify pass): the history is one tap away, not open on every visit.
 * Read from source with comments stripped, so a check cannot match the comment explaining the change.
 */
const read = (f: string) =>
  readFileSync(join(process.cwd(), f), 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('Survivor Challenges screen', () => {
  it('past challenges are one closed row with the count', () => {
    const src = read('app/survivor/[leagueId]/challenges/page.tsx')
    expect(src).toMatch(/<details className="mt-8" data-testid="survivor-past-challenges">\s*<summary className="[^"]*min-h-\[44px\][^"]*">\s*Past challenges\{past && past\.length \? ` \(\$\{Math\.min\(past\.length, 12\)\}\)` : ''\}/)
    expect(src).not.toMatch(/<section className="mt-8">\s*<h2 className="sv-kicker mb-3 text-\[12px\]">\s*Past challenges/)
  })

  it('the weekly call\'s season leaderboard is a closed row', () => {
    const src = read('app/survivor/components/WeeklyCallCard.tsx')
    expect(src).toMatch(/<details className="[^"]*" data-testid="weekly-call-leaderboard">\s*<summary className="[^"]*min-h-\[44px\][^"]*">Season leaderboard \(/)
  })
})
