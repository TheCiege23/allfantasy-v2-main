'use client'

import { isPollClosed, pollShare, type ViewerPoll } from '@/lib/chat-core/messagePolls'
import { formatChatMessageTimestamp } from '@/lib/chat-core/chat-timestamps'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { predictionCopy } from '@/lib/league-chat/predictionCopy'

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
  onClose,
  disabled,
}: {
  poll: ViewerPoll
  onVote: (optionId: string) => void
  /** Only passed when the viewer wrote the poll or runs the league. */
  onClose?: () => void
  disabled?: boolean
}) {
  const { language } = useOptionalLanguage()
  const t = (english: string) => predictionCopy(english, language)
  const closed = isPollClosed(poll)
  const locked = closed || disabled
  /*
   * "Results after close": the server sent only the viewer's own vote, so there is no tally to
   * draw — counts and bars would be the viewer's single vote dressed up as a result.
   */
  const hidden = poll.resultsHidden
  const prediction = poll.prediction

  return (
    <div className="af-cm-poll" data-closed={closed} data-prediction={prediction ? 'true' : undefined}>
      {prediction ? <p className="af-cm-poll-kind">{t('Prediction · closes at kickoff')}</p> : null}
      <p className="af-cm-poll-q">{poll.question}</p>

      {poll.options.map((o) => {
        const share = pollShare(o, poll.totalVotes)
        const won = Boolean(prediction?.resolved && prediction.winningOptionId === o.id)
        return (
          <button
            key={o.id}
            type="button"
            className="af-cm-poll-o af-cm-poll-btn"
            data-mine={o.mine}
            data-won={won || undefined}
            disabled={locked}
            onClick={() => onVote(o.id)}
            aria-pressed={o.mine}
            aria-label={
              hidden
                ? `${o.text}${o.mine ? ', your vote' : ''}`
                : `${o.text}, ${o.count} vote${o.count === 1 ? '' : 's'}${o.mine ? ', your vote' : ''}${won ? ', correct pick' : ''}`
            }
          >
            {!hidden && poll.totalVotes > 0 ? (
              <span className="af-cm-poll-bar" style={{ width: `${share}%` }} aria-hidden="true" />
            ) : null}
            <span className="af-cm-poll-t">
              {won ? '✓ ' : ''}
              {o.text}
            </span>
            {hidden ? (
              o.mine ? <span className="af-cm-poll-n">✓</span> : null
            ) : (
              <span className="af-cm-poll-n af-num">{o.count}</span>
            )}
          </button>
        )
      })}

      <p className="af-cm-poll-tot">
        {hidden
          ? t('Results show when the poll closes')
          : poll.totalVotes === 0
            ? 'No votes yet'
            : `${poll.totalVotes} vote${poll.totalVotes === 1 ? '' : 's'}`}
        {prediction?.tie ? ` · ${t('Ended in a tie — no points')}` : null}
        {poll.allowMultiple ? ' · pick as many as you like' : null}
        {/*
          Said BEFORE anyone votes, not after. "Your name will not be attached"
          changes whether somebody answers honestly, and learning it afterwards
          is no use to them.
        */}
        {poll.anonymous ? ' · votes are anonymous' : null}
        {/*
          The deadline the composer has always collected and nothing ever showed.
          Said plainly either way: a poll that has quietly stopped accepting
          votes while still looking tappable is worse than one marked closed.
        */}
        {closed ? (
          <span className="af-cm-poll-closed"> · Closed</span>
        ) : poll.closesAt ? (
          <span> · closes {formatChatMessageTimestamp(poll.closesAt)}</span>
        ) : null}
      </p>

      {onClose && !closed ? (
        <button type="button" className="af-cm-poll-close" disabled={disabled} onClick={onClose}>
          Close the poll
        </button>
      ) : null}
    </div>
  )
}

export default MessagePoll
