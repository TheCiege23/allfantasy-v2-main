import Link from 'next/link'

import type { DraftHqAllData, DraftHqAllRow } from '@/lib/core-app/draftHqAll'
import type { LiveDraftPicks } from '@/lib/core-app/warRoomBoard'
import { platformLabel } from '@/lib/core-app/platformLinks'
import { teamLogoUrl } from '@/lib/core-app/teamLogo'
import PlayerName from '@/components/core-app/player-card/PlayerName'
import {
  BoardHead,
  FooterSummary,
  LeagueCrest,
  PlayerFace,
  SectionHead,
  rankLabel,
} from '@/components/core-app/boards/BoardKit'
import { DraftClock } from '@/components/core-app/boards/DraftClock'
import '@/components/core-app/af-core-boards.css'

/**
 * `/core/war-room` with no league held — only what is live right now.
 *
 * 2026-09-07 handoff (`AF Core War Room.dc.html`), and its whole reason for
 * existing beside Draft HQ is stated there: **Draft HQ is the schedule, the War
 * Room is the present tense.** Draft HQ ranks every draft you are in; this
 * screen shows only the ones actually running, with the tail of each board and
 * your remaining queue targets, and links out to Draft HQ for everything else.
 *
 * If those two screens ever start showing the same list, one of them is
 * redundant — the filter below is what keeps them different.
 *
 * ⚠ THE "STARTING SOON" LIST IS NOT A COUNTDOWN. `DraftSession` stores
 * `startedAt` (the first transition to in_progress) and no scheduled-for column,
 * so "starts in 45m" cannot be computed for a pre-draft. The list names the
 * drafts that have not run and sends you to Draft HQ; it does not invent a time.
 */

export type WarRoomBoardProps = {
  drafts: DraftHqAllData
  picks: LiveDraftPicks
  allHref: string
  draftHqHref: string
}

function LiveCard({ row, picks }: { row: DraftHqAllRow; picks: LiveDraftPicks }) {
  const board = picks.byLeague[row.leagueId] ?? []
  const queue = picks.queueByLeague[row.leagueId] ?? []
  const label = platformLabel(row.platform)

  return (
    <li>
      <article
        className="af-bd-card"
        data-live="true"
        data-sev={row.yoursOnClock ? 'bad' : undefined}
      >
        <header className="af-bd-card-head">
          <LeagueCrest
            imageUrl={row.imageUrl}
            name={row.leagueName}
            platform={row.platform}
            size="sm"
          />
          <span className="af-bd-league">
            <span className="af-bd-name">{row.leagueName}</span>
            <span className="af-bd-sub">
              <span className="af-bd-plat" data-platform={row.platform ?? undefined}>
                {label.toUpperCase()}
              </span>
              {row.currentRound != null ? ` · round ${row.currentRound}` : null}
              {row.nextOverallPick != null ? ` · pick ${row.nextOverallPick}` : null}
            </span>
          </span>
          <span className="af-bd-tag" data-sev={row.yoursOnClock ? 'bad' : 'warn'}>
            {row.yoursOnClock
              ? 'YOU ARE ON THE CLOCK'
              : row.onClockName
                ? `${row.onClockName.toUpperCase()} ON THE CLOCK`
                : 'LIVE'}
          </span>
          {row.pickExpiresAt ? <DraftClock endsAt={row.pickExpiresAt} /> : null}
        </header>

        <div className="af-bd-card-body">
          <div className="af-bd-side">
            <span className="af-bd-side-label">Last picks</span>
            {board.length > 0 ? (
              board.map((p) => (
                <span className="af-bd-asset" key={p.overall}>
                  <span className="af-bd-asset-val">
                    {p.round}.{String(p.pickInRound).padStart(2, '0')}
                  </span>
                  <PlayerFace
                    imageUrl={p.imageUrl}
                    name={p.playerName ?? 'Unnamed pick'}
                    teamLogoUrl={teamLogoUrl('NFL', p.team)}
                    size="sm"
                  />
                  <span className="af-bd-asset-name">
                    {/*
                      ⚠ AN UNNAMED PICK IS SHOWN AS UNNAMED, NOT DROPPED. Dropping
                      it would silently shorten the board and make the pick
                      numbers skip — a gap in our resolution reading as a gap in
                      the draft.
                    */}
                    {/*
                      Opens the player card in this league's context — but only
                      when the three-key join actually landed a Sleeper id.
                      `PlayerName` degrades to plain text without one, which is
                      the right outcome for a pick we could not identify: an
                      inert control would promise a lookup that cannot happen.
                    */}
                    {p.playerName ? (
                      <PlayerName
                        sport="NFL"
                        sleeperId={p.sleeperId}
                        name={p.playerName}
                        position={p.position}
                        team={p.team}
                        imageUrl={p.imageUrl}
                        leagueId={row.leagueId}
                      />
                    ) : (
                      'Player not identified'
                    )}
                    {p.position ? (
                      <span className="af-bd-pos" data-pos={p.position.toUpperCase()}>
                        {' '}
                        {p.position.toUpperCase()}
                      </span>
                    ) : null}
                  </span>
                  <span className="af-bd-asset-val">
                    {p.isYours ? 'YOU' : (p.managerName ?? '—')}
                  </span>
                </span>
              ))
            ) : (
              <span className="af-bd-asset">
                <span className="af-bd-asset-name">No picks recorded yet.</span>
              </span>
            )}
          </div>

          <div className="af-bd-side">
            <span className="af-bd-side-label">Your queue</span>
            {queue.length > 0 ? (
              queue.map((q, i) => (
                <span className="af-bd-asset" key={`${q.playerName}-${i}`}>
                  <span className="af-bd-asset-val">{String(i + 1).padStart(2, '0')}</span>
                  <span className="af-bd-asset-name">
                    {q.playerName}
                    {q.position ? (
                      <span className="af-bd-pos" data-pos={q.position.toUpperCase()}>
                        {' '}
                        {q.position.toUpperCase()}
                      </span>
                    ) : null}
                  </span>
                </span>
              ))
            ) : (
              <span className="af-bd-asset">
                {/*
                  ⚠ "NO QUEUE HERE", NOT "NO QUEUE". The queue tables are
                  AllFantasy's own — a draft that runs on Sleeper keeps its queue
                  on Sleeper, so zero means we hold nothing, not that the manager
                  is unprepared. See `DraftHqAllRow.queuedCount`.
                */}
                <span className="af-bd-asset-name">
                  No queue built in AllFantasy for this draft.
                </span>
              </span>
            )}
          </div>
        </div>

        <p className="af-bd-reason">
          {row.yoursOnClock
            ? 'Your pick is on the clock now.'
            : row.onClockName
              ? `Waiting on ${row.onClockName}.`
              : 'This draft is running.'}
          {row.yourSlot != null && row.teamCount != null
            ? ` You draft at ${row.yourSlot} of ${row.teamCount}.`
            : ''}
          {queue.length > 0
            ? ` ${queue.length} of your queued targets ${queue.length === 1 ? 'is' : 'are'} listed above — this board does not check whether they are still available, so read the picks beside them.`
            : ''}
        </p>

        <div className="af-bd-card-head">
          <span className="af-bd-mid" />
          <Link
            className="af-bd-cta"
            href={`/core/war-room?league=${encodeURIComponent(row.leagueId)}`}
          >
            Open the board →
          </Link>
        </div>
      </article>
    </li>
  )
}

export function WarRoomBoard({ drafts, picks, allHref, draftHqHref }: WarRoomBoardProps) {
  /* The filter that keeps this screen different from Draft HQ. */
  const live = drafts.rows
    .filter((r) => r.phase === 'live')
    .sort((a, b) => Number(b.yoursOnClock) - Number(a.yoursOnClock))

  const soon = drafts.rows.filter((r) => r.phase === 'upcoming').slice(0, 6)

  return (
    <div className="af-bd">
      <BoardHead
        eyebrow="Core · War Room"
        title="War Room"
        blurb="Only the drafts running right now — the board as it stands and what you still have queued. Draft HQ has the full schedule."
      />

      {live.length > 0 ? (
        <section className="af-bd-sec" aria-labelledby="af-wr-live">
          <SectionHead
            id="af-wr-live"
            label="Live now · your pick first"
            count={`${live.length} running`}
          />
          <ul className="af-bd-cards">
            {live.map((r) => (
              <LiveCard key={r.leagueId} row={r} picks={picks} />
            ))}
          </ul>
        </section>
      ) : (
        <p className="af-bd-note">
          {/*
            ⚠ THREE DIFFERENT SILENCES. "Nothing is drafting", "you have drafts
            coming" and "you have no drafts at all" are different facts, and a
            War Room that says the same sentence for all three is telling a
            manager with a draft in an hour that they have nothing on.
          */}
          {drafts.counts.upcoming > 0
            ? `No draft is running right now. ${drafts.counts.upcoming} ${drafts.counts.upcoming === 1 ? 'is' : 'are'} still to come — they are listed below.`
            : drafts.rows.length > 0
              ? 'No draft is running right now, and none of your leagues has one still to come.'
              : 'No draft is set up in any of your leagues.'}
        </p>
      )}

      {soon.length > 0 ? (
        <section className="af-bd-sec" aria-labelledby="af-wr-soon">
          <SectionHead
            id="af-wr-soon"
            label="Starting soon"
            count={`${drafts.counts.upcoming} not yet started`}
          />
          <ul className="af-bd-rows">
            {soon.map((r, i) => (
              <li key={r.leagueId}>
                <Link
                  className="af-bd-row"
                  href={`/core/draft-hq?league=${encodeURIComponent(r.leagueId)}`}
                >
                  <span className="af-bd-rank" aria-hidden>
                    {rankLabel(i)}
                  </span>
                  <LeagueCrest
                    imageUrl={r.imageUrl}
                    name={r.leagueName}
                    platform={r.platform}
                    size="sm"
                  />
                  <span className="af-bd-league">
                    <span className="af-bd-name">{r.leagueName}</span>
                    <span className="af-bd-sub">
                      <span className="af-bd-plat" data-platform={r.platform ?? undefined}>
                        {platformLabel(r.platform).toUpperCase()}
                      </span>
                      {r.rounds != null ? ` · ${r.rounds} rounds` : null}
                    </span>
                  </span>
                  <span className="af-bd-mid">
                    <span className="af-bd-tag" data-sev="info">
                      {r.queuedCount > 0 ? `${r.queuedCount} queued` : 'no queue here'}
                    </span>
                  </span>
                  <span className="af-bd-stat af-bd-stat--narrow">
                    {r.yourSlot != null && r.teamCount != null
                      ? `slot ${r.yourSlot}/${r.teamCount}`
                      : '—'}
                  </span>
                  <span className="af-bd-cta">Draft HQ →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="af-bd-foot">
        <p className="af-bd-foot-text">
          Every draft you are in, running or not, with slots and rounds.
        </p>
        <Link className="af-bd-foot-cta" href={draftHqHref}>
          Draft HQ &rarr;
        </Link>
      </div>

      <FooterSummary
        hidden={Math.max(0, drafts.rows.length - live.length - soon.length)}
        total={drafts.rows.length + drafts.withoutDraft}
        href={allHref}
        quiet="have a draft that has already finished, or none set up at all."
      />
    </div>
  )
}

export default WarRoomBoard
