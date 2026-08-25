'use client'

import { pollShare, type ViewerPoll } from '@/lib/chat-core/messagePolls'

/**
 * A votable poll in league chat.
 *
 * ⚠ THE BAR IS A SHARE OF VOTES CAST, AND THERE IS NO BAR BEFORE ANY ARE. The
 * read-only version of this could only show a raw count, because it had no
 * denominator to draw a proportion against. Summing the options gives one — but
 * only once somebody has voted. Equal bars across an unvoted poll would render a
 * tie nobody cast.
 */
export function MessagePoll({
  poll,
  onVote,
  disabled,
}: {
  poll: ViewerPoll
  onVote: (optionId: string) => void
  disabled?: boolean
}) {
  return (
    <div className="af-cm-poll">
      <p className="af-cm-poll-q">{poll.question}</p>

      {poll.options.map((o) => {
        const share = pollShare(o, poll.totalVotes)
        return (
          <button
            key={o.id}
            type="button"
            className="af-cm-poll-o af-cm-poll-btn"
            data-mine={o.mine}
            disabled={disabled}
            onClick={() => onVote(o.id)}
            aria-pressed={o.mine}
            aria-label={`${o.text}, ${o.count} vote${o.count === 1 ? '' : 's'}${o.mine ? ', your vote' : ''}`}
          >
            {poll.totalVotes > 0 ? (
              <span className="af-cm-poll-bar" style={{ width: `${share}%` }} aria-hidden="true" />
            ) : null}
            <span className="af-cm-poll-t">{o.text}</span>
            <span className="af-cm-poll-n af-num">{o.count}</span>
          </button>
        )
      })}

      <p className="af-cm-poll-tot">
        {poll.totalVotes === 0
          ? 'No votes yet'
          : `${poll.totalVotes} vote${poll.totalVotes === 1 ? '' : 's'}`}
      </p>
    </div>
  )
}

export default MessagePoll
