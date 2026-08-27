import Link from 'next/link'
import type { LeagueWeekBoard, LeagueSideline } from '@/lib/core-app/weekBoard'
import '@/components/core-app/af-week-league.css'

/**
 * Screen 38a·3 — Your Week, scoped to one league.
 *
 * The cross-league board answers "which of my nine leagues needs a decision".
 * This answers "what is happening in this one" — one hero matchup, then the
 * league's other five games. Both are useful and neither replaces the other,
 * which is why they share a nav key rather than one retiring the other.
 *
 * ⚠ THE SIDELINE GAMES ARE NOT NEW DATA. `pairRows` in weekBoard already pairs
 * every matchup in the week; the cross-league loop drops any pair the user is
 * not in. They were being computed and thrown away one line later.
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

export function YourWeekLeague({ board, allWeeksHref }: YourWeekLeagueProps) {
  const { yours, sidelines, rivalry } = board
  const proj = yours?.projection ?? null

  return (
    <div className="af-wl">
      <header className="af-wl-head">
        <p className="af-label af-wl-eyebrow">{board.leagueName}</p>
        <div className="af-wl-title-row">
          <h1 className="af-display af-wl-title">Your week</h1>
          <span className="af-wl-week af-num">
            {board.season} · Week {board.week}
          </span>
        </div>
        <p className="af-wl-sub">
          This league&apos;s board. <Link href={allWeeksHref}>Every league at once →</Link>
        </p>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      {yours ? (
        <section className="af-wl-hero" aria-label="Your matchup">
          <div className="af-wl-hero-sides">
            <div className="af-wl-side" data-you="true">
              <span className="af-label">You</span>
              <span className="af-wl-side-name">Your team</span>
              <span className="af-wl-side-proj af-num">
                {proj ? n1(proj.you) : '—'}
              </span>
            </div>

            <div className="af-wl-vs">
              <span className="af-wl-vs-mark af-num" aria-hidden>
                vs
              </span>
              {proj ? (
                <span className="af-wl-margin af-num" data-dir={proj.margin >= 0 ? 'up' : 'down'}>
                  {proj.margin >= 0 ? '+' : '−'}
                  {n1(Math.abs(proj.margin))}
                </span>
              ) : null}
            </div>

            <div className="af-wl-side">
              <span className="af-label">Opponent</span>
              <span className="af-wl-side-name">{yours.opponent.name ?? 'Unnamed team'}</span>
              <span className="af-wl-side-proj af-num">{proj ? n1(proj.them) : '—'}</span>
            </div>
          </div>

          {/*
            ⚠ THE PROJECTION IS WITHHELD, NOT ZEROED, WHEN THERE IS NO SAMPLE.
            A win probability is the most confident-looking number on this
            screen; printing 50% for "we have never seen either team play" would
            be a coin flip presented as an analysis.
          */}
          {proj ? (
            <div className="af-wl-prob">
              <span className="af-label">Win probability</span>
              <span className="af-wl-prob-bar" aria-hidden>
                <span
                  className="af-wl-prob-you"
                  style={{ width: `${pct(proj.winProbability)}%` }}
                />
              </span>
              <span className="af-wl-prob-v af-num">{pct(proj.winProbability)}%</span>
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
          {rivalry ? (
            <div className="af-wl-rivalry" data-tone={rivalryTone(rivalry.wins, rivalry.losses)}>
              <span className="af-label">All-time</span>
              <span className="af-wl-rivalry-rec af-num">
                {rivalry.wins}—{rivalry.losses}
              </span>
              <p className="af-wl-rivalry-note">{describeRivalry(rivalry)}</p>
            </div>
          ) : (
            <div className="af-wl-rivalry" data-tone="none">
              <span className="af-label">All-time</span>
              <span className="af-wl-rivalry-rec af-num">—</span>
              {/*
                Never met is a real fact, and a different one from 0-0. A first
                meeting is worth saying out loud rather than rendering as an
                empty record.
              */}
              <p className="af-wl-rivalry-note">
                You have never played {yours.opponent.name ?? 'this team'} before — first meeting on
                file.
              </p>
            </div>
          )}

          <Link href={yours.href} className="af-btn af-wl-hero-cta">
            Open the matchup
          </Link>
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
          <h2 className="af-label">The rest of the league</h2>
          <span className="af-wl-rest-note">
            {sidelines.length > 0 ? 'Closest games first' : null}
          </span>
        </header>

        {sidelines.length > 0 ? (
          <div className="af-wl-grid">
            {sidelines.map((m) => (
              <Sideline key={`${m.a.rosterId}-${m.b.rosterId}`} m={m} />
            ))}
          </div>
        ) : (
          <p className="af-wl-rest-why">
            No other matchups are on file for this week in {board.leagueName}.
          </p>
        )}
      </section>
    </div>
  )
}

function Sideline({ m }: { m: LeagueSideline }) {
  const aLeads = m.aWinProbability != null && m.aWinProbability >= 0.5
  return (
    <article className="af-wl-card">
      <div className="af-wl-card-row" data-lead={aLeads}>
        <span className="af-wl-card-name">{m.a.name ?? 'Unnamed team'}</span>
        <span className="af-wl-card-proj af-num">
          {m.a.projected != null ? n1(m.a.projected) : '—'}
        </span>
      </div>
      <div className="af-wl-card-row" data-lead={m.aWinProbability != null && !aLeads}>
        <span className="af-wl-card-name">{m.b.name ?? 'Unnamed team'}</span>
        <span className="af-wl-card-proj af-num">
          {m.b.projected != null ? n1(m.b.projected) : '—'}
        </span>
      </div>
      {m.aWinProbability != null ? (
        <div className="af-wl-card-bar" aria-hidden>
          <span style={{ width: `${pct(m.aWinProbability)}%` }} />
        </div>
      ) : (
        <p className="af-wl-card-why">not projected — too few scored weeks</p>
      )}
    </article>
  )
}

function rivalryTone(wins: number, losses: number): 'up' | 'down' | 'even' {
  if (wins > losses) return 'up'
  if (losses > wins) return 'down'
  return 'even'
}

function describeRivalry(r: { wins: number; losses: number; meetings: number; averageMargin: number }): string {
  const meetings = `${r.meetings} ${r.meetings === 1 ? 'meeting' : 'meetings'}`
  const margin = Math.abs(r.averageMargin)
  const side = r.averageMargin >= 0 ? 'you' : 'them'

  if (r.wins > r.losses) {
    return `You lead the series over ${meetings}, by an average of ${n1(margin)} when ${side === 'you' ? 'you win' : 'it goes their way'}.`
  }
  if (r.losses > r.wins) {
    return `They lead the series over ${meetings}. Average margin ${n1(margin)} in ${side === 'you' ? 'your' : 'their'} favour across all of them.`
  }
  return `Dead even over ${meetings}, decided by ${n1(margin)} on average.`
}

export default YourWeekLeague
