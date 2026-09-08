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
  StatPair,
  rankLabel,
} from '@/components/core-app/boards/BoardKit'
import { DraftClock } from '@/components/core-app/boards/DraftClock'
import '@/components/core-app/af-core-boards.css'

/**
 * `/core/draft-hq` with no league held — every draft, ranked by clock.
 *
 * 2026-09-07 handoff (`AF Core Draft HQ.dc.html`).
 *
 * ── 2026-09-08: THIS BOARD ABSORBED THE CROSS-LEAGUE WAR ROOM ───────────────
 *
 * The War Room used to be a second cross-league draft screen, filtered to the
 * drafts running right now, and its reason for existing was stated as "Draft HQ
 * is the schedule, the War Room is the present tense". That split is retired:
 * the War Room is now the season-long Decision OS hub, and a draft is a Draft HQ
 * concern in every phase it can be in.
 *
 * So the live tail the War Room drew — the last picks on the board and your
 * remaining queue targets — moved HERE, onto the cards that were already ranked
 * with the live ones first. It renders ONLY for a row whose phase is `live`; a
 * finished draft's card is unchanged, because `getLiveDraftPicks` is scoped to
 * live sessions and holds nothing for the rest.
 *
 * ⚠ `picks` IS OPTIONAL AND AN ABSENT ENTRY IS NOT AN EMPTY DRAFT. The loader is
 * only called when something is actually live, so `undefined` means "not
 * loaded", which is why the detail block is skipped entirely rather than
 * rendering "no picks recorded yet" against a draft nobody has read.
 *
 * ── The ranking rule, and why it is the clock ───────────────────────────────
 *
 * A draft is the one surface in this product with a hard, externally-imposed
 * deadline measured in seconds. So the order is: you are on the clock, then
 * somebody else is on the clock in a draft you are in, then drafts that have
 * not started, then finished ones. Everything else about a draft — your slot,
 * the round count, your queue — is context for a decision the clock is forcing.
 *
 * ── What is NOT here, and why ───────────────────────────────────────────────
 *
 * ⚠ "STARTS IN 45M" IS NOT RENDERED, BECAUSE NO SCHEDULED START TIME IS STORED.
 * `DraftSession` carries `startedAt` (the first transition to in_progress) and
 * nothing else — there is no scheduled-for column, so a countdown to a pre-draft
 * would be invented. The design shows one; this shows the draft's own status
 * instead, which is a fact.
 *
 * ⚠ AND A ZERO QUEUE IS "NOTHING BUILT HERE", NOT "UNPREPARED". The queue tables
 * are AllFantasy's own. A Sleeper draft keeps its queue on Sleeper, so an
 * imported draft reports zero because we hold nothing — see the note on
 * `DraftHqAllRow.queuedCount`. The copy says which.
 */

export type DraftHqBoardProps = {
  data: DraftHqAllData
  /** Where the footer's "View all" goes — the full picker. */
  allHref: string
  /** Total leagues on the account, for the footer's denominator. */
  totalLeagues: number
  /**
   * The tail of each LIVE draft's board and your queue for it, keyed by league.
   *
   * Optional: absent means the loader did not run (nothing is live), which is a
   * different fact from "this draft has no picks" — see the header note.
   */
  picks?: LiveDraftPicks
}

/** On the clock first, then live, then upcoming, then unknown, then done. */
function urgency(r: DraftHqAllRow): number {
  if (r.yoursOnClock) return 0
  if (r.phase === 'live') return 1
  if (r.phase === 'upcoming') return 2
  if (r.phase === 'unknown') return 3
  return 4
}

function statusOf(r: DraftHqAllRow): { label: string; sev: 'bad' | 'warn' | 'good' | 'info' } {
  if (r.yoursOnClock) return { label: 'YOU ARE ON THE CLOCK', sev: 'bad' }
  if (r.phase === 'live') {
    return {
      label:
        r.nextOverallPick != null
          ? `LIVE · PICK ${r.nextOverallPick}`
          : 'LIVE',
      sev: 'warn',
    }
  }
  if (r.phase === 'upcoming') return { label: 'NOT STARTED', sev: 'info' }
  if (r.phase === 'done') return { label: 'COMPLETE', sev: 'good' }
  /*
   * ⚠ THE RAW STATUS, NOT A GUESS. The draft-status vocabulary is inconsistent
   * across providers and across this codebase; a finished draft filed as
   * "upcoming" is a confident lie, while `post_draft_v2` is at least something a
   * reader can look up. Same rule the aggregator applies.
   */
  return { label: r.rawStatus.toUpperCase(), sev: 'info' }
}

/**
 * One derived sentence per draft.
 *
 * ⚠ COMPUTED FROM THE ROW, NEVER GENERATED. The design prints a paragraph of
 * advice per card; every clause here comes from a number already on the row, so
 * the line cannot say something the board does not show. Nothing on this screen
 * spends a token.
 */
function reasoningOf(r: DraftHqAllRow): string {
  const bits: string[] = []

  if (r.yoursOnClock) {
    bits.push('It is your pick right now.')
  } else if (r.phase === 'live' && r.onClockName) {
    bits.push(`${r.onClockName} is on the clock.`)
  } else if (r.phase === 'live') {
    bits.push('This draft is running.')
  }

  if (r.yourSlot != null && r.teamCount != null) {
    const early = r.yourSlot <= Math.max(1, Math.round(r.teamCount / 4))
    const late = r.yourSlot >= r.teamCount - Math.max(0, Math.round(r.teamCount / 4) - 1)
    if (early) bits.push(`You pick ${r.yourSlot} of ${r.teamCount} — an early slot, so the board comes to you first each round.`)
    else if (late) bits.push(`You pick ${r.yourSlot} of ${r.teamCount} — back of the order, so your picks come in pairs.`)
    else bits.push(`You pick ${r.yourSlot} of ${r.teamCount}.`)
  }

  if (r.phase !== 'done') {
    bits.push(
      r.queuedCount > 0
        ? `${r.queuedCount} ${r.queuedCount === 1 ? 'player' : 'players'} queued here.`
        : 'No queue built in AllFantasy for this one — if you keep it on the platform, that is where it is.',
    )
  }

  return bits.join(' ')
}

/**
 * The two-column live block, lifted from the retired cross-league War Room.
 *
 * ⚠ AN UNNAMED PICK IS SHOWN AS UNNAMED, NOT DROPPED. Dropping it would silently
 * shorten the board and make the pick numbers skip — a gap in our player
 * resolution reading as a gap in the draft.
 *
 * ⚠ AND THE NAME IS ONLY A CONTROL WHEN THE THREE-KEY JOIN LANDED A SLEEPER ID.
 * `PlayerName` degrades to plain text without one, which is right for a pick we
 * could not identify: an inert control promises a lookup that cannot happen.
 */
function LiveDetail({ row, picks }: { row: DraftHqAllRow; picks: LiveDraftPicks }) {
  const board = picks.byLeague[row.leagueId] ?? []
  const queue = picks.queueByLeague[row.leagueId] ?? []

  return (
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
              <span className="af-bd-asset-val">{p.isYours ? 'YOU' : (p.managerName ?? '—')}</span>
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
              AllFantasy's own — a draft that runs on Sleeper keeps its queue on
              Sleeper, so zero means we hold nothing, not that the manager is
              unprepared. See `DraftHqAllRow.queuedCount`.
            */}
            <span className="af-bd-asset-name">No queue built in AllFantasy for this draft.</span>
          </span>
        )}
      </div>
    </div>
  )
}

function Card({ row, i, picks }: { row: DraftHqAllRow; i: number; picks?: LiveDraftPicks }) {
  const status = statusOf(row)
  const label = platformLabel(row.platform)
  const format = [row.modeLabel, row.draftType].filter(Boolean).join(' · ') || null

  return (
    <li>
      <article
        className="af-bd-card"
        data-live={row.phase === 'live' ? 'true' : undefined}
        data-sev={row.yoursOnClock ? 'bad' : undefined}
      >
        <header className="af-bd-card-head">
          <span className="af-bd-rank" aria-hidden>
            {rankLabel(i)}
          </span>
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
              {format ? ` · ${format}` : null}
            </span>
          </span>
          <span className="af-bd-tag" data-sev={status.sev}>
            {status.label}
          </span>
          {/*
            The only live number on the card, and it only exists while a pick is
            genuinely running — `pickExpiresAt` is null off a live draft, so the
            countdown cannot render against a draft that is not counting.
          */}
          {row.pickExpiresAt ? <DraftClock endsAt={row.pickExpiresAt} /> : null}
        </header>

        <div className="af-bd-kvrow">
          <StatPair
            k="Your slot"
            v={row.yourSlot != null && row.teamCount != null ? `${row.yourSlot} / ${row.teamCount}` : '—'}
          />
          <StatPair k="Rounds" v={row.rounds != null ? String(row.rounds) : '—'} />
          <StatPair
            k="Picks made"
            v={row.picksMade != null ? String(row.picksMade) : '—'}
          />
          <StatPair
            k="Round"
            v={row.currentRound != null ? String(row.currentRound) : '—'}
          />
          <StatPair
            k="Queued here"
            v={String(row.queuedCount)}
            sev={row.queuedCount > 0 ? 'accent' : undefined}
          />
        </div>

        {/*
          The live tail, only for a draft that is actually running and only when
          the loader ran. See the header note on why `undefined` is skipped
          rather than rendered as an empty board.
        */}
        {row.phase === 'live' && picks ? <LiveDetail row={row} picks={picks} /> : null}

        <p className="af-bd-reason">{reasoningOf(row)}</p>

        <div className="af-bd-card-head">
          <span className="af-bd-mid" />
          <Link
            className="af-bd-cta"
            href={`/core/draft-hq?league=${encodeURIComponent(row.leagueId)}`}
          >
            {row.phase === 'live' ? 'Open the board →' : 'Open board →'}
          </Link>
        </div>
      </article>
    </li>
  )
}

export function DraftHqBoard({ data, allHref, totalLeagues, picks }: DraftHqBoardProps) {
  const rows = [...data.rows]
    .sort((a, b) => urgency(a) - urgency(b) || a.leagueName.localeCompare(b.leagueName))
    .slice(0, 10)

  const withDraft = data.rows.length

  return (
    <div className="af-bd">
      <BoardHead
        eyebrow="Core · Draft HQ"
        title="Draft HQ"
        blurb="Every draft you are in, ranked by the clock — the one on you first, then the ones running, then the ones still to come."
      />

      {rows.length > 0 ? (
        <section className="af-bd-sec" aria-labelledby="af-dh-board">
          <SectionHead
            id="af-dh-board"
            label={`Top ${rows.length} · ranked by clock`}
            count={`${data.counts.live} live · ${data.counts.upcoming} upcoming · ${data.counts.done} complete`}
          />
          <ul className="af-bd-cards">
            {rows.map((r, i) => (
              <Card key={r.leagueId} row={r} i={i} picks={picks} />
            ))}
          </ul>
        </section>
      ) : (
        <p className="af-bd-note">
          {data.withoutDraft > 0
            ? `No draft is set up in any of your ${data.withoutDraft.toLocaleString()} leagues yet.`
            : 'No draft to show yet.'}
        </p>
      )}

      {/*
        ⚠ "NO DRAFT SET UP" IS NOT AN ERROR AND IS NOT AN EMPTY CARD. Most
        leagues on a large account have already drafted or never will in
        AllFantasy; the count says so in one line rather than filling the board.
      */}
      {data.withoutDraft > 0 ? (
        <p className="af-bd-note">
          {data.withoutDraft.toLocaleString()} of your leagues carry no draft we can read — either
          it never ran through AllFantasy, or the platform has not published one.
        </p>
      ) : null}

      <FooterSummary
        hidden={Math.max(0, withDraft - rows.length)}
        total={totalLeagues}
        href={allHref}
        quiet="have a draft that is not on the clock."
      />
    </div>
  )
}

export default DraftHqBoard
