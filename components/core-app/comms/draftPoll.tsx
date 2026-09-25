'use client'

import type { ViewerPoll } from '@/lib/chat-core/messagePolls'
import { MessagePoll } from './MessagePoll'

/**
 * The draft room's OLDER poll shape, readable and votable wherever it turns up.
 *
 * ⚠ TWO POLL SHAPES SHARE ONE TABLE. The draft room used to post `type: 'poll'` rows as
 * `{ question, options: string[], votes: { [index]: userIds } }` (LeaguePollService), and
 * votes on those go through `/api/leagues/[id]/draft/chat/poll-vote` by INDEX. The shared
 * composer — which the draft room uses now — writes `metadata.poll` with `{ id, text, votes }`
 * options, voted through `/threads/league:<id>/messages/<id>/vote` by ID. `RichMessage` reads
 * only the second, so an older draft poll showed as its bare question with no options at all,
 * in the draft room and in league chat (where sync-on draft polls land) alike.
 *
 * Option ids here are `idx-<n>` so a vote can be turned back into the index the route wants.
 */

export const DRAFT_POLL_OPTION_PREFIX = 'idx-'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function readDraftPoll(
  metadata: unknown,
  messageType: string | null | undefined,
  viewerUserId: string | null | undefined,
): ViewerPoll | null {
  if (messageType !== 'poll' || !isRecord(metadata)) return null
  /* The composer's shape is RichMessage's to draw; this is only the older one. */
  if (isRecord(metadata.poll)) return null
  const question = typeof metadata.question === 'string' ? metadata.question.trim() : ''
  if (!question || !Array.isArray(metadata.options)) return null
  const votes = isRecord(metadata.votes) ? metadata.votes : {}
  let totalVotes = 0
  const options = metadata.options
    .map((raw, i) => {
      const text = String(raw ?? '').trim()
      if (!text) return null
      const ids = Array.isArray(votes[String(i)])
        ? (votes[String(i)] as unknown[]).filter((v): v is string => typeof v === 'string')
        : []
      totalVotes += ids.length
      return {
        id: `${DRAFT_POLL_OPTION_PREFIX}${i}`,
        text,
        count: ids.length,
        mine: Boolean(viewerUserId) && ids.includes(viewerUserId as string),
      }
    })
    .filter((o): o is NonNullable<typeof o> => o !== null)
  if (options.length === 0) return null
  return {
    question,
    options,
    totalVotes,
    closesAt: null,
    closedByHand: metadata.closed === true,
    allowMultiple: false,
    anonymous: false,
  }
}

/** `idx-2` → 2. Null for anything else — never guess an index. */
export function draftPollOptionIndex(optionId: string): number | null {
  if (!optionId.startsWith(DRAFT_POLL_OPTION_PREFIX)) return null
  const n = Number(optionId.slice(DRAFT_POLL_OPTION_PREFIX.length))
  return Number.isInteger(n) && n >= 0 ? n : null
}

export function draftPollVoteUrl(leagueId: string): string {
  return `/api/leagues/${encodeURIComponent(leagueId)}/draft/chat/poll-vote`
}

export function DraftPollView({
  poll,
  onVote,
  disabled,
}: {
  poll: ViewerPoll
  onVote: (optionIndex: number) => void
  disabled?: boolean
}) {
  return (
    <div className="af-cm-rich">
      <MessagePoll
        poll={poll}
        disabled={disabled}
        onVote={(id) => {
          const index = draftPollOptionIndex(id)
          if (index != null) onVote(index)
        }}
      />
    </div>
  )
}
