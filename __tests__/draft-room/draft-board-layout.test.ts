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
    // Every render of the strip must sit directly inside an auction-only branch. The earlier
    // form of this test only checked that an auction comparison appeared somewhere above the
    // first `<DraftTeamStrip`, which an unrelated `isAuctionDraft` declaration satisfied while
    // snake rooms rendered the strip AND the board's own team header.
    const renders = [...src.matchAll(/<DraftTeamStrip\b/g)].map((m) => m.index ?? -1)
    expect(renders.length).toBeGreaterThan(0)
    for (const at of renders) {
      const before = src.slice(Math.max(0, at - 400), at)
      expect(before).toMatch(/draftType === 'auction' \? \(\s*<div[^>]*>\s*$/)
    }
  })

  it('DraftBoard team header carries what the strip showed for snake/linear', () => {
    const src = readFileSync(resolve(root, 'components/app/draft-room/DraftBoard.tsx'), 'utf8')
    expect(src).toContain('teamMetaByRoster')
    expect(src).toContain('meta?.avatarUrl')
    expect(src).toContain('draft-board-team-header-orphan-')
  })

  it('DraftBoard retains sticky team header for column alignment', () => {
    const src = readFileSync(resolve(root, 'components/app/draft-room/DraftBoard.tsx'), 'utf8')
    expect(src).toContain('draft-board-team-header')
    expect(src).toContain('sticky')
  })
})
