'use client'

import type { ReactNode } from 'react'
import '@/components/core-app/af-draft-hq.css'
import '@/components/core-app/af-core-redraft-waivers-finder.css'
import '@/components/core-app/af-draft-hq-redesign.css'
import '@/components/core-app/af-draft-hq-league-guide.css'
/* The "Past drafts" fold the page wraps around the archive below this screen (.af-dh-past). */
import '@/components/core-app/af-draft-hq-guide.css'
import { TopicTip } from '@/components/core-app/TopicTip'
import { DraftPreparation } from './DraftPreparation'
import type { DraftHqData } from '@/lib/core-app/draftHq'
import { draftAfText, draftAfTitle } from '@/lib/core-app/draftAfLabel'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import { DraftCompetitiveEdge, type DraftEdgeState } from '@/components/core-app/screens/DraftCompetitiveEdge'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { draftHqUiCopy } from '@/lib/core-app/draftHqUiCopy'
import { draftRoomHref } from '@/lib/league-chat/draftChatLink'
import { useMessages } from '@/components/i18n/useMessages'
import { draftScreensMessages } from '@/lib/core-app/messages/draftScreens'
import { draftHqLeagueGuideMessages } from '@/lib/core-app/messages/draftHqLeagueGuide'
import { leagueDraftHeadline, leagueDraftPhase, type LeagueDraftHeadline, type LeagueDraftPhase } from '@/lib/core-app/draftHqLeagueGuide'
import { DraftHqRookieRoom } from './DraftHqRookieRoom'

/**
 * Screen 8 — one league's Draft HQ.
 *
 * ── 2026-11-13: ONE SENTENCE AT THE TOP, AND THE PAGE ORDERED BY WHERE THE DRAFT IS ──────────────────
 *
 * The owner's ask, for every /core page: users should know what the page is for and what to do. This
 * page used to open on the full pick grid with its "Draft HQ" title 1,500–2,200px down, list ten
 * sections in a fixed order whatever the draft's state, and print seven of them as one "not available"
 * line each. Now:
 *
 *   - the h1 says where you stand (lib/core-app/draftHqLeagueGuide.ts leagueDraftHeadline), with one
 *     intro line for the phase and the one button that matters;
 *   - the order follows the draft: BEFORE — your picks, queue, keepers, prep; DURING — the live board,
 *     then your picks and queue; AFTER — what you drafted, grades, the full board;
 *   - a section whose only content is a "not available" sentence is left out, with one line saying
 *     what appears after the draft; the prep tools and the live board before it starts fold away.
 *
 * Your picks carry the draft's recorded pick trades — "from @dre" on a pick you acquired, and a
 * separate line for the ones you traded away. Where the league trades on its provider and those trades
 * are not synced, the loader's note says so beside the heading: it is a correctness statement, not a
 * footnote, so it stays visible.
 */

export type DraftHqLive = {
  picksMade: number
  totalPicks: number
  /** The next pick to be made, overall; null when nothing is on the clock. */
  currentPickOverall: number | null
  yoursOnClock: boolean
}

export type DraftHqProps = {
  data: DraftHqData
  /** Competitive Edge — loaded by the page only when the viewer's plan includes it. */
  edge?: DraftEdgeState | null
  edgeAccess?: CoreDepthAccess | null
  /** The live board's cursor and clock (getDraftBoardData); null when AllFantasy is not running this draft. */
  live?: DraftHqLive | null
  /** The live pick grid (components/core-app/screens/DraftBoard), placed by phase. */
  board?: ReactNode
}

function Unavailable({ reason }: { reason: string }) {
  const language = useOptionalLanguage().language
  return <p className="af-dh-unavailable">{draftHqUiCopy(reason, language)}</p>
}

const STATUS_TONE: Record<string, string> = {
  pre_draft: 'future',
  in_progress: 'live',
  paused: 'warn',
  completed: 'done',
}

const LIVE_STATUSES = new Set(['in_progress', 'paused'])

/** The board-head link into the live draft room. Exported for tests. */
export function draftRoomCtaLabel(status: string): string {
  if (LIVE_STATUSES.has(status)) return 'Join live draft'
  if (status === 'completed') return 'Open draft board'
  return 'Enter draft room'
}

type Guide = typeof draftHqLeagueGuideMessages.en

function headlineText(h: LeagueDraftHeadline, g: Guide): string {
  switch (h.kind) {
    case 'yourPick':
      return g.headYourPick(h.label)
    case 'paused':
      return g.headPaused(h.yours, h.next)
    case 'live':
      return g.headLive(h.pick, h.total, h.next, h.away)
    case 'before':
      return g.headBefore(h.slot, h.teams)
    case 'done':
      return g.headDone(h.drafted)
    default:
      return g.headNone
  }
}

function introText(phase: LeagueDraftPhase | null, g: Guide): string | null {
  if (phase === 'live') return g.introLive
  if (phase === 'paused') return g.introPaused
  if (phase === 'done') return g.introDone
  if (phase === 'before') return g.introBefore
  return null
}

export function DraftHq({ data, edge = null, edgeAccess = null, live = null, board = null }: DraftHqProps) {
  const language = useOptionalLanguage().language
  const copy = (value: string) => draftHqUiCopy(value, language)
  const m = useMessages(draftScreensMessages)
  const g = useMessages(draftHqLeagueGuideMessages)
  /*
   * A dynasty league's draft room (data.rookieRoom — absent for every other league). When it carries
   * your exact picks from this session, Draft HQ's own "Your picks" list would repeat them word for
   * word, so that section steps aside; the room carries the traded-away line and the sync note.
   */
  const room = data.rookieRoom ?? null
  const roomHasPicks = Boolean(room?.picks?.exact)

  const session = data.session.available ? data.session.data : null
  const phase = leagueDraftPhase(session?.status ?? null)
  const headline = leagueDraftHeadline({
    status: session?.status ?? null,
    yoursOnClock: live?.yoursOnClock ?? false,
    currentPickOverall: live?.currentPickOverall ?? null,
    totalPicks: live?.totalPicks ?? (session ? session.rounds * session.teamCount : null),
    held: data.pickSlots.available ? data.pickSlots.data.held : null,
    yourSlot: session?.yourSlot ?? null,
    teamCount: session?.teamCount ?? null,
    drafted: data.madePicks.available ? data.madePicks.data.length : null,
  })
  const intro = introText(phase, g)
  const done = phase === 'done'
  const running = phase === 'live' || phase === 'paused'

  /*
   * Competitive Edge stays whenever it has something to show — the history, or the plan lock (that is
   * an offer, not a placeholder). Only its "not connected for this league" sentence is left out.
   */
  const edgeLocked = Boolean(edgeAccess && !edgeAccess.unlocked)
  const showEdge = edgeLocked || Boolean(edge?.available)

  const header = (
    <section className="af-frame af-dh-board af-dhl-head" data-phase={phase ?? 'none'}>
      <p className="af-dhl-eyebrow">{g.eyebrow(data.league.name)}</p>
      <div className="af-dh-board-head">
        <h1 className="af-display af-dh-title af-dhl-title">{headlineText(headline, g)}</h1>
        {session ? (
          <>
            <span className="af-dh-status af-num" data-tone={STATUS_TONE[session.status] ?? 'future'}>
              {copy(session.status.replace(/_/g, ' '))}
            </span>
            {/* A plain anchor, not next/link: a full navigation always lands even when
                a deploy has rotated the client chunks under an open tab (Android PWA). */}
            <a
              className="af-dh-enter"
              href={draftRoomHref(data.league.id)}
              data-testid="draft-hq-enter-room"
              data-live={LIVE_STATUSES.has(session.status) ? 'true' : 'false'}
            >
              {copy(draftRoomCtaLabel(session.status))}
            </a>
          </>
        ) : null}
      </div>
      {intro ? <p className="af-dhl-intro">{intro}</p> : null}

      {session ? (
        <div className="af-dh-facts">
          <div className="af-dh-fact">
            <div className="af-dh-fact-value af-num">{session.draftType}</div>
            <div className="af-label">{copy('Format')} <TopicTip topic="draftFormat" /></div>
          </div>
          <div className="af-dh-fact">
            <div className="af-dh-fact-value af-num">{session.rounds}</div>
            <div className="af-label">{copy('Rounds')}</div>
          </div>
          {/* Before the draft the headline already says "you pick 2nd of 12" — said once. */}
          {headline.kind !== 'before' || headline.slot == null ? (
            <>
              <div className="af-dh-fact">
                <div className="af-dh-fact-value af-num">{session.teamCount}</div>
                <div className="af-label">{copy('Teams')}</div>
              </div>
              <div className="af-dh-fact" data-missing={session.yourSlot == null}>
                <div className="af-dh-fact-value af-num">{session.yourSlot != null ? `#${session.yourSlot}` : '—'}</div>
                <div className="af-label">{copy('Your slot')} <TopicTip topic="draftSlot" /></div>
              </div>
            </>
          ) : null}
        </div>
      ) : !data.session.available ? (
        <Unavailable reason={data.session.reason} />
      ) : null}
    </section>
  )

  /* ── The live board: open while it runs, folded before it starts and after it ends ───────────── */
  const boardBlock = board
    ? running
      ? board
      : (
          <details className="af-dhl-fold" data-testid="draft-hq-board-fold">
            <summary>{done ? g.seeFullBoard : g.seeBoard}</summary>
            {board}
          </details>
        )
    : null

  /* ── Your picks: one line, every pick behind a tap ──────────────────────────────────────────── */
  const picksSection =
    roomHasPicks || done ? null : !data.pickSlots.available &&
      !data.session.available &&
      data.pickSlots.reason === data.session.reason ? null : (
      /* Left out when it would only repeat the board's own sentence word for word. */
      <section className="af-frame af-dh-section">
        <header className="af-dh-section-head">
          <h2 className="af-label">{copy('Your picks')} <TopicTip topic="pickOwnership" /></h2>
          {data.pickSlots.available && data.pickSlots.data.note ? (
            <span className="af-dh-section-note" data-testid="draft-hq-picks-note">
              {copy(data.pickSlots.data.note)}
            </span>
          ) : null}
        </header>
        {data.pickSlots.available ? (
          <>
            {data.pickSlots.data.held.length > 0 ? (
              <>
                <p className="af-dhl-picks-line" data-testid="draft-hq-picks-summary">
                  {g.picksSummary(data.pickSlots.data.held.length, data.pickSlots.data.held.map((p) => p.label))}
                </p>
                <details className="af-dhl-fold af-dhl-fold--inline">
                  <summary>{g.showEveryPick}</summary>
                  <ol className="af-dh-picks" data-testid="draft-hq-picks-held">
                    {data.pickSlots.data.held.map((p) => (
                      <li key={p.overall} className="af-dh-pick" data-acquired={p.acquiredFrom ? 'true' : undefined}>
                        <span className="af-dh-pick-label af-num">{p.label}</span>
                        <span className="af-dh-pick-overall">#{p.overall} {copy('overall')}</span>
                        {p.acquiredFrom ? <span className="af-dh-pick-from">{copy('From')} {p.acquiredFrom}</span> : null}
                      </li>
                    ))}
                  </ol>
                </details>
              </>
            ) : (
              <Unavailable reason="you have traded away every pick you started this draft with" />
            )}
            {/* A pick that left is a fact about your draft, so it stays in view rather than in the fold. */}
            {data.pickSlots.data.tradedAway.length > 0 ? (
              <ul className="af-dh-picks-away" data-testid="draft-hq-picks-away">
                {data.pickSlots.data.tradedAway.map((p) => (
                  <li key={p.overall} className="af-dh-pick-away">
                    <span className="af-num">{p.label}</span> {copy('traded to')} {p.to}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <Unavailable reason={data.pickSlots.reason} />
        )}
      </section>
    )

  /* ── What you drafted (only once there is something) ─────────────────────────────────────────── */
  const madeSection = data.madePicks.available ? (
    <section className="af-frame af-dh-section">
      <header className="af-dh-section-head">
        <h2 className="af-label">{copy('What you drafted')} <TopicTip topic="draftedPlayers" /></h2>
        <span className="af-chip af-num">{data.madePicks.data.length}</span>
      </header>
      <ul className="af-dh-made">
        {data.madePicks.data.map((p) => (
          <li key={p.overall} className="af-dh-made-row">
            <span className="af-dh-pick-label af-num">{p.label}</span>
            {/* `imageUrl` is vetted server-side; the fallback is an initial for a pick we could not resolve. */}
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="af-dh-made-face" src={p.imageUrl} alt="" width={28} height={28} loading="lazy" />
            ) : (
              <span className="af-dh-made-face af-dh-made-face--none" aria-hidden>
                {p.playerName.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="af-dh-made-name">{p.playerName}</span>
            <span className="af-dh-made-meta">
              {[p.position, p.team].filter(Boolean).join(' · ')}
              {/* AllFantasy's own projection for your pick; season total on hover. */}
              {draftAfText(p.af) ? (
                <span className="af-dh-af af-num" title={draftAfTitle(p.af)}>
                  {' · '}
                  {draftAfText(p.af)}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  ) : null

  /* ── Draft grades, one card per team (once graded) ───────────────────────────────────────────── */
  const gradesSection = data.grades.available ? (
    <section className="af-frame af-dh-section af-dh-grades">
      <header className="af-dh-section-head">
        <h2 className="af-label">{copy('Draft grades')} <TopicTip topic="draftGrades" /></h2>
        <span className="af-dh-board-meta af-num">
          {data.grades.data.season} &middot; {data.grades.data.gradedPicks}/{data.grades.data.totalPicks} {copy('picks graded')}
        </span>
      </header>
      {/*
        Said before the letters, not after. A reader who sees a B and then finds the caveat underneath
        has already formed the belief the caveat corrects.
      */}
      {data.grades.data.scoringNote ? <p className="af-dh-grade-approx">{copy(data.grades.data.scoringNote)}</p> : null}
      <p className="af-dh-grade-scale">{copy(data.grades.data.scale)}</p>
      {/*
        ⚠ `partial` MEANS THE SEASON IS STILL BEING PLAYED (draftReportService: any graded season whose
        status is not 'complete'). Missing picks are their own sentence, from the counts.
      */}
      {data.grades.data.partial ? <p className="af-dh-grade-partial">{m.hqSeasonInProgress(data.grades.data.season)}</p> : null}
      {data.grades.data.gradedPicks < data.grades.data.totalPicks ? (
        <p className="af-dh-grade-partial">
          {m.hqUngradedPicks(data.grades.data.totalPicks - data.grades.data.gradedPicks, data.grades.data.totalPicks)}
        </p>
      ) : null}
      <ul className="af-dh-gradelist">
        {data.grades.data.teams.map((t) => (
          <li key={t.ownerId} className="af-dh-gradecard">
            <span className="af-dh-grade-letter" data-grade={t.currentGrade}>
              {t.currentGrade}
            </span>
            <span className="af-dh-grade-who">
              <span className="af-dh-grade-team">{t.teamName ?? t.name}</span>
              <span className="af-dh-grade-sub af-num">
                {t.picks} {copy(t.picks === 1 ? 'pick' : 'picks')}
              </span>
            </span>
            {/* Only shown when it moved — in redraft the two grades are the same by construction. */}
            {t.trend !== 'steady' ? (
              <span className="af-dh-grade-trend" data-trend={t.trend}>
                {t.trend === 'improved' ? '↑' : '↓'} {copy('from')} {t.initialGrade}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  ) : null

  /* ── The recorded board of the last completed draft (every team, by round) ──────────────────── */
  const recordedBoard = data.board.available ? (
    <section className="af-frame af-dh-section af-dh-boardfull">
      <header className="af-dh-section-head">
        <h2 className="af-label">{copy('Draft board')} <TopicTip topic="recordedDraftBoard" /></h2>
        <span className="af-dh-board-meta af-num">
          {data.board.data.season} &middot; {data.board.data.teams.length} {copy('teams')} &middot; {data.board.data.totalPicks} {copy('picks')}
        </span>
      </header>
      {/* Team strip first: a board is unreadable without knowing whose column is whose. */}
      <ul className="af-dh-teamstrip">
        {data.board.data.teams.map((t) => (
          <li key={t.teamKey} className="af-dh-teamchip" data-you={t.isYou ? 'true' : undefined}>
            <span className="af-dh-teamchip-name">{t.name ?? t.teamKey}</span>
            <span className="af-dh-teamchip-n af-num">{t.picks}</span>
          </li>
        ))}
      </ul>
      {/* Rounds in order, picks in pick order within each — grouping by team would hide the snake. */}
      {data.board.data.rounds.map((r) => (
        <div key={r.round} className="af-dh-round">
          <h3 className="af-dh-round-title af-num">
            {copy('Round')} {r.round}
          </h3>
          <div className="af-dh-round-scroll">
            <ul className="af-dh-round-picks">
              {r.picks.map((p) => (
                <li key={`${p.round}:${p.overall}:${p.teamKey}`} className="af-dh-bpick" data-you={p.isYou ? 'true' : undefined}>
                  <span className="af-dh-pick-label af-num">{p.label}</span>
                  <span className="af-dh-bpick-player">{p.playerName}</span>
                  <span className="af-dh-bpick-meta">
                    {p.position !== '—' ? p.position : ''}
                    {draftAfText(p.af) ? (
                      <span className="af-dh-af af-num" title={draftAfTitle(p.af)}>
                        {' '}
                        {draftAfText(p.af)}
                      </span>
                    ) : null}
                  </span>
                  <span className="af-dh-bpick-team">{p.teamName ?? p.teamKey}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </section>
  ) : null

  /* ── Lottery (dynasty leagues configured to run one) ─────────────────────────────────────────── */
  const lotterySection = data.lottery.available ? (
    <section className="af-frame af-dh-section">
      <header className="af-dh-section-head">
        <h2 className="af-label">{copy('Weighted lottery')} <TopicTip topic="draftLottery" /></h2>
      </header>
      <p className="af-dh-lottery-rule">
        {m.hqLotteryRule(data.lottery.data.pickCount, data.lottery.data.fallbackOrder)}
        {data.lottery.data.alreadyRunAt ? ` ${copy('This league has already run its lottery.')}` : ''}
      </p>
      <table className="af-dh-lottery" data-testid="draft-hq-lottery">
        <thead>
          <tr>
            <th scope="col">{copy('Team')}</th>
            <th scope="col">{copy('Record')}</th>
            <th scope="col">{copy('Odds #1')}</th>
          </tr>
        </thead>
        <tbody>
          {data.lottery.data.teams.map((t) => (
            <tr key={t.rosterId} data-you={t.isYou ? 'true' : undefined}>
              <td>
                {t.name}
                {t.isYou ? <span className="af-dh-lottery-you"> {copy('you')}</span> : null}
              </td>
              <td className="af-num">{t.record}</td>
              <td className="af-num">{t.oddsPercent.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  ) : null

  /*
   * ── Queue & keepers ──────────────────────────────────────────────────────────────────────────
   * The queue shows before and during the draft even when empty: "you have not queued any players"
   * is the next thing to do, not a placeholder. Keepers show only when there are some.
   */
  const queueSection = done ? null : (
    <section className="af-card af-dh-section">
      <h2 className="af-label">{copy('Prepared queue')}</h2>
      {data.queue.available ? (
        <>
          <ol className="af-dh-queue" data-testid="draft-hq-queue">
            {data.queue.data.players.map((p) => (
              <li key={`${p.rank}:${p.playerName}`} className="af-dh-queue-row">
                <span className="af-dh-queue-rank af-num">{p.rank}</span>
                <span className="af-dh-made-name">{p.playerName}</span>
                <span className="af-dh-made-meta">{[p.position, p.team].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ol>
          {data.queue.data.total > data.queue.data.players.length ? (
            <p className="af-dh-unavailable">
              {data.queue.data.total - data.queue.data.players.length} {copy('more in your queue')}
            </p>
          ) : null}
        </>
      ) : (
        <Unavailable reason={data.queue.reason} />
      )}
    </section>
  )
  const keepersSection = data.keepers.available ? (
    <section className="af-card af-dh-section">
      <h2 className="af-label">{copy('Keepers')} <TopicTip topic="keepers" /></h2>
      <p className="af-dh-unavailable">
        {data.keepers.data.source === 'imported'
          ? m.hqKeptImported(data.keepers.data.season)
          : data.keepers.data.maxKeepers != null
            ? m.hqKeepersDeclared(data.keepers.data.maxKeepers)
            : copy('declared for this draft')}
      </p>
      <ul className="af-dh-made" data-testid="draft-hq-keepers">
        {data.keepers.data.players.map((k) => (
          <li key={`${k.round}:${k.playerName}`} className="af-dh-made-row">
            <span className="af-dh-pick-label af-num">
              {copy('Rd')} {k.round}
            </span>
            <span className="af-dh-made-name">{k.playerName}</span>
            <span className="af-dh-made-meta">{[k.position, k.team].filter(Boolean).join(' · ')}</span>
          </li>
        ))}
      </ul>
    </section>
  ) : null
  const queuePair =
    queueSection || keepersSection ? (
      <div className="af-dh-pair" data-single={queueSection && keepersSection ? undefined : 'true'}>
        {queueSection}
        {keepersSection}
      </div>
    ) : null

  /* ── Prep tools: ADP, mock drafts, outlook — folded; the checklist inside still leads ─────────── */
  const prep =
    data.preparation && !done ? (
      <details className="af-dhl-fold" data-testid="draft-hq-prep-fold">
        <summary>{g.prepTools}</summary>
        <DraftPreparation data={data.preparation} leagueId={data.league.id} draftComplete={false} />
      </details>
    ) : null
  /* After the draft the prep block is its own review (draftComplete), so it stays as it was, unfolded. */
  const prepDone = data.preparation && done ? <DraftPreparation data={data.preparation} leagueId={data.league.id} draftComplete /> : null

  /* The recorded board is long (every pick by round) and, before or during a draft, last season's — folded everywhere. */
  const recordedFold = recordedBoard ? (
    <details className="af-dhl-fold" data-testid="draft-hq-recorded-fold">
      <summary>{g.seeFullBoard}</summary>
      {recordedBoard}
    </details>
  ) : null

  const edgeBlock = showEdge ? <DraftCompetitiveEdge access={edgeAccess} edge={edge} /> : null
  /* One line for everything that only exists once the draft is done, instead of a sentence per section. */
  const laterLine = session && !done ? <p className="af-dhl-later">{g.later}</p> : null

  return (
    <div className="af-dh" data-dynasty-room={room ? 'true' : undefined} data-phase={phase ?? 'none'}>
      {header}
      {room ? <DraftHqRookieRoom room={room} leagueId={data.league.id} /> : null}

      {done ? (
        <>
          {madeSection}
          {gradesSection}
          {edgeBlock}
          {recordedFold ?? boardBlock}
          {lotterySection}
          {keepersSection}
          {prepDone}
        </>
      ) : running ? (
        <>
          {boardBlock}
          {picksSection}
          {madeSection}
          {queuePair}
          {lotterySection}
          {edgeBlock}
          {prep}
          {gradesSection}
          {recordedFold}
          {laterLine}
        </>
      ) : (
        <>
          {picksSection}
          {queuePair}
          {lotterySection}
          {edgeBlock}
          {prep}
          {boardBlock}
          {madeSection}
          {gradesSection}
          {recordedFold}
          {laterLine}
        </>
      )}
    </div>
  )
}

export default DraftHq
