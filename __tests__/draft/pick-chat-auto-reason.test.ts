/**
 * 2026-11-24: draft chat showed a "Chimmy" badge on an automatic pick but never WHY. Every auto-pick
 * records its reason in `pickMetadata.autopick.reason` (queue, Draft like me, best available); it
 * now rides on the chat row and is drawn under the pick.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ createMessage: vi.fn(async () => ({ id: 'msg-1' })) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findFirst: vi.fn(async () => ({ platformUserId: 'manager-7' })) },
    league: { findUnique: vi.fn(async () => ({ userId: 'commish-1' })) },
    appUser: { findMany: vi.fn(async () => [{ id: 'manager-7' }]) },
  },
}))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ createLeagueChatMessage: m.createMessage }))

import { postDraftPickChatEvent } from '@/lib/draft-room/postDraftPickChatEvent'
import { buildDraftChatWireMessage } from '@/lib/draft-room/draft-chat-contract'
import type { PlatformChatMessage } from '@/types/platform-shared'

const REASON = 'Draft like me: you take a guard early. Learned from 24 of your own picks in 2 past drafts.'
const pick = { leagueId: 'L1', rosterId: 'r3', madeByUserId: null, playerName: 'Tyrese Maxey', position: 'PG', rosterDisplayName: 'Team 3', overall: 9, pickLabel: '1.09' }
const metaOf = () => (m.createMessage.mock.calls[0] as unknown as [string, string, string, { metadata: Record<string, unknown> }])[3].metadata

beforeEach(() => vi.clearAllMocks())

describe('the pick chat row carries the reason', () => {
  it('stores it on an automatic pick', async () => {
    await postDraftPickChatEvent({ ...pick, aiManager: true, autoPickReason: `  ${REASON}  ` })
    expect(metaOf()).toMatchObject({ aiManager: true, autoPickReason: REASON })
  })

  it('never on a manager’s own pick', async () => {
    await postDraftPickChatEvent({ ...pick, aiManager: false, autoPickReason: REASON })
    expect(metaOf()).not.toHaveProperty('autoPickReason')
  })
})

function row(meta: Record<string, unknown>): PlatformChatMessage {
  return {
    id: 'msg-1', threadId: 't1', senderUserId: 'u-1', senderName: 'Alex', messageType: 'draft_pick',
    body: 'Tyrese Maxey (PG) → Team 3', createdAt: '2026-11-24T22:00:00.000Z', channelSource: 'draft',
    metadata: { draftPickEvent: true, playerName: 'Tyrese Maxey', position: 'PG', overall: 9, pickLabel: '1.09', ...meta },
  } as unknown as PlatformChatMessage
}
const opts = { syncActive: false, leagueId: 'L1', sanitizePlayerContext: () => null, parsePollPayload: () => null }

describe('the chat wire hands it to the room', () => {
  it('on an automatic pick', () => {
    const wire = buildDraftChatWireMessage(row({ aiManager: true, autoPickReason: REASON }), opts as never)
    expect(wire.draftPickMeta?.autoPickReason).toBe(REASON)
  })

  it('not on a manual pick, whatever the row says', () => {
    const wire = buildDraftChatWireMessage(row({ autoPickReason: REASON }), opts as never)
    expect(wire.draftPickMeta?.autoPickReason).toBeNull()
  })
})

describe('the pick submit and the chat card', () => {
  const root = resolve(__dirname, '..', '..')
  it('submit forwards pickMetadata.autopick.reason to the chat row', () => {
    const src = readFileSync(resolve(root, 'lib/live-draft-engine/PickSubmissionService.ts'), 'utf8')
    expect(src).toMatch(/autoPickReason: autoPickReasonFrom\(input\.pickMetadata\)/)
  })
  it('the chat card draws it under a Chimmy pick', () => {
    const src = readFileSync(resolve(root, 'components/app/draft-room/DraftChatPanel.tsx'), 'utf8')
    expect(src).toMatch(/isAi && meta\?\.autoPickReason/)
    expect(src).toContain('data-testid="draft-chat-pick-auto-reason"')
  })
})
