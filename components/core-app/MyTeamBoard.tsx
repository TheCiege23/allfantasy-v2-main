import Link from 'next/link'

import { formatLockLabel } from '@/lib/core-app/lockLabel'
import { lineupLink } from '@/lib/core-app/platformLinks'
import type { MyTeamPulse, MyTeamRow } from '@/lib/core-app/myTeamPulse'
import { MyTeamLockClock } from '@/components/core-app/MyTeamLockClock'
import {
  BoardHead,
  FooterSummary,
  LeagueCrest,
  RowTag,
  SectionHead,
  rankLabel,
  type Sev,
} from '@/components/core-app/boards/BoardKit'
import '@/components/core-app/af-core-boards.css'

/**
 * `/core/my-team` with no league held — the cross-league lineup board.
 *
 * "Your ten most urgent lineups across every league, ranked by time left before
 * lock." One ranked list, then a footer line accounting for every league it did
 * not show. (2026-09-07 handoff, `AF Core My Team.dc.html`.)
 *
 * ── What this replaced, and why each drop was a decision ────────────────────
 *
 * The previous version of this file was a two-column "needs you / quiet" board
 * that sat ABOVE the `PickALeague` queue and its grid of all 65+ leagues. All
 * three are gone from the default view and none is deleted:
 *
 *   the split columns  — collapsed into one ranked list. The quiet column was
 *                        five rows saying nothing needs you, which is what the
 *                        footer now says in one line.
 *   "Needs you first"  — the same severity signal this board ranks on. It was
 *                        being rendered twice on one screen.
 *   the league grid    — moved behind the footer's "View all N", which renders
 *                        unconditionally.
 *
 * ⚠ THAT LAST ONE IS LOAD-BEARING AND REVERSES A 2026-08-30 DECISION ON PURPOSE.
 * The board was made additive back then for one stated reason: a manager whose
 * lineups are all set would otherwise face an empty screen with no route into a
 * league. The footer link is that route, and it is why `FooterSummary` renders
 * even when the hidden count is zero. Do not make the CTA conditional.
 *
 * ⚠ EVERY COUNT ON A ROW IS A LOSS THAT HAS ALREADY HAPPENED OR IS CERTAIN TO.
 * An empty slot, a starter ruled out and a starter on bye all score zero, which
 * is why they share a tone and add into one urgency. A QUESTIONABLE designation
 * does not — he probably plays — so it is warning-toned, kept out of the total,
 * and never used to sort a league to the top.
 *
 * ⚠ AND A MISSING BYE CHECK IS SAID OUT LOUD. `bye: null` means this week's
 * schedule was too thin to tell a bye from a hole in our ingestion. A board that
 * renders that as "nothing on bye" is the exact failure the underlying gate
 * exists to prevent.
 */

/** How many rows the board draws. The handoff's "top 10". */
const BOARD_ROWS = 10

export type MyTeamBoardProps = {
  pulse: MyTeamPulse
  /** Injected in tests so the rendered countdown is deterministic. */
  now?: number
  /** Where the footer's "View all" goes — the full picker. */
  allHref: string
}

/** "Ghosts of Gridiron · 9 starters" — each clause dropped rather than faked. */
function detailOf(row: MyTeamRow): string {
  const parts: string[] = []
  if (row.teamName) parts.push(row.teamName)
  parts.push(`${row.starters} ${row.starters === 1 ? 'starter' : 'starters'}`)
  return parts.join(' · ')
}

/**
 * The problems, in the order a manager would fix them.
 *
 * Empty first because it is the only one with no excuse — nobody is in the slot
 * — then the two that need a replacement found, then the risk, then our own gap.
 */
function tagsOf(row: MyTeamRow): Array<{ key: string; tag: string; detail: string; sev: Sev }> {
  const out: Array<{ key: string; tag: string; detail: string; sev: Sev }> = []
  if (row.empty > 0) {
    out.push({
      key: 'empty',
      tag: String(row.empty),
      detail: row.empty === 1 ? 'slot empty' : 'slots empty',
      sev: 'bad',
    })
  }
  if (row.out > 0) out.push({ key: 'out', tag: String(row.out), detail: 'ruled out', sev: 'bad' })
  if (row.bye != null && row.bye > 0) {
    out.push({ key: 'bye', tag: String(row.bye), detail: 'on bye', sev: 'bad' })
  }
  if (row.questionable > 0) {
    out.push({ key: 'q', tag: String(row.questionable), detail: 'questionable', sev: 'warn' })
  }
  /*
   * Not a lineup problem and never toned as one — a starter we could not look
   * up is OUR gap. Shown so a short count is explained rather than quietly wrong.
   */
  if (row.unresolved > 0) {
    out.push({ key: 'unresolved', tag: String(row.unresolved), detail: 'unidentified', sev: 'info' })
  }
  return out
}

function Lock({ row, now }: { row: MyTeamRow; now: number }) {
  /*
   * ⚠ THE EM DASH NEEDS AN ACCESSIBLE NAME OR IT IS SILENCE. `title` alone is
   * not reliably announced and "—" read aloud is nothing at all, so the reason
   * travels as the label.
   */
  if (row.lockAt == null) {
    const why = 'Lock time unknown — no kickoff on file for any of these starters.'
    return (
      <span className="af-bd-stat" title={why} aria-label={why}>
        &mdash;
      </span>
    )
  }

  const atMs = new Date(row.lockAt).getTime()
  const label = formatLockLabel(atMs, now)
  const kickoff = `${new Date(atMs).toUTCString().slice(0, 22)} UTC`

  /*
   * ⚠ A DATE, NOT A COUNTDOWN, PAST `DISTANT_LOCK_DAYS`. The next kickoff we
   * hold that far out is almost certainly not this week's, so counting down to
   * it states a deadline that does not exist — every league on a 55-league
   * portfolio read "10d 8h" before this, which is a board that told you nothing.
   * The ticking clock goes with it: it re-rendered every thirty seconds to
   * redraw a date that changes once a day.
   */
  if (label.distant) {
    const why =
      `The next kickoff we hold for these starters is ${kickoff}, further out than a lineup ` +
      'lock should be — this week’s schedule has probably not been ingested yet.'
    return (
      <span className="af-bd-stat" title={why} aria-label={why}>
        {label.text}
      </span>
    )
  }

  return (
    <span
      className="af-bd-stat"
      data-sev={label.locked ? 'bad' : label.urgent ? 'bad' : 'warn'}
      title={`First kickoff ${kickoff}`}
    >
      {label.locked ? label.text : <MyTeamLockClock atMs={atMs} initial={label.text} />}
    </span>
  )
}

function Row({ row, i, now }: { row: MyTeamRow; i: number; now: number }) {
  const tags = tagsOf(row)
  /*
   * ⚠ THE CTA GOES TO THE PLATFORM, NOT INTO AllFantasy. AllFantasy is
   * read-only; the lineup is changed on Sleeper. `lineupLink` falls back to the
   * in-app screen for a native league and for any provider whose deep-link
   * format is not yet verified, so this is never a dead destination.
   */
  const fix = lineupLink({
    id: row.leagueId,
    platform: row.platform,
    platformLeagueId: row.platformLeagueId,
    season: row.leagueSeason,
    name: row.leagueName,
    teamId: row.teamId,
  })

  return (
    <li>
      <div className="af-bd-row">
        <span className="af-bd-rank" aria-hidden>
          {rankLabel(i)}
        </span>
        <LeagueCrest
          imageUrl={row.logoUrl}
          mark={row.leagueBadge}
          name={row.leagueName}
          platform={row.platform}
        />
        <Link className="af-bd-league" href={row.href}>
          <span className="af-bd-name">{row.leagueName}</span>
          <span className="af-bd-sub">
            <span className="af-bd-plat" data-platform={row.platform}>
              {row.platform.toUpperCase()}
            </span>
            {' · '}
            {detailOf(row)}
          </span>
        </Link>
        <span className="af-bd-mid">
          {tags.length > 0 ? (
            tags.map((t) => (
              <RowTag key={t.key} tag={t.tag} detail={t.detail} sev={t.sev} />
            ))
          ) : (
            /*
             * A clean lineup still says so. An empty gap here reads as "we did
             * not check", which is a much weaker claim than "we checked and
             * there is nothing wrong".
             */
            <RowTag tag="SET" detail="nothing missing" sev="good" />
          )}
        </span>
        <Lock row={row} now={now} />
        {fix ? (
          <a
            className="af-bd-cta"
            href={fix.href}
            {...(fix.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {fix.label.replace(/^Open in /, 'Open in ')} {fix.external ? '↗' : '→'}
          </a>
        ) : (
          <span className="af-bd-cta" />
        )}
      </div>
    </li>
  )
}

export function MyTeamBoard({ pulse, now, allHref }: MyTeamBoardProps) {
  const nowMs = now ?? Date.now()
  /*
   * 🛑 BOTH COLUMNS, NOT JUST THE BROKEN ONE. This read `pulse.needs` alone and
   * shipped that way — on a 94-league account where every readable lineup was
   * fine it rendered ZERO rows under a heading promising ten, because
   * "nothing is broken" and "nothing to show" had become the same thing.
   * Caught by a production screenshot, not by any test here.
   *
   * ⚠ URGENCY IS SEVERITY THEN CLOCK, WHICH IS WHY THIS IS A CONCATENATION AND
   * NOT A RE-SORT. The loader has already ordered `needs` by certain lost points
   * and `set` by soonest lock; those two orderings are not comparable to each
   * other, so merging them by any single key would be inventing a ranking
   * neither column carries. A lineup with a hole outranks a clean one because a
   * hole is a loss you can still prevent — that is the rule, and it falls out of
   * the order rather than being computed here.
   */
  const rows = [...pulse.needs, ...pulse.set].slice(0, BOARD_ROWS)
  const total = pulse.considered

  /*
   * ⚠ THREE DIFFERENT SILENCES, THREE DIFFERENT SENTENCES. "Nothing needs you",
   * "we could not read some of these" and "you hold no claimed teams" are
   * distinct facts, and collapsing them is how a board tells a manager their
   * lineups are fine when in truth it never read them.
   */
  if (total === 0) {
    return (
      <div className="af-bd">
        <BoardHead
          eyebrow="Core · My team"
          title="My team"
          blurb="Your most urgent lineups across every league, ranked by time left before lock."
        />
        <p className="af-bd-note">
          No team in any league is claimed to this account yet, so there is no lineup to
          check. <Link href="/import">Connect a platform</Link> and this board fills in.
        </p>
      </div>
    )
  }

  const unreadable = pulse.notChecked.noRoster + pulse.notChecked.noLineup
  const hidden = Math.max(0, total - rows.length)

  return (
    <div className="af-bd">
      <BoardHead
        eyebrow="Core · My team"
        title="My team"
        blurb="Your most urgent lineups across every league, ranked by time left before lock."
      />

      <section className="af-bd-sec" aria-labelledby="af-mt-board">
        <SectionHead
          id="af-mt-board"
          /*
            ⚠ "TOP 0" IS NOT A HEADING. An empty board headed "Top 0 · ranked by
            urgency" reads as a list that failed to load; the ranking rule only
            belongs on a list that has something in it.
          */
          /*
            ⚠ THE LABEL NAMES WHICH RULE IS ACTUALLY IN FORCE. With something
            broken the list leads on severity; with nothing broken it is purely
            the clock. Printing "ranked by urgency" over ten clean lineups would
            state a rule the list is not following — the same defect the trades
            board's "ranked by deadline" had over rows with no deadline.
          */
          label={
            rows.length === 0
              ? 'Needs you first'
              : pulse.needs.length > 0
                ? `Top ${rows.length} · ranked by urgency`
                : `Top ${rows.length} · nothing is broken, so ranked by lock time`
          }
          count={`${pulse.checked.toLocaleString()} of ${total.toLocaleString()} teams read`}
        />
        {rows.length > 0 ? (
          <>
            {/*
              The aggregate fact, which the per-row SET tags cannot carry. Before
              the fallback existed this was the whole body of the section; it is
              still worth saying, because "ten clean lineups" and "every lineup
              you have is clean" are different claims and only the second one
              lets a manager stop looking.
            */}
            {pulse.needs.length === 0 ? (
              <p className="af-bd-note">
                Every one of the {pulse.checked.toLocaleString()} lineups we could read is set —
                no empty slots, nobody ruled out
                {pulse.byeChecked ? ', nobody on a bye' : ''}. These are the ones locking soonest.
              </p>
            ) : null}
            <ul className="af-bd-rows">
              {rows.map((r, i) => (
                <Row key={r.leagueId} row={r} i={i} now={nowMs} />
              ))}
            </ul>
          </>
        ) : pulse.checked === 0 ? (
          /*
            🛑 THE MOST IMPORTANT BRANCH ON THIS SCREEN, AND THE FIRST VERSION GOT
            IT WRONG — caught by rendering it, not by a test. With `checked` at 0
            nothing was read at all, and "every lineup we could read is set" is
            then vacuously true and reads as "your lineups are fine". That is the
            single most damaging sentence this board could print: it tells a
            manager with four unfilled lineups that there is nothing to do.
          */
          <p className="af-bd-note">
            <strong>We could not read a single lineup.</strong> Nothing below is a verdict on your
            teams — it is a gap in what we hold. The line under this says which.
          </p>
        ) : (
          <p className="af-bd-note">
            Every one of the {pulse.checked.toLocaleString()} lineups we could read is set — no
            empty slots, nobody ruled out
            {pulse.byeChecked ? ', nobody on a bye' : ''}.
          </p>
        )}
      </section>

      {/*
        ⚠ THE UNREADABLE COUNT IS ITS OWN LINE, NOT FOLDED INTO THE FOOTER. A
        team whose roster was never imported has not been checked and found
        clean; putting it in the same sentence as "nothing needs you there" is
        the claim this whole loader refuses to make.
      */}
      {unreadable > 0 ? (
        <p className="af-bd-note">
          <strong>
            {unreadable} of your {total.toLocaleString()} claimed{' '}
            {total === 1 ? 'team' : 'teams'} could not be checked.
          </strong>{' '}
          {/* Singular counts read as broken copy on a screen full of real numbers. */}
          {pulse.notChecked.noRoster > 0
            ? `${pulse.notChecked.noRoster} ${pulse.notChecked.noRoster === 1 ? 'has' : 'have'} no roster imported`
            : ''}
          {pulse.notChecked.noRoster > 0 && pulse.notChecked.noLineup > 0 ? ' and ' : ''}
          {pulse.notChecked.noLineup > 0
            ? `${pulse.notChecked.noLineup} ${pulse.notChecked.noLineup === 1 ? 'has' : 'have'} a roster but no starting lineup on file`
            : ''}
          . That is a gap in what we hold, not a verdict on those lineups —{' '}
          <Link href="/core/sync">re-sync</Link> to close it.
        </p>
      ) : null}

      {!pulse.byeChecked ? (
        <p className="af-bd-note">
          The bye check did not run this week — the ingested schedule was too incomplete to
          tell a bye from a gap in our own data, so no row claims to be bye-clear.
        </p>
      ) : null}

      <FooterSummary
        hidden={hidden}
        total={total}
        href={allHref}
        quiet={
          unreadable > 0
            ? 'are either set or could not be read — the line above says which.'
            : 'are set — nothing needs you there.'
        }
      />
    </div>
  )
}

export default MyTeamBoard
