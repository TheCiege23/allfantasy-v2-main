'use client'

import type { SurvivorSummary } from '@/components/survivor/types'
import { useMessages } from '@/components/i18n/useMessages'
import { survivorIslandMessages } from '@/lib/core-app/messages/survivorIsland'
import { voteReadingView } from '@/lib/core-app/survivorVoteReading'

/**
 * The Tribal Council vote reading on Camp: parchment ballots revealed one at a time, a tally per
 * castaway and, once the last ballot is out, "The tribe has spoken".
 *
 * It renders only what the summary already carries — the server releases ballots one at a time and
 * withholds the verdict (lib/survivor/survivorRevealGate.ts) — and the banner refreshes the summary
 * while the read is in progress. Ballots are anonymous: no voter is ever shown.
 */
export function SurvivorVoteReading({ summary }: { summary: SurvivorSummary }) {
  const m = useMessages(survivorIslandMessages)
  const v = voteReadingView(summary)
  if (!v) return null
  const latest = v.latest
  const status = latest && !latest.counts ? m.readingStatus(latest.status) : ''
  return (
    <section className="sv-panel sv-reading" aria-label={m.readingEyebrow} data-testid="survivor-vote-reading" data-complete={v.complete ? 'true' : undefined}>
      <div className="sv-panel-h">
        <span className="sv-eyebrow">{m.readingEyebrow}</span>
        <span className="sv-eyebrow sv-mono">{m.readingProgress(v.released, v.total)}</span>
      </div>
      <p className="sv-reading-sub">{m.readingSub(v.week, v.tribeName)}</p>

      <div className="sv-reading-grid">
        <div aria-live="polite" aria-atomic="true">
          {latest ? (
            <article key={`${v.councilId}-${latest.position}`} className="sv-ballot" data-void={latest.counts ? undefined : 'true'} data-testid="survivor-ballot">
              <span className="sv-ballot-ord">
                {m.readingVoteOf(latest.position, v.total)}
                {latest.isExtraVote ? <span className="sv-ballot-extra">{m.readingExtraVote}</span> : null}
              </span>
              <span className="sv-ballot-name">{latest.targetName ?? m.readingNoTarget}</span>
              {status ? <span className="sv-ballot-stamp">{status}</span> : null}
            </article>
          ) : (
            <p className="sv-ballot-wait">{m.readingWaiting}</p>
          )}
        </div>

        {v.tally.length > 0 ? (
          <div className="sv-tally" aria-label={m.readingTally}>
            <span className="sv-eyebrow">{m.readingTally}</span>
            <ul>
              {v.tally.map((row) => (
                <li key={row.name} data-leading={row.leading ? 'true' : undefined}>
                  <span className="sv-tally-name">{row.name}</span>
                  <span className="sv-pips" aria-hidden="true">
                    {Array.from({ length: row.count }, (_, i) => <i key={i} />)}
                  </span>
                  <span className="sv-mono sv-tally-count" aria-label={m.readingVotes(row.count)}>{row.count}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {v.verdict ? (
        <div className="sv-spoken" data-testid="survivor-tribe-has-spoken">
          <strong className="sv-spoken-h">{m.readingSpoken}</strong>
          {v.verdict.kind === 'out' ? (
            <>
              <span className="sv-spoken-name">{m.readingOut(v.verdict.name)}</span>
              <span className="sv-mono sv-spoken-margin">{m.readingMargin(v.verdict.votes, v.verdict.nextBest)}</span>
            </>
          ) : (
            <span className="sv-spoken-note">{v.verdict.kind === 'tie' ? m.readingTie : m.readingNone}</span>
          )}
        </div>
      ) : null}
    </section>
  )
}
