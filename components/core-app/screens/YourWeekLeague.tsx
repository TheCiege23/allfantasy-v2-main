'use client'

import Link from 'next/link'
import type { LeagueWeekBoard, LeagueSideline } from '@/lib/core-app/weekBoard'
import type { WeekLineups } from '@/lib/core-app/weekLineups'
import { WeekLineupLine } from '@/components/core-app/screens/WeekLineupLine'
import '@/components/core-app/af-week-league.css'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { TopicTip } from '@/components/core-app/TopicTip'

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
  /** This week's AF and API lineup projections — the rail's read. Optional; absent draws none. */
  lineups?: WeekLineups | null
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

/**
 * A team's avatar, or its initials when there is none.
 *
 * ⚠ THE URL IS ALREADY RESOLVED. The loader runs every avatar through
 * `managerArtUrl`, so a Sleeper avatar id has been expanded and anything it
 * could not interpret is null. Null is the common case for non-Sleeper
 * leagues, and initials are its correct rendering — not a broken `<img>`.
 */
function TeamAvatar({
  url,
  fallback,
  className,
  px,
}: {
  url: string | null | undefined
  fallback: string
  className: string
  px: number
}) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={`${className} ${className}--img`}
        src={url}
        alt=""
        width={px}
        height={px}
        loading="lazy"
      />
    )
  }
  return (
    <span className={className} aria-hidden>
      {fallback}
    </span>
  )
}

function recordOf(board: LeagueWeekBoard, rosterId: string | null | undefined): string | null {
  if (rosterId == null) return null
  const r = board.records[rosterId]
  // Absent means "no scored games". That is not 0-0 and must not render as it.
  return r ? `${r.wins}—${r.losses}${r.ties ? `—${r.ties}` : ''}` : null
}

export function YourWeekLeague({ board, allWeeksHref, lineups }: YourWeekLeagueProps) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const copy = (english: string) => coreUiCopy(english, language)
  const { yours, sidelines, rivalry } = board
  const proj = yours?.projection ?? null
  const live = yours?.live ?? null
  const score = live ?? proj
  const yourRecord = recordOf(board, board.yourRosterId)
  const oppRecord = recordOf(board, yours?.opponent.rosterId)
  const yourName = board.yourTeamName ?? copy('Your team')

  return (
    <div className="af-wl">
      <header className="af-wl-head">
        <p className="af-label af-wl-eyebrow">
          {board.leagueName} · {board.season} · {es ? 'Período' : 'Period'} {board.week}
        </p>
        <div className="af-wl-title-row">
          <h1 className="af-display af-wl-title">{copy('Your week')}</h1>
          <Link href={allWeeksHref} className="af-wl-allweeks">
            {copy('Every league at once')} →
          </Link>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      {yours ? (
        <section className="af-wl-hero" aria-label={copy('Your matchup')}>
          <div className="af-wl-hero-top">
            <span className="af-label af-wl-chip">{copy('Your matchup')}</span>
            {yours.elimination ? (
              <span className="af-label af-wl-chip" data-tone="bad">
                {copy('Elimination')}
              </span>
            ) : null}
            <span className="af-wl-spacer" />
            <Link href={yours.href} className="af-wl-action">
              {copy('Open the matchup')} →
            </Link>
          </div>

          <div className="af-wl-sides">
            <div className="af-wl-side" data-you="true">
              <TeamAvatar url={board.yourAvatarUrl} fallback={es ? 'TÚ' : 'YOU'} className="af-wl-avatar" px={44} />
              <span className="af-wl-side-id">
                <span className="af-wl-side-name">{yourName}</span>
                {yourRecord ? <span className="af-wl-side-rec af-num">{yourRecord}</span> : null}
              </span>
              <span className="af-wl-side-proj af-num">{score ? n1(score.you) : '—'}</span>
            </div>

            <span className="af-wl-vs af-label" aria-hidden>
              {copy('vs')}
            </span>

            <div className="af-wl-side">
              <TeamAvatar
                url={yours.opponent.avatarUrl}
                fallback={initials(yours.opponent.name)}
                className="af-wl-avatar"
                px={44}
              />
              <span className="af-wl-side-id">
                <span className="af-wl-side-name">{yours.opponent.name ?? copy('Unnamed team')}</span>
                {oppRecord ? <span className="af-wl-side-rec af-num">{oppRecord}</span> : null}
              </span>
              <span className="af-wl-side-proj af-num">{score ? n1(score.them) : '—'}</span>
            </div>
          </div>

          {/*
            ⚠ THE PROJECTION IS WITHHELD, NOT ZEROED, WHEN THERE IS NO SAMPLE.
            A win probability is the most confident-looking number on this
            screen; printing 50% for "we have never seen either team play"
            would be a coin flip presented as an analysis.
          */}
          {live ? <div className="af-wl-prob"><span className="af-label">{es ? 'Marcador actual' : 'Current scoreboard'}</span><p>{live.final ? live.margin > 0 ? es ? 'Victoria' : 'Won' : live.margin < 0 ? es ? 'Derrota' : 'Lost' : es ? 'Empate' : 'Tied' : es ? 'En juego; el resultado sigue abierto.' : 'In progress; the result is still open.'}</p></div> : proj ? (
            <div className="af-wl-prob">
              <div className="af-wl-prob-row">
                <span className="af-label">
                  {es ? 'Probabilidad según el historial' : 'History-based win probability'} <TopicTip topic="weekWinProbability" />
                </span>
                <span className="af-wl-prob-read af-num">
                  {copy('You')} {pct(proj.winProbability)}% · {yours.opponent.name ?? copy('Them')}{' '}
                  {100 - pct(proj.winProbability)}%
                </span>
              </div>
              <span className="af-wl-prob-bar" aria-hidden>
                <span className="af-wl-prob-you" style={{ width: `${pct(proj.winProbability)}%` }} />
              </span>
              <div className="af-wl-prob-row">
                <span className="af-wl-prob-sub">{es ? 'Diferencia histórica estimada' : 'Historical scoring estimate'}</span>
                <span className="af-wl-margin af-num" data-dir={proj.margin >= 0 ? 'up' : 'down'}>
                  {proj.margin >= 0 ? '+' : '−'}
                  {n1(Math.abs(proj.margin))} PTS
                </span>
              </div>
            </div>
          ) : (
            <div className="af-wl-prob" data-missing="true">
              <span className="af-label">
                {copy('Win probability')} <TopicTip topic="weekWinProbability" />
              </span>
              <span className="af-wl-prob-why">
                {yours.yourSampleWeeks === 0
                  ? copy('neither team has a scored week on file yet, so there is nothing to project from')
                  : es
                    ? `Solo hay ${yours.yourSampleWeeks} ${yours.yourSampleWeeks === 1 ? 'semana puntuada' : 'semanas puntuadas'} registrada${yours.yourSampleWeeks === 1 ? '' : 's'}; no basta para calcular una probabilidad.`
                    : `only ${yours.yourSampleWeeks} scored ${yours.yourSampleWeeks === 1 ? 'week' : 'weeks'} on file — too thin to price this`}
              </span>
            </div>
          )}

          {/* This week's lineups, projected by AllFantasy's engine and the provider — a different measure from the above. */}
          <WeekLineupLine lineups={lineups} leagueId={yours.leagueId} season={yours.season} week={yours.week} />

          {/* ── Rivalry ─────────────────────────────────────────────── */}
          <div
            className="af-wl-rivalry"
            data-tone={rivalry ? rivalryTone(rivalry.wins, rivalry.losses) : 'none'}
          >
            <span className="af-label af-wl-rivalry-tag">
              {rivalry ? `${copy('All-time')} ${rivalryRecord(rivalry)}` : copy('All-time')}{' '}
              <TopicTip topic="rivalrySeries" />
            </span>
            <p className="af-wl-rivalry-note">
              {rivalry
                ? describeRivalry(rivalry, yours.opponent.name, language)
                : /*
                     Never met is a real fact, and a different one from 0-0. A
                     first meeting is worth saying out loud rather than
                     rendering as an empty record.
                   */
                  es ? `Primer encuentro en el historial importado con ${yours.opponent.name ?? 'este equipo'}.` : `First meeting in imported history with ${yours.opponent.name ?? 'this team'}.`}
            </p>
          </div>
        </section>
      ) : (
        <section className="af-wl-hero" data-empty="true">
          <h2 className="af-label">{copy('Your matchup')}</h2>
          <p className="af-wl-hero-why">
            {board.format && board.format !== 'head-to-head' ? es ? 'Tu objetivo depende del formato de esta liga. Revisa la clasificación, los mínimos y los límites; no suponemos un rival ni una línea de eliminación.' : 'Your goal depends on this league’s format. Review standings, minimums, and caps; an opponent or cut line is never assumed.' : es ? 'No hay un rival confirmado para este período. Puede ser un descanso o un calendario incompleto; compruébalo en tu liga.' : 'No opponent is confirmed for this period. It may be a bye or an incomplete schedule; verify it in your league.'}
            <Link href={`/core/standings?league=${encodeURIComponent(board.leagueId)}`}>{es ? 'Ver clasificación' : 'View standings'} →</Link>
          </p>
        </section>
      )}

      {/* ── The rest of the league ──────────────────────────────────── */}
      <section className="af-wl-rest">
        <header className="af-wl-rest-head">
          <h2 className="af-label">
            {es ? `Resto de ${board.leagueName}` : `Rest of ${board.leagueName}`} <TopicTip topic="weekWinProbability" />
          </h2>
          <span className="af-wl-rest-note" title={es ? 'Estimaciones históricas; no son pronósticos de alineación' : 'Historical estimates, not lineup forecasts'}>
            {sidelines.length > 0
              ? es ? `${sidelines.length} ${sidelines.length === 1 ? 'enfrentamiento más' : 'enfrentamientos más'} · más ajustados primero` : `${sidelines.length} other ${sidelines.length === 1 ? 'matchup' : 'matchups'} · closest first`
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
            {es ? `No hay más enfrentamientos registrados esta semana en ${board.leagueName}.` : `No other matchups are on file for this week in ${board.leagueName}.`}
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
          {es ? `La probabilidad de ganar es una aproximación basada en las semanas puntuadas de cada equipo en ${board.leagueName}, con las reglas de esta liga. No es una simulación ni considera lesiones o descansos.` : `Win probability is a normal approximation over each team's scored weeks in ${board.leagueName}, on this league's own scoring. It is not a simulation, and it knows nothing about injuries or byes.`}
        </p>
      ) : null}
    </div>
  )
}

function Sideline({ m, board }: { m: LeagueSideline; board: LeagueWeekBoard }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const copy = (english: string) => coreUiCopy(english, language)
  const aLeads = m.aWinProbability != null && m.aWinProbability >= 0.5
  const aRec = recordOf(board, m.a.rosterId)
  const bRec = recordOf(board, m.b.rosterId)

  return (
    <article className="af-wl-card">
      <div className="af-wl-card-row" data-lead={aLeads}>
        <TeamAvatar
          url={m.a.avatarUrl}
          fallback={initials(m.a.name)}
          className="af-wl-card-avatar"
          px={22}
        />
        <span className="af-wl-card-name">{m.a.name ?? copy('Unnamed team')}</span>
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
        <TeamAvatar
          url={m.b.avatarUrl}
          fallback={initials(m.b.name)}
          className="af-wl-card-avatar"
          px={22}
        />
        <span className="af-wl-card-name">{m.b.name ?? copy('Unnamed team')}</span>
        {bRec ? <span className="af-wl-card-rec af-num">{bRec}</span> : null}
        <span className="af-wl-card-proj af-num">
          {m.b.projected != null ? n1(m.b.projected) : '—'}
        </span>
      </div>

      {m.aWinProbability == null ? (
        <p className="af-wl-card-why">{es ? 'Estimación histórica no disponible' : 'Historical estimate unavailable'}</p>
      ) : null}
    </article>
  )
}

/**
 * W—L, or W—L—T once a meeting has finished level, so a tie never reads as a
 * loss. Digits and dashes only — the same in English and Spanish.
 */
function rivalryRecord(r: { wins: number; losses: number; ties: number }): string {
  return r.ties > 0 ? `${r.wins}—${r.losses}—${r.ties}` : `${r.wins}—${r.losses}`
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
  language = 'en',
): string {
  const meetings = language === 'es' ? `${r.meetings} ${r.meetings === 1 ? 'encuentro' : 'encuentros'}` : `${r.meetings} ${r.meetings === 1 ? 'meeting' : 'meetings'}`
  const margin = `${r.averageMargin >= 0 ? '+' : ''}${r.averageMargin.toFixed(1)}`
  if (language === 'es') {
    const lead = r.wins > r.losses ? 'Lideras la serie' : r.losses > r.wins ? `${oppName ?? 'Tu rival'} lidera la serie` : 'La serie está empatada'
    return `${lead} tras ${meetings}. Tu diferencia de puntuación media: ${margin} puntos por encuentro.`
  }
  const lead = r.wins > r.losses ? 'You lead the series' : r.losses > r.wins ? `${oppName ?? 'They'} lead the series` : 'Dead even'
  return `${lead} over ${meetings}. Your signed scoring advantage: ${margin} points per meeting.`
}

export default YourWeekLeague
