import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

describe('Slice 2 — read consistency: Slice 1 flags flow through service + state route', () => {
  it('DraftSessionSnapshot type carries the 3 new flags', () => {
    const src = read('lib/live-draft-engine/types.ts')
    expect(src).toMatch(/onClockTradeTimerBehavior: 'inherit_remaining' \| 'reset_timer'/)
    expect(src).toMatch(/inDraftPlayerTradesEnabled: boolean/)
    expect(src).toMatch(/customRankingsEnabled: boolean/)
  })

  it('buildSessionSnapshot returns the 3 new flags', () => {
    const src = read('lib/live-draft-engine/DraftSessionService.ts')
    expect(src).toMatch(/onClockTradeTimerBehavior:[\s\S]+?'reset_timer'[\s\S]+?'inherit_remaining'/)
    expect(src).toMatch(/inDraftPlayerTradesEnabled:[\s\S]+?inDraftPlayerTradesEnabled !== false/)
    expect(src).toMatch(/customRankingsEnabled:[\s\S]+?customRankingsEnabled !== false/)
  })

  it('Legacy /api/draft/room/state route exposes the new flags in state shape', () => {
    const src = read('app/api/draft/room/state/route.ts')
    expect(src).toMatch(/thirdRoundReversal: snapshot\.thirdRoundReversal/)
    expect(src).toMatch(/onClockTradeTimerBehavior: snapshot\.onClockTradeTimerBehavior/)
    expect(src).toMatch(/inDraftPlayerTradesEnabled: snapshot\.inDraftPlayerTradesEnabled/)
    expect(src).toMatch(/customRankingsEnabled: snapshot\.customRankingsEnabled/)
  })
})

describe('Slice 2 — 3RR header badge', () => {
  it('DraftTopBar accepts thirdRoundReversal prop', () => {
    const src = read('components/app/draft-room/DraftTopBar.tsx')
    expect(src).toMatch(/thirdRoundReversal\?: boolean/)
    expect(src).toMatch(/thirdRoundReversal = false/)
  })

  it('DraftTopBar renders 3RR badge with stable testid only when enabled', () => {
    const src = read('components/app/draft-room/DraftTopBar.tsx')
    expect(src).toMatch(/data-testid="draft-topbar-third-round-reversal-badge"/)
    expect(src).toMatch(/thirdRoundReversal \? \(/)
    expect(src).toMatch(/3RR On/)
  })

  it('DraftRoomPageClient passes thirdRoundReversal from session into DraftTopBar', () => {
    const src = read('components/app/draft-room/DraftRoomPageClient.tsx')
    expect(src).toMatch(/thirdRoundReversal=\{Boolean\(session\.thirdRoundReversal\)\}/)
  })
})
