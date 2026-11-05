/**
 * Two fixes from the live check of 2026-11-05:
 * - On a phone, My team's "Fix Lineup in …" link must take its own row. A later, unscoped rule capped
 *   it at 260px; a capped flex item fits beside the team name, which then wrapped one letter per line.
 * - The Waivers adds chip reads "+1 add", not "+1 adds".
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { waiverLineupBoardMessages } from '@/lib/core-app/messages/waiverLineupBoard'

const CSS = readFileSync(join(process.cwd(), 'components/core-app/af-my-team.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('My team header on a phone', () => {
  it('uncaps the source link in the narrow container query, after the 260px cap', () => {
    const cap = CSS.lastIndexOf('max-width:min(260px,100%)')
    expect(cap).toBeGreaterThan(-1)
    const after = CSS.slice(cap)
    const blocks: string[] = []
    for (let at = after.indexOf('@container af-mt (max-width: 500px)'); at > -1; at = after.indexOf('@container af-mt (max-width: 500px)', at + 1)) {
      blocks.push(after.slice(at, after.indexOf('\n}', at)))
    }
    expect(blocks.length).toBeGreaterThan(0)
    expect(blocks.some((b) => /\.af-core \.af-mt-source\s*\{[^}]*flex:\s*1 1 100%[^}]*max-width:\s*none/.test(b))).toBe(true)
  })
})

describe('Waivers adds chip', () => {
  it('is singular for one league and plural otherwise, in both languages', () => {
    expect(waiverLineupBoardMessages.en.addedChip(1)).toBe('+1 add')
    expect(waiverLineupBoardMessages.en.addedChip(3)).toBe('+3 adds')
    expect(waiverLineupBoardMessages.es.addedChip(1)).toBe('+1 alta')
    expect(waiverLineupBoardMessages.es.addedChip(3)).toBe('+3 altas')
  })
})
