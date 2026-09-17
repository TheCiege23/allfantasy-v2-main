import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Who reads `trade_block_entries` directly (2026-09-17).
 *
 * A listing counts only while the team that listed the player still holds him; `readTradeBlock` in
 * `lib/trade-block/importedTradeBlock.ts` applies that. A direct read of the active rows does not, so a
 * traded player stays "on the block" — invisible while the table was empty, real once managers could
 * list players (#1001). Every direct reader is named here with the reason it is safe; a new one fails
 * this test until it is reviewed.
 */
const ALLOWED: Record<string, string> = {
  'lib/trade-block/importedTradeBlock.ts': 'the reader and the writer',
  'lib/core-app/playerCard.ts': 'one findUnique, then currentListings over the rosters it already loaded',
  'lib/trade-engine/otb-persistence.ts': 'keyed rosterId:playerId, so a moved player never matches',
}

const ROOTS = ['lib', 'app', 'components', 'server']
const SKIP = new Set(['node_modules', '.next', '__tests__'])

function walk(dir: string, out: string[]) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.next')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
}

function readers(): string[] {
  const files: string[] = []
  for (const root of ROOTS) walk(path.join(process.cwd(), root), files)
  return files
    .filter((f) => /\.tradeBlockEntry\b/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(process.cwd(), f).split(path.sep).join('/'))
    .sort()
}

describe('trade_block_entries readers', () => {
  it('only the reviewed modules touch the table directly', () => {
    expect(readers()).toEqual(Object.keys(ALLOWED).sort())
  })

  it('the Trades panel and the old league home apply the staleness rule', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'app/api/league/trades-panel/route.ts'), 'utf8')
    const home = fs.readFileSync(path.join(process.cwd(), 'lib/data/league-home.ts'), 'utf8')
    expect(route).toMatch(/await readTradeBlock\(league\.id\)/)
    // The league home already holds the rosters and teams, so it filters the rows itself.
    expect(home).toMatch(/await activeTradeBlockEntries\(sleeperLeagueId\)/)
    expect(home).toMatch(/currentListings\(blockEntries, context\.allRosters, context\.leagueTeams\)/)
  })

  it('the scan sees a known reader (control)', () => {
    expect(readers()).toContain('lib/trade-engine/otb-persistence.ts')
  })
})
