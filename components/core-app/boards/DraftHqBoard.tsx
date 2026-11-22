import Link from 'next/link'

import type { DraftHqAllData, DraftHqAllRow } from '@/lib/core-app/draftHqAll'
import type { LiveDraftPicks } from '@/lib/core-app/warRoomBoard'
import { platformLabel } from '@/lib/core-app/platformLinks'
import { teamLogoUrl } from '@/lib/core-app/teamLogo'
import PlayerName from '@/components/core-app/player-card/PlayerName'
import {
  BoardHead,
  LeagueCrest,
  PlayerFace,
  SectionHead,
  StatPair,
  platformKey,
  NoLeaguesYet,
} from '@/components/core-app/boards/BoardKit'
import { DraftClock } from '@/components/core-app/boards/DraftClock'
import { TopicTip } from '@/components/core-app/TopicTip'
import '@/components/core-app/af-core-boards.css'
import '@/components/core-app/af-draft-hq-redesign.css'
import '@/components/core-app/af-draft-hq-guide.css'
import { messagesFor } from '@/lib/i18n/messages'
import { draftHqGuideMessages } from '@/lib/core-app/messages/draftHqGuide'
import { draftHqHeadline, groupDrafts, isYourPickNow, type DraftHqHeadline } from '@/lib/core-app/draftHqGuide'

/**
 * `/core/draft-hq` with no league held — every draft you are in, the one that needs you first.
 *
 * ── 2026-11-13: ONE SENTENCE AT THE TOP, AND A CARD ONLY WHERE A CLOCK IS RUNNING ──────────────────
 *
 * The owner's ask, for every /core page: users should know exactly what the page is for and what to
 * do. The board used to open on a paragraph about its ranking rule and then stack ten identical cards,
 * six stat boxes each — for a draft that had not started, half of them "—" — and the same queue
 * disclaimer on every card. Now:
 *
 *   - the h1 answers "does a draft need me?" (lib/core-app/draftHqGuide.ts draftHqHeadline);
 *   - full cards only for drafts with a clock (your pick, drafting now); not-started and finished
 *     drafts are one line each, since nothing on them is ticking;
 *   - each fact is said once: a stat box that would read "—" is not drawn, "picks made" is gone (the
 *     tag says the pick number), and the queue note is one line for the page.
 *
 * ── Carried rules, unchanged ───────────────────────────────────────────────
 *
 * ⚠ `picks` IS OPTIONAL AND AN ABSENT ENTRY IS NOT AN EMPTY DRAFT. The loader is only called when
 * something is live, so `undefined` means "not loaded" and the live block is skipped rather than
 * rendering "no picks recorded yet" against a draft nobody read.
 *
 * ⚠ "STARTS IN 45M" IS NOT RENDERED, BECAUSE NO SCHEDULED START TIME IS STORED. `DraftSession` carries
 * `startedAt` and nothing else, so a countdown to a pre-draft would be invented — and it is why the
 * not-started rows are not ordered as "next up": nothing says which starts first.
 *
 * ⚠ A ZERO QUEUE IS "NOTHING BUILT HERE", NOT "UNPREPARED". The queue tables are AllFantasy's own; a
 * Sleeper draft keeps its queue on Sleeper (see `DraftHqAllRow.queuedCount`).
 */

type DraftHqBoardProps = {
  data: DraftHqAllData
  /** Where the footer's "See all" goes — the full picker. */
  allHref: string
  /** Total leagues on the account, for the footer. */
  totalLeagues: number
  /**
   * The tail of each LIVE draft's board and your queue for it, keyed by league.
   * Optional: absent means the loader did not run (nothing is live) — see the header note.
   */
  picks?: LiveDraftPicks
  language?: string | null
}

type Copy = typeof draftHqGuideMessages.en

function headlineText(h: DraftHqHeadline, m: Copy): string {
  switch (h.kind) {
    case 'yourPick':
      return m.headYourPick(h.league, h.n)
    case 'running':
      return `${h.known ? m.headRunning(h.league, h.n) : m.headRunningUnknown(h.league, h.n)}${h.pausedYours ? m.headPausedYours(h.pausedYours) : ''}`
    case 'paused':
      return m.headPaused(h.league, h.n, h.yours)
    case 'upcoming':
      return m.headUpcoming(h.n)
    case 'allDone':
      return m.headAllDone
    default:
      return m.headNone
  }
}

function statusOf(r: DraftHqAllRow, m: Copy): { label: string; sev: 'bad' | 'warn' | 'good' | 'info' } {
  if (r.rawStatus === 'paused') return { label: m.tagPaused, sev: 'info' }
  if (r.yoursOnClock) return { label: m.tagYourPick, sev: 'bad' }
  if (r.phase === 'live') return { label: m.tagLive(r.nextOverallPick), sev: 'warn' }
  if (r.phase === 'upcoming') return { label: m.tagUpcoming, sev: 'info' }
  if (r.phase === 'done') return { label: m.tagDone, sev: 'good' }
  /*
   * ⚠ THE RAW STATUS, NOT A GUESS. The draft-status vocabulary is inconsistent across providers; a
   * finished draft filed as "upcoming" is a confident lie, while `post_draft_v2` is at least something a
   * reader can look up. Same rule the aggregator applies.
   */
  return { label: r.rawStatus.toUpperCase(), sev: 'info' }
}

/** The one line under a card. Computed from the row, never generated — it cannot say what the board does not show. */
function lineOf(r: DraftHqAllRow, m: Copy): string | null {
  if (r.rawStatus === 'paused') return m.linePaused
  if (r.yoursOnClock) return m.lineYourPick
  if (r.phase === 'live' && r.yourSlot == null) return m.lineSlotUnknown
  if (r.phase === 'live') return r.onClockName ? m.lineOnClock(r.onClockName) : m.lineRunning
  return null
}

/** Native leagues store a draft date; an imported draft's date lives on its platform (DraftHqAllRow.draftAt). */
function isNative(platform: string | null): boolean {
  const k = String(platform ?? '').trim().toLowerCase()
  return k === '' || k === 'native' || k === 'allfantasy' || k === 'af'
}

/** When a not-started draft happens, in ET like the rest of /core — or where its date lives. */
function dateOf(r: DraftHqAllRow, m: Copy): string | null {
  if (r.phase !== 'upcoming') return null
  if (r.draftAt) {
    const when = new Date(r.draftAt).toLocaleString(m.dateLocale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York',
    })
    return m.draftsOn(when)
  }
  return isNative(r.platform) ? m.noDateSet : m.dateOnPlatform(platformLabel(r.platform))
}

function boardHref(r: DraftHqAllRow): string {
  return `/core/draft-hq?league=${encodeURIComponent(r.leagueId)}`
}

function buttonLabel(r: DraftHqAllRow, m: Copy): string {
  return r.phase === 'live' ? m.btnLive : r.phase === 'upcoming' ? m.btnUpcoming : m.btnDone
}

function slotOf(r: DraftHqAllRow, m: Copy): string | null {
  return r.yourSlot != null && r.teamCount != null ? m.of(r.yourSlot, r.teamCount) : null
}

/**
 * The two-column live block, lifted from the retired cross-league War Room.
 *
 * ⚠ AN UNNAMED PICK IS SHOWN AS UNNAMED, NOT DROPPED — dropping it would make the pick numbers skip, a
 * gap in our player resolution reading as a gap in the draft. And the name is only a control when the
 * three-key join landed a Sleeper id; `PlayerName` degrades to plain text without one.
 *
 * An empty queue draws no column: the page's one queue note says why it is empty.
 */
function LiveDetail({ row, picks, m }: { row: DraftHqAllRow; picks: LiveDraftPicks; m: Copy }) {
  const board = picks.byLeague[row.leagueId] ?? []
  const queue = picks.queueByLeague[row.leagueId] ?? []

  return (
    <div className="af-bd-card-body">
      <div className="af-bd-side">
        <span className="af-bd-side-label">{m.lastPicks}</span>
        {board.length > 0 ? (
          board.map((p) => (
            <span className="af-bd-asset" key={p.overall}>
              <span className="af-bd-asset-val">
                {p.round}.{String(p.pickInRound).padStart(2, '0')}
              </span>
              <PlayerFace
                imageUrl={p.imageUrl}
                name={p.playerName ?? m.unnamedPick}
                teamLogoUrl={teamLogoUrl(p.sport ?? 'NFL', p.team)}
                size="sm"
              />
              <span className="af-bd-asset-name">
                {p.playerName ? (
                  <PlayerName
                    sport={p.sport ?? 'NFL'}
                    sleeperId={p.sleeperId}
                    name={p.playerName}
                    position={p.position}
                    team={p.team}
                    imageUrl={p.imageUrl}
                    leagueId={row.leagueId}
                  />
                ) : (
                  m.unnamedPick
                )}
                {p.position ? (
                  <span className="af-bd-pos" data-pos={p.position.toUpperCase()}>
                    {' '}
                    {p.position.toUpperCase()}
                  </span>
                ) : null}
              </span>
              <span className="af-bd-asset-val">{p.isYours ? m.youTag : (p.managerName ?? '—')}</span>
            </span>
          ))
        ) : (
          <span className="af-bd-asset">
            <span className="af-bd-asset-name">{m.noPicks}</span>
          </span>
        )}
      </div>

      {queue.length > 0 ? (
        <div className="af-bd-side">
          <span className="af-bd-side-label">{m.yourQueue}</span>
          {queue.map((q, i) => (
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
          ))}
          {/*
            🛑 THE CAVEAT TRAVELS WITH THE QUEUE. A queue rendered beside a live draft implies
            availability unless it says otherwise — at a draft, that is the difference between a target
            and a player taken four picks ago.
          */}
          <span className="af-bd-asset">
            {/* A sentence, not a name: it wraps (it was cut to "read the picks bes…" at 1280px). */}
            <span className="af-bd-asset-name af-dh-caveat">{m.queueUnchecked}</span>
          </span>
        </div>
      ) : null}
    </div>
  )
}

/** A draft with a clock: your pick, or one running (paused ones included). */
function Card({ row, picks, m }: { row: DraftHqAllRow; picks?: LiveDraftPicks; m: Copy }) {
  const status = statusOf(row, m)
  const label = platformLabel(row.platform)
  const format = [row.modeLabel, row.draftType].filter(Boolean).join(' · ') || null
  const yourPick = isYourPickNow(row)
  /* "On the clock" only while a pick is genuinely being made; off that, it is not drawn at all. */
  const onClock = row.yoursOnClock ? m.you : row.phase === 'live' ? row.onClockName : null
  const slot = slotOf(row, m)
  const round = row.currentRound != null ? (row.rounds != null ? m.of(row.currentRound, row.rounds) : String(row.currentRound)) : null
  const line = lineOf(row, m)

  return (
    <li>
      <article className="af-bd-card" data-live={row.phase === 'live' ? 'true' : undefined} data-sev={yourPick ? 'bad' : undefined}>
        <header className="af-bd-card-head">
          <LeagueCrest imageUrl={row.imageUrl} name={row.leagueName} platform={row.platform} size="sm" />
          <span className="af-bd-league">
            <span className="af-bd-name">{row.leagueName}</span>
            <span className="af-bd-sub">
              <span className="af-bd-plat" data-platform={platformKey(row.platform)}>
                {label.toUpperCase()}
              </span>
              {format ? ` · ${format}` : null}
            </span>
          </span>
          <span className="af-bd-tag" data-sev={status.sev}>
            {status.label}
          </span>
          {/* Only while a pick is genuinely running — `pickExpiresAt` is null off a live, unpaused draft. */}
          {row.pickExpiresAt ? <DraftClock endsAt={row.pickExpiresAt} /> : null}
          <Link className="af-bd-btn" href={boardHref(row)}>
            {buttonLabel(row, m)}
          </Link>
        </header>

        {/* Each box only when it has something to say; "—" in a box told the reader nothing. */}
        <div className="af-bd-kvrow">
          {slot ? <StatPair k={m.statSlot} v={slot} /> : null}
          {round ? <StatPair k={m.statRound} v={round} /> : null}
          {onClock ? <StatPair k={m.statOnClock} v={onClock} sev={yourPick ? 'bad' : undefined} /> : null}
          {/* The number you wait for while someone else picks (2026-11-13). */}
          {row.yourNextPick && !row.yoursOnClock ? (
            <StatPair k={m.statNextPick} v={m.nextPick(row.yourNextPick.round, row.yourNextPick.inRound, row.yourNextPick.away)} sev="accent" />
          ) : null}
          {row.queuedCount > 0 ? <StatPair k={m.statQueued} v={String(row.queuedCount)} sev="accent" /> : null}
        </div>

        {row.phase === 'live' && picks ? <LiveDetail row={row} picks={picks} m={m} /> : null}

        {line ? <p className="af-bd-reason">{line}</p> : null}
      </article>
    </li>
  )
}

/** A draft with nothing ticking — not started, finished, or an unreadable status: one line. */
function Row({ row, m }: { row: DraftHqAllRow; m: Copy }) {
  const status = statusOf(row, m)
  const facts = m.rowFacts(slotOf(row, m), row.rounds)
  const date = dateOf(row, m)
  return (
    <li className="af-dh-row" data-phase={row.phase}>
      <LeagueCrest imageUrl={row.imageUrl} name={row.leagueName} platform={row.platform} size="sm" />
      <span className="af-dh-row-main">
        <span className="af-bd-name">{row.leagueName}</span>
        <span className="af-bd-sub">
          <span className="af-bd-plat" data-platform={platformKey(row.platform)}>
            {platformLabel(row.platform).toUpperCase()}
          </span>
          {facts ? ` · ${facts}` : null}
          {row.queuedCount > 0 ? ` · ${m.statQueued} ${row.queuedCount}` : null}
        </span>
        {date ? (
          <span className="af-dh-row-date" data-dated={row.draftAt ? 'true' : undefined}>
            {date}
          </span>
        ) : null}
      </span>
      <span className="af-bd-tag" data-sev={status.sev}>
        {status.label}
      </span>
      <Link className="af-bd-btn af-dh-row-btn" href={boardHref(row)}>
        {buttonLabel(row, m)}
      </Link>
    </li>
  )
}

function DraftHqBoard({ data, allHref, totalLeagues, picks, language = null }: DraftHqBoardProps) {
  // A server component: the catalog is read directly, not through the client hook.
  const m = messagesFor(draftHqGuideMessages, language)

  /* No leagues on this account yet: say so and offer a way forward (BoardKit NoLeaguesYet). */
  if (totalLeagues === 0) {
    return (
      <div className="af-bd af-bd--drafts">
        <BoardHead eyebrow={m.eyebrow} title={m.headNone} blurb={m.intro} />
        <NoLeaguesYet
          what="Once one is, every draft you are in shows here, the one that needs you first. A mock draft works right now, with no league at all."
          language={language ?? 'en'}
        />
      </div>
    )
  }

  const headline = draftHqHeadline(data.rows)
  const { groups, shown } = groupDrafts(data.rows, 10)
  const withDraft = data.rows.length
  /* The queue note, once for the page — only when a draft still to come or running shows an empty queue. */
  const anyEmptyQueue = [...groups.yourPick, ...groups.drafting, ...groups.comingUp].some((r) => r.queuedCount === 0)

  return (
    <div className="af-bd af-bd--drafts">
      <BoardHead eyebrow={m.eyebrow} title={headlineText(headline, m)} blurb={m.intro} />

      {withDraft === 0 ? <p className="af-bd-note">{m.noDraftYet(data.withoutDraft)}</p> : null}

      {groups.yourPick.length > 0 ? (
        <section className="af-bd-sec" aria-labelledby="af-dh-yours">
          <SectionHead id="af-dh-yours" label={m.secYourPick} tone="bad" count={String(groups.yourPick.length)} info={<TopicTip topic="draftCardStats" />} />
          <ul className="af-bd-cards af-bd-cards--rich">
            {groups.yourPick.map((r) => (
              <Card key={r.leagueId} row={r} picks={picks} m={m} />
            ))}
          </ul>
        </section>
      ) : null}

      {groups.drafting.length > 0 ? (
        <section className="af-bd-sec" aria-labelledby="af-dh-drafting">
          <SectionHead
            id="af-dh-drafting"
            label={m.secDrafting}
            tone="warn"
            count={String(groups.drafting.length)}
            info={groups.yourPick.length === 0 ? <TopicTip topic="draftCardStats" /> : undefined}
          />
          <ul className="af-bd-cards af-bd-cards--rich">
            {groups.drafting.map((r) => (
              <Card key={r.leagueId} row={r} picks={picks} m={m} />
            ))}
          </ul>
        </section>
      ) : null}

      {groups.comingUp.length > 0 ? (
        <section className="af-bd-sec" aria-labelledby="af-dh-coming">
          <SectionHead id="af-dh-coming" label={m.secComingUp} count={String(groups.comingUp.length)} />
          <ul className="af-dh-rows">
            {groups.comingUp.map((r) => (
              <Row key={r.leagueId} row={r} m={m} />
            ))}
          </ul>
        </section>
      ) : null}

      {groups.finished.length > 0 ? (
        <section className="af-bd-sec" aria-labelledby="af-dh-finished">
          <SectionHead id="af-dh-finished" label={m.secFinished} tone="good" count={String(groups.finished.length)} />
          <ul className="af-dh-rows">
            {groups.finished.map((r) => (
              <Row key={r.leagueId} row={r} m={m} />
            ))}
          </ul>
        </section>
      ) : null}

      {/*
        ⚠ ONE FOOTER LINE, AND ITS LINK IS THE ONLY ROUTE TO THE FULL PICKER (BoardKit FooterSummary's
        rule) — so it renders even when every draft is shown. Leagues with no readable draft are counted
        here in one clause rather than filling the board.
      */}
      <div className="af-bd-foot">
        {/* A div, not a <p>: a <details> inside a <p> is invalid HTML — the parser closes the <p> early and hydration fails. */}
        <div className="af-bd-foot-text">
          {m.foot(shown, withDraft)}{' '}
          {/*
            One count on the line (2026-11-13). Leagues with no readable draft, and why a queue can read
            empty, sit behind this "?" — they were a second and third number in the same sentence.
          */}
          {data.withoutDraft > 0 || anyEmptyQueue ? (
            <details className="af-dh-why">
              <summary aria-label={m.footWhy} title={m.footWhy}>
                ?
              </summary>
              <span className="af-dh-why-body">
                {data.withoutDraft > 0 ? <span className="af-dh-why-line">{m.footWithout(data.withoutDraft)}</span> : null}
                {anyEmptyQueue ? <span className="af-dh-why-line af-dh-queue-note">{m.queueNote}</span> : null}
              </span>
            </details>
          ) : (
            <TopicTip topic="draftHqScope" />
          )}
        </div>
        <Link className="af-bd-foot-cta" href={allHref}>
          {m.footAll(totalLeagues)} &rarr;
        </Link>
      </div>
    </div>
  )
}

export default DraftHqBoard
