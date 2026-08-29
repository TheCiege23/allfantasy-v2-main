import Link from 'next/link'

import { formatLockLabel } from '@/lib/core-app/lockLabel'
import type { MyTeamPulse, MyTeamRow } from '@/lib/core-app/myTeamPulse'
import { MyTeamLockClock } from '@/components/core-app/MyTeamLockClock'
import '@/components/core-app/af-my-team-board.css'

/**
 * "Lineups that need you" — the cross-league my-team board.
 *
 * Sits above the existing "Needs you first" queue and league picker on
 * `/core/my-team`, the same way the matchup pulse does on `/core/matchup`, and
 * leaves both of them alone.
 *
 * ⚠ EVERY COUNT ON A ROW IS A LOSS THAT HAS ALREADY HAPPENED OR IS CERTAIN TO.
 * An empty slot, a starter ruled out and a starter on bye all score zero, which
 * is why they share a colour and add up into one urgency. A QUESTIONABLE
 * designation does not — he probably plays — so it is rendered in the warning
 * tone, kept out of the total, and never used to sort a league to the top.
 *
 * ⚠ AND A MISSING BYE CHECK IS SAID OUT LOUD. `bye: null` means this week's
 * schedule was too thin to tell a bye from a hole in our ingestion. A board that
 * silently renders that as "nothing on bye" is the exact failure the underlying
 * gate exists to prevent, so the note under the header states it instead.
 */

export type MyTeamBoardProps = {
  pulse: MyTeamPulse
  /** Injected in tests so the rendered countdown is deterministic. */
  now?: number
}

/** The crest, or the initials that are the genuine fallback for a missing one. */
function Crest({ row }: { row: MyTeamRow }) {
  return row.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="af-mtb-crest" src={row.logoUrl} alt="" width={30} height={30} loading="lazy" />
  ) : (
    <span className="af-mtb-crest af-mtb-crest--none" data-platform={row.platform} aria-hidden>
      {row.leagueBadge}
    </span>
  )
}

/**
 * "Ghosts of Gridiron · 9 starters".
 *
 * Each clause is dropped rather than faked when its source is absent: a league
 * that never published a team name stays unnamed rather than borrowing the
 * league's own.
 */
function metaOf(row: MyTeamRow): string {
  const parts: string[] = []
  if (row.teamName) parts.push(row.teamName)
  parts.push(`${row.starters} ${row.starters === 1 ? 'starter' : 'starters'}`)
  if (row.week != null) parts.push(`wk ${row.week}`)
  return parts.join(' · ')
}

/**
 * The problem chips, in the order a manager would fix them.
 *
 * Empty first because it is the only one with no excuse — nobody is in the
 * slot — then the two that need a replacement found, then the risk.
 */
function chipsOf(row: MyTeamRow): Array<{ key: string; text: string; tone: 'bad' | 'warn' | 'quiet' }> {
  const out: Array<{ key: string; text: string; tone: 'bad' | 'warn' | 'quiet' }> = []
  if (row.empty > 0) out.push({ key: 'empty', text: `${row.empty} empty`, tone: 'bad' })
  if (row.out > 0) out.push({ key: 'out', text: `${row.out} out`, tone: 'bad' })
  if (row.bye != null && row.bye > 0) out.push({ key: 'bye', text: `${row.bye} bye`, tone: 'bad' })
  if (row.questionable > 0) {
    out.push({ key: 'q', text: `${row.questionable} Q`, tone: 'warn' })
  }
  /*
   * Not a lineup problem and never coloured as one — a starter we could not
   * look up is OUR gap. It is shown so a short count is explained rather than
   * quietly wrong.
   */
  if (row.unresolved > 0) {
    out.push({ key: 'unresolved', text: `${row.unresolved} unknown`, tone: 'quiet' })
  }
  return out
}

function Lock({ row, now }: { row: MyTeamRow; now: number }) {
  /*
   * ⚠ THE EM DASH NEEDS AN ACCESSIBLE NAME OR IT IS SILENCE. `title` alone is
   * not reliably announced, and "—" read aloud is nothing at all — so the
   * reason travels as the label, matching what `af-mt-status` already does on
   * the per-league screen.
   */
  if (row.lockAt == null) {
    const why =
      'Lock time unknown — no kickoff on file for any of these starters.'
    return (
      <span className="af-mtb-lock af-num" data-state="unknown" title={why} aria-label={why}>
        &mdash;
      </span>
    )
  }

  const atMs = new Date(row.lockAt).getTime()
  const label = formatLockLabel(atMs, now)
  const kickoff = `${new Date(atMs).toUTCString().slice(0, 22)} UTC`

  return (
    <span
      className="af-mtb-lock af-num"
      data-state={label.locked ? 'locked' : label.urgent ? 'urgent' : 'open'}
      title={`First kickoff ${kickoff}`}
    >
      {label.locked ? (
        label.text
      ) : (
        <MyTeamLockClock atMs={atMs} initial={label.text} />
      )}
    </span>
  )
}

function Row({ row, tone, now }: { row: MyTeamRow; tone: 'bad' | 'good'; now: number }) {
  const chips = chipsOf(row)
  return (
    <li>
      <Link className="af-mtb-row" href={row.href} data-tone={tone} data-locked={row.locked}>
        <Crest row={row} />
        <span className="af-mtb-text">
          <span className="af-mtb-league">{row.leagueName}</span>
          <span className="af-mtb-meta">{metaOf(row)}</span>
        </span>
        {chips.length > 0 ? (
          <span className="af-mtb-chips">
            {chips.map((c) => (
              <span key={c.key} className="af-mtb-chip" data-tone={c.tone}>
                {c.text}
              </span>
            ))}
          </span>
        ) : (
          /*
           * A clean lineup still says so. An empty gap here reads as "we did not
           * check", which is a different and much weaker claim than "we checked
           * and there is nothing wrong".
           */
          <span className="af-mtb-chips">
            <span className="af-mtb-chip" data-tone="good">
              set
            </span>
          </span>
        )}
        <Lock row={row} now={now} />
      </Link>
    </li>
  )
}

/** "we could not check for byes" — never a silent pass. */
function byeNote(pulse: MyTeamPulse): string | null {
  if (pulse.checked === 0 || pulse.byeChecked) return null
  return 'This week’s schedule is not complete enough for us to tell a bye from a gap in our own data, so no lineup below was checked for byes.'
}

/** "we could not check six of them, and here is why" — never a silent short list. */
function gapNote(pulse: MyTeamPulse): string | null {
  const { noRoster, noLineup } = pulse.notChecked
  const parts: string[] = []
  if (noRoster > 0) parts.push(`${noRoster} have no roster imported`)
  if (noLineup > 0) parts.push(`${noLineup} carry no starting lineup`)
  if (parts.length === 0) return null
  return `Not checked: ${parts.join(', ')}.`
}

/** "+3 more" when a column is capped. The header count is the whole truth. */
function More({ shown, total, noun }: { shown: number; total: number; noun: string }) {
  if (total <= shown) return null
  return (
    <p className="af-mtb-more">
      {total - shown} more {noun}. Pick a league below to see it.
    </p>
  )
}

export function MyTeamBoard({ pulse, now = Date.now() }: MyTeamBoardProps) {
  const bye = byeNote(pulse)
  const gap = gapNote(pulse)

  return (
    <section className="af-mtb" aria-labelledby="af-mtb-head">
      <header className="af-mtb-head">
        <h2 className="af-label" id="af-mtb-head">
          Lineups that need you
        </h2>
        <span className="af-mtb-rule" aria-hidden />
        <span className="af-mtb-count">
          {pulse.needsTotal} need a change · {pulse.setTotal} set
        </span>
      </header>

      {bye ? <p className="af-mtb-basis">{bye}</p> : null}

      {pulse.checked > 0 ? (
        <div className="af-mtb-cols">
          <div className="af-mtb-col">
            <h3 className="af-label af-mtb-col-head" data-tone="bad">
              Needs a change · soonest lock
            </h3>
            {pulse.needs.length > 0 ? (
              <>
                <ul className="af-mtb-rows">
                  {pulse.needs.map((r) => (
                    <Row key={r.leagueId} row={r} tone="bad" now={now} />
                  ))}
                </ul>
                <More shown={pulse.needs.length} total={pulse.needsTotal} noun="need a change" />
              </>
            ) : (
              <p className="af-mtb-quiet">
                Nothing empty, out or on bye in any lineup we could read. Every starting slot is
                filled with somebody who is playing.
              </p>
            )}
          </div>

          <div className="af-mtb-col">
            <h3 className="af-label af-mtb-col-head" data-tone="good">
              Set · next to lock
            </h3>
            {pulse.set.length > 0 ? (
              <>
                <ul className="af-mtb-rows">
                  {pulse.set.map((r) => (
                    <Row key={r.leagueId} row={r} tone="good" now={now} />
                  ))}
                </ul>
                <More shown={pulse.set.length} total={pulse.setTotal} noun="set" />
              </>
            ) : (
              <p className="af-mtb-quiet">
                Every lineup we could read has something wrong with it right now.
              </p>
            )}
          </div>
        </div>
      ) : (
        /*
         * ⚠ "NOTHING TO CHECK" AND "NOTHING IS WRONG" ARE DIFFERENT FACTS. A
         * user with sixty leagues whose rosters never imported and a user with
         * no claimed team at all must not read the same sentence, so the count
         * is stated either way.
         */
        <p className="af-mtb-quiet">
          {pulse.considered > 0
            ? `None of your ${pulse.considered} claimed teams has a starting lineup we can read yet.`
            : 'No claimed team yet, so there is no lineup to check. Claim your team in a league and it appears here.'}
        </p>
      )}

      {gap ? <p className="af-mtb-gap">{gap}</p> : null}
    </section>
  )
}

export default MyTeamBoard
