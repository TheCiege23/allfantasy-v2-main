import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * The draft room's Chimmy (stage 2 of drafts, 2026-11-16) — wiring a unit test of either half would
 * pass with the other half deleted, so the joins are pinned here.
 */

const read = (rel: string) => readFileSync(resolve(__dirname, '..', '..', rel), 'utf8')

describe('the draft room reloads a queue Chimmy saved', () => {
  const room = read('components/app/draft-room/DraftRoomPageClient.tsx')

  it('listens for the queue-changed event, for its own league, and refetches the queue', () => {
    expect(room).toMatch(/window\.addEventListener\(DRAFT_QUEUE_CHANGED_EVENT, handler as EventListener\)/)
    expect(room).toMatch(/detail\?\.leagueId !== leagueId\) return\s+void fetchQueue\(\)/)
    expect(room).toMatch(/window\.removeEventListener\(DRAFT_QUEUE_CHANGED_EVENT/)
  })

  it('renders the cards a draft-room answer prepares', () => {
    expect(read('components/app/draft-room/DraftHelperPanel.tsx')).toMatch(/<ChimmyActionCardTray leagueId=\{leagueId \?\? null\} \/>/)
  })
})

describe('an answer asked from the draft room starts with the board', () => {
  const route = read('app/api/chat/chimmy/route.ts')

  it('reads the board up front for the membership-proven league only', () => {
    expect(route).toMatch(/const draftRoomBoard = insightType === 'draft' && leagueSnapshot && userId\s+\? await buildDraftContext\(leagueSnapshot\.id, userId\)\.catch\(\(\) => null\)/)
  })

  it('hands it to the tool loop with the queue-card rule', () => {
    expect(route).toMatch(/draftRoomBoard\s+\? `THE USER IS ASKING FROM INSIDE THEIR DRAFT ROOM\.[^`]*propose_draft_queue_change[^`]*never say a player was queued or drafted\.\\n\$\{draftRoomBoard\}`/)
  })
})
