/**
 * An imported salary cap league with no contracts on file says so (lib/salary-cap/importedContractsNote.ts).
 * All 12 salary cap leagues in production are Sleeper imports with zero contracts, and their cap
 * screens showed the full default cap as if it were the league's.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { importedCapContractsNote } from '@/lib/salary-cap/importedContractsNote'

describe('importedCapContractsNote', () => {
  it('an imported league with no contracts gets the note, naming the platform', () => {
    expect(importedCapContractsNote('sleeper', 0)).toBe(
      'This league’s contracts are not in AllFantasy. It was imported from Sleeper, which does not carry salaries or contract years, so the cap space, contracts and team builder here show an empty cap, not your league’s real one.',
    )
    expect(importedCapContractsNote('some-new-site', 0)).toContain('imported from the platform it was imported from')
  })

  it('a league AllFantasy hosts never gets it: an empty cap there is real', () => {
    expect(importedCapContractsNote('manual', 0)).toBeNull()
  })

  it('an imported league with any contract on file does not get it', () => {
    expect(importedCapContractsNote('sleeper', 1)).toBeNull()
  })
})

describe('the summary route sends it and the cap home shows it above every view', () => {
  const route = readFileSync(join(process.cwd(), 'app/api/leagues/[leagueId]/salary-cap/summary/route.ts'), 'utf8')
  const home = readFileSync(join(process.cwd(), 'components/salary-cap/SalaryCapHome.tsx'), 'utf8')
  it('counts contracts league-wide, not for the viewer alone', () => {
    expect(route).toMatch(/^\s*const contractsOnFile = await prisma\.playerContract\.count\(\{ where: \{ configId: config\.configId \} \}\)/m)
    expect(route).toMatch(/^\s*contractsNote: importedCapContractsNote\(leagueRow\?\.platform, contractsOnFile\),$/m)
  })
  it('the note renders before the views', () => {
    expect(home.indexOf('data-testid="salary-cap-imported-note"')).toBeGreaterThan(0)
    expect(home.indexOf('data-testid="salary-cap-imported-note"')).toBeLessThan(home.indexOf("view === 'home' && summary && ("))
  })
})
