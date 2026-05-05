/**
 * Launch-gate style checks for draft board chrome — avoids brittle RTL coupling.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')

describe('draft board layout — snake/linear single header row', () => {
  it('DraftRoomPageClient: DraftTeamStrip only for auction (avoids duplicate manager strip)', () => {
    const src = readFileSync(
      resolve(root, 'components/app/draft-room/DraftRoomPageClient.tsx'),
      'utf8',
    )
    expect(src).toContain("session?.draftType === 'auction'")
    expect(src).toContain('<DraftTeamStrip')
    const auctionGate = src.indexOf("session?.draftType === 'auction'")
    const strip = src.indexOf('<DraftTeamStrip')
    expect(auctionGate).toBeGreaterThan(-1)
    expect(strip).toBeGreaterThan(auctionGate)
  })

  it('DraftBoard retains sticky team header for column alignment', () => {
    const src = readFileSync(resolve(root, 'components/app/draft-room/DraftBoard.tsx'), 'utf8')
    expect(src).toContain('draft-board-team-header')
    expect(src).toContain('sticky')
  })
})
