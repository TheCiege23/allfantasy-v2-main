import Link from 'next/link'
import type { LeagueWeekBoard, LeagueSideline } from '@/lib/core-app/weekBoard'
import '@/components/core-app/af-week-league.css'

/**
 * Screen 38a·3 — Your Week, scoped to one league.
 *
 * The cross-league board answers "which of my leagues needs a decision". This
 * answers "what is happening in this one" — one hero matchup, then the rest of
 * the league's games. Both are useful and neither replaces the other, which is
 * why they share a nav key rather than one retiring the other.
 *
 * ⚠ THE SIDELINE GAMES ARE NOT NEW DATA. `pairRows` in weekBoard already pairs
 * every matchup in the week; the cross-league loop drops any pair the user is
 * not in. They were being computed and thrown away one line later.
 *
 * ── What the 38a design shows and this deliberately does NOT ─────────────
 *
 * Three elements of the mockup have no data behind them and are omitted rather
 * than filled:
 *
 *   · "YOUR TOP PROJECTED — S. Barkley, proj 15.2 pts · RB1". Per-player weekly
 *     scoring is not ingested for imported leagues, which is most leagues here,
 *     and the Matchup screen already says so in as many words.
 *   · The opponent's handle ("@kingbuffalo"). No handle is stored anywhere.
 *   · The kickoff chip ("Kicks off Sun 1:00 PM ET"). Kickoff lives in
 *     SportsGame, which carries four rows per fixture and joins display names
 *     against abbreviations; a confidently wrong kickoff time is worse than
 *     none, and this screen is not where that join should be attempted first.
 *
 * Filling any of them would make the screen look finished while stating
 * something untrue — the failure this suite exists to avoid. They are recorded
 * here so the omission reads as a decision rather than an oversight.
 */

export type YourWeekLeagueProps = {
  board: LeagueWeekBoard
  /** Link back to the cross-league view, which this does not replace. */
  allWeeksHref: string
}

function n1(v: number): string {
  return v.toFixed(1)
}

function pct(p: number): number {
  return Math.round(p * 100)
}

/**
 * Up to two initials from a team name.
 *
 * ⚠ Array.from, NOT slice. League team names very often start with an emoji,
 * and slicing one mid-surrogate serialises differently on server and client —
 * which takes hydration down rather than merely looking wrong.
 */
function initials(name: string | null): string {
  if (!name) return '—'
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '—'
  const first = Array.from(words[0])[0] ?? ''
  const second = words.length > 1 ? (Array.from(words[1])[0] ?? '') : ''
  return (first + second).toUpperCase()
}

function recordOf(board: LeagueWeekBoard, rosterId: number | null | undefined): string | null {
  if (rosterId == null) return null
  const r = board.records[rosterId]
  // Absent means "no scored games". That is not 0-0 and must not render as it.
  return r ? `${r.wins}—${r.losses}` : null
}

export function YourWeekLeague({ board, allWeeksHref }: YourWeekLeagueProps) {
  const { yours, sidelines, rivalry } = board
  const proj = yours?.projection ?? null
  const yourRecord = recordOf(board, board.yourRosterId)
  const oppRecord = recordOf(board, yours?.opponent.rosterId)
  const yourName = board.yourTeamName ?? 'Your team'

  return (
    <div className="af-wl">
      <header className="af-wl-head">
        <p className="af-label af-wl-eyebrow">
          {board.leagueName} · Week {board.week}
        </p>
        <div className="af-wl-title-row">
          <h1 className="af-display af-wl-title">Your week</h1>
          <Link href={allWeeksHref} className="af-wl-allweeks">
            Every league at once →
          </Link>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      {yours ? (
        <section className="af-wl-hero" aria-label="Your matchup">
          <div className="af-wl-hero-top">
            <span className="af-label af-wl-chip">Your matchup</span>
            {yours.elimination ? (
              <span className="af-label af-wl-chip" data-tone="bad">
                Elimination
              </span>
            ) : null}
            <span className="af-wl-spacer" />
            <Link href={yours.href} className="af-wl-action">
              Open the matchup →
            </Link>
          </div>

          <div className="af-wl-sides">
            <div className="af-wl-side" data-you="true">
              <span className="af-wl-avatar" aria-hidden>
                YOU
              </span>
              <span className="af-wl-side-id">
                <span className="af-wl-side-name">{yourName}</span>
                {yourRecord ? <span className="af-wl-side-rec af-num">{yourRecord}</span> : null}
              </span>
              <span className="af-wl-side-proj af-num">{proj ? n1(proj.you) : '—'}</span>
            </div>

            <span className="af-wl-vs af-label" aria-hidden>
              vs
            </span>

            <div className="af-wl-side">
              <span className="af-wl-avatar" aria-hidden>
                {initials(yours.opponent.name)}
              </span>
              <span className="af-wl-side-id">
                <span className="af-wl-side-name">{yours.opponent.name ?? 'Unnamed team'}</span>
                {oppRecord ? <span className="af-wl-side-rec af-num">{oppRecord}</span> : null}
              </span>
              <span className="af-wl-side-proj af-num">{proj ? n1(proj.them) : '—'}</span>
            </div>
          </div>

          {/*
            ⚠ THE PROJECTION IS WITHHELD, NOT ZEROED, WHEN THERE IS NO SAMPLE.
            A win probability is the most confident-looking number on this
            screen; printing 50% for "we have never seen either team play"
            would be a coin flip presented as an analysis.
          */}
          {proj ? (
            <div className="af-wl-prob">
              <div className="af-wl-prob-row">
                <span className="af-label">Win probability</span>
                <span className="af-wl-prob-read af-num">
                  You {pct(proj.winProbability)}% · {yours.opponent.name ?? 'Them'}{' '}
                  {100 - pct(proj.winProbability)}%
                </span>
              </div>
              <span className="af-wl-prob-bar" aria-hidden>
                <span className="af-wl-prob-you" style={{ width: `${pct(proj.winProbability)}%` }} />
              </span>
              <div className="af-wl-prob-row">
                <span className="af-wl-prob-sub">Projected margin</span>
                <span className="af-wl-margin af-num" data-dir={proj.margin >= 0 ? 'up' : 'down'}>
                  {proj.margin >= 0 ? '+' : '−'}
                  {n1(Math.abs(proj.margin))} PTS
                </span>
              </div>
            </div>
          ) : (
            <div className="af-wl-prob" data-missing="true">
              <span className="af-label">Win probability</span>
              <span className="af-wl-prob-why">
                {yours.yourSampleWeeks === 0
                  ? 'neither team has a scored week on file yet, so there is nothing to project from'
                  : `only ${yours.yourSampleWeeks} scored ${
                      yours.yourSampleWeeks === 1 ? 'week' : 'weeks'
                    } on file — too thin to price this`}
              </span>
            </div>
          )}

          {/* ── Rivalry ─────────────────────────────────────────────── */}
          <div
            className="af-wl-rivalry"
            data-tone={rivalry ? rivalryTone(rivalry.wins, rivalry.losses) : 'none'}
          >
            <span className="af-label af-wl-rivalry-tag">
              {rivalry ? `All-time ${rivalry.wins}—${rivalry.losses}` : 'All-time'}
            </span>
            <p className="af-wl-rivalry-note">
              {rivalry
                ? describeRivalry(rivalry, yours.opponent.name)
                : /*
                     Never met is a real fact, and a different one from 0-0. A
                     first meeting is worth saying out loud rather than
                     rendering as an empty record.
                   */
                  `You have never played ${
                    yours.opponent.name ?? 'this team'
                  } before — first meeting on file.`}
            </p>
          </div>
        </section>
      ) : (
        <section className="af-wl-hero" data-empty="true">
          <h2 className="af-label">Your matchup</h2>
          <p className="af-wl-hero-why">
            You have no game on file in week {board.week}. That is either a bye or a week whose
            schedule has not synced — the rest of the league&apos;s board is below either way.
          </p>
        </section>
      )}

      {/* ── The rest of the league ──────────────────────────────────── */}
      <section className="af-wl-rest">
        <header className="af-wl-rest-head">
          <h2 className="af-label">Rest of {board.leagueName}</h2>
          <span className="af-wl-rest-note">
            {sidelines.length > 0
              ? `${sidelines.length} other ${
                  sidelines.length === 1 ? 'matchup' : 'matchups'
                } · closest first`
              : null}
          </span>
        </header>

        {sidelines.length > 0 ? (
          <div className="af-wl-grid">
            {sidelines.map((m) => (
              <Sideline key={`${m.a.rosterId}-${m.b.rosterId}`} m={m} board={board} />
            ))}
          </div>
        ) : (
          <p className="af-wl-rest-why">
            No other matchups are on file for this week in {board.leagueName}.
          </p>
        )}
      </section>

      {/*
        The basis line, so any number above can be traced to what produced it.
        It says what the model IS rather than dressing it up — a normal
        approximation over scored weeks, not a simulation.
      */}
      {proj ? (
        <p className="af-wl-basis">
          Win probability is a normal approximation over each team&apos;s scored weeks in{' '}
          {board.leagueName}, on this league&apos;s own scoring. It is not a simulation, and it
          knows nothing about injuries or byes.
        </p>
      ) : null}
    </div>
  )
}

function Sideline({ m, board }: { m: LeagueSideline; board: LeagueWeekBoard }) {
  const aLeads = m.aWinProbability != null && m.aWinProbability >= 0.5
  const aRec = recordOf(board, m.a.rosterId)
  const bRec = recordOf(board, m.b.rosterId)

  return (
    <article className="af-wl-card">
      <div className="af-wl-card-row" data-lead={aLeads}>
        <span className="af-wl-card-name">{m.a.name ?? 'Unnamed team'}</span>
        {aRec ? <span className="af-wl-card-rec af-num">{aRec}</span> : null}
        <span className="af-wl-card-proj af-num">
          {m.a.projected != null ? n1(m.a.projected) : '—'}
        </span>
      </div>

      {m.aWinProbability != null ? (
        <div className="af-wl-card-bar" aria-hidden>
          <span style={{ width: `${pct(m.aWinProbability)}%` }} />
        </div>
      ) : null}

      <div className="af-wl-card-row" data-lead={m.aWinProbability != null && !aLeads}>
        <span className="af-wl-card-name">{m.b.name ?? 'Unnamed team'}</span>
        {bRec ? <span className="af-wl-card-rec af-num">{bRec}</span> : null}
        <span className="af-wl-card-proj af-num">
          {m.b.projected != null ? n1(m.b.projected) : '—'}
        </span>
      </div>

      {m.aWinProbability == null ? (
        <p className="af-wl-card-why">not projected — too few scored weeks</p>
      ) : null}
    </article>
  )
}

function rivalryTone(wins: number, losses: number): 'up' | 'down' | 'even' {
  if (wins > losses) return 'up'
  if (losses > wins) return 'down'
  return 'even'
}

/**
 * The rivalry sentence.
 *
 * ⚠ EVERY CLAUSE COMES FROM A STORED NUMBER. The design's line reads like
 * colour — "They own you all-time · statement week if you can take this one" —
 * and it would be easy to write copy in that voice with nothing behind it.
 * Meetings, the win/loss split and the average margin are all real. Nothing
 * here asserts anything they do not support.
 */
function describeRivalry(
  r: { wins: number; losses: number; meetings: number; averageMargin: number },
  oppName: string | null,
): string {
  const them = oppName ?? 'They'
  const meetings = `${r.meetings} ${r.meetings === 1 ? 'meeting' : 'meetings'}`
  const margin = Math.abs(r.averageMargin).toFixed(1)

  if (r.losses > r.wins) {
    return `${them} lead the series over ${meetings}, by ${margin} on average. Taking this one would be a statement.`
  }
  if (r.wins > r.losses) {
    return `You lead the series over ${meetings}, by ${margin} on average.`
  }
  return `Dead even over ${meetings}, decided by ${margin} on average.`
}

export default YourWeekLeague
