import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('NFL and NCAAF redraft creation lifecycle contract', () => {
  it.each(['NFL', 'NCAAF'])('%s legacy redraft creation explicitly persists setup', () => {
    const text = source('lib/redraft-creation/create-redraft-league.ts')
    expect(text).toContain("lifecycleState: 'setup'")
  })

  it('canonical creation continues to explicitly persist setup', () => {
    const text = source('lib/league-creation/canonical/createCanonicalLeagueInTransaction.ts')
    expect(text).toContain("lifecycleState: 'setup'")
  })
})