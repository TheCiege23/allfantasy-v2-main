'use client'

import Link from 'next/link'

import type { CoreIssue } from '@/lib/core-app/outstandingIssues'
import type { MatchupPulse, PulseRow } from '@/lib/core-app/matchupPulse'
import { MatchupPulseRefresh } from '@/components/core-app/MatchupPulseRefresh'
import {
  BoardHead,
  FooterSummary,
  SectionHead,
  columnsTooUneven,
} from '@/components/core-app/boards/BoardKit'
import '@/components/core-app/af-matchup-pulse.css'
import '@/components/core-app/af-core-boards.css'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'

/**
 * `/core/matchup` with no league held — "where you stand" across every league.
 *
 * 2026-09-07 handoff (`AF Core Matchup.dc.html`). The leading-top-5 /
 * trailing-bottom-5 structure was already right and is kept verbatim; what
 * changed is that this IS the screen now rather than a panel above one. The
 * league-picker grid moved behind the footer's "View all N", and the
 * "Needs you first" queue survives as a short section under the board — the
 * design keeps it here, unlike on My Team, because a league whose data cannot
 * be read has no margin to rank and would otherwise vanish from this screen
 * entirely.
 *
 * ⚠ EVERY ROW STATES WHAT ITS NUMBER IS. The design shows one green number and
 * one red one, which is right the moment games are being played. Before kickoff
 * there are no points to compare — see the header note in `matchupPulse.ts` —
 * so a projected row is tagged `PROJ` and the section head says how the board is
 * measured. A projected margin rendered identically to a live one is
 * indistinguishable from a score, which is the one mistake this screen cannot
 * make.
 */

export type MatchupPulseBoardProps = {
  pulse: MatchupPulse
  /**
   * Leagues on the account, for the footer's denominator.
   *
   * ⚠ NOT `pulse.considered`, WHICH COUNTS CLAIMED TEAMS. A manager can hold 65
   * leagues and have claimed a team in four of them; "View all 4" from a board
   * that is the only route to the picker strands the other 61.
   */
  totalLeagues: number
  /**
   * The outstanding-issues queue, rendered as "Needs you first".
   *
   * ⚠ ONLY ROWS THAT NAME A LEAGUE. An issue we cannot route is noise on a
   * screen whose every row is a destination — same filter `PickALeague` applies.
   */
  issues?: CoreIssue[]
  /** Where the footer's "View all" goes — the full picker. */
  allHref: string
}

/** The crest, or the initials that are the genuine fallback for a missing one. */
function Crest({ row }: { row: PulseRow }) {
  return row.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="af-mp-crest"
      src={row.logoUrl}
      alt=""
      width={22}
      height={22}
      loading="lazy"
    />
  ) : (
    <span className="af-mp-crest af-mp-crest--none" data-platform={row.platform} aria-hidden>
      {row.leagueBadge}
    </span>
  )
}

function Face({ row }: { row: PulseRow }) {
  return row.opponentAvatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="af-mp-face"
      src={row.opponentAvatarUrl}
      alt=""
      width={30}
      height={30}
      loading="lazy"
    />
  ) : (
    <span className="af-mp-face af-mp-face--none" data-platform={row.platform} aria-hidden>
      {row.opponentInitials}
    </span>
  )
}

/**
 * "vs Gridiron Ghosts · 6 left to play".
 *
 * Each clause is dropped rather than faked when its source is absent: a lineup
 * we could not place against a fixture list carries no count at all. An
 * opposing roster with no real name is "Team N" — the platform's own label,
 * the same on every surface (`rosterLabel`), never a manager we made up.
 */
function metaOf(row: PulseRow, language: string): string {
  const parts: string[] = [`${language === 'es' ? 'contra' : 'vs'} ${row.opponentLabel}`]
  if (row.startersLeft != null) {
    parts.push(language === 'es' ? `${row.startersLeft} por jugar` : `${row.startersLeft} left to play`)
  }
  /*
   * Where a LIVE row is heading. The number on the right is the score right now; this says where
   * the model expects it to end — the line that explains why a +30.9 can sit under "Underdog".
   * Not on a projected row (its margin already is the projection) or a final one (it is the result).
   */
  if (row.basis === 'scored' && !row.final && row.projectedMargin != null) {
    const pm = `${row.projectedMargin > 0 ? '+' : row.projectedMargin < 0 ? '−' : ''}${Math.abs(row.projectedMargin).toFixed(1)}`
    parts.push(language === 'es' ? `final proy. ${pm}` : `proj final ${pm}`)
  }
  /*
   * No coverage clause: the loader refuses to RANK a projected row unless both
   * lineups are the same size and fully priced, so a row that reaches here is
   * already like-for-like. Leagues that are not are counted in `notRanked`.
   */
  return parts.join(' · ')
}

function Row({
  row,
  tone,
  tagFinal,
  scale,
}: {
  row: PulseRow
  tone: 'good' | 'bad'
  tagFinal: boolean
  /** The largest |margin| on the board — each row's bar is drawn against it. */
  scale: number
}) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const abs = Math.abs(row.margin).toFixed(1)
  /*
   * ⚠ THE MARGIN'S SIGN IS ITS OWN, NOT THE COLUMN'S. The columns are now chosen by win probability,
   * so a row up 30.9 on Friday can sit under "Underdog". Printing it as −30.9 to match its column
   * would be a false score; it reads +30.9 in green, and the ring beside it says 20%.
   */
  const marginTone = row.margin > 0 ? 'good' : row.margin < 0 ? 'bad' : 'even'
  const sign = row.margin > 0 ? '+' : row.margin < 0 ? '−' : ''
  /*
   * How big this margin is next to the others, as a bar along the row's foot. Ten numbers in a
   * column are read one at a time; ten bars are seen at once — "two blowouts and three coin flips".
   * Floored at 4% so a 0.4-point margin still shows a sliver rather than nothing.
   */
  const width = scale > 0 ? Math.max(4, Math.min(100, (Math.abs(row.margin) / scale) * 100)) : 0
  const odds = row.pWin != null && !row.final ? `${Math.round(row.pWin * 100)}% ${copy('to win')}` : null
  return (
    <li>
      <Link
        className="af-mp-row"
        href={row.href}
        data-tone={tone}
        data-margin={marginTone}
        data-basis={row.basis}
        /* Replaces the row's text for a screen reader, so it carries the meta line as well as the margin. */
        aria-label={`${row.leagueName}, ${metaOf(row, language)}: ${row.margin >= 0 ? copy('ahead by') : copy('behind by')} ${abs}${row.basis === 'projected' ? ` (${copy('projected')})` : ''}${odds ? `, ${odds}` : ''}${tagFinal && row.final ? `, ${copy('final')}` : ''}`}
      >
        <span className="af-mp-bar" aria-hidden style={{ width: `${width}%` }} />
        <Face row={row} />
        <Crest row={row} />
        <span className="af-mp-text">
          <span className="af-mp-league">{row.leagueName}</span>
          <span className="af-mp-meta">{metaOf(row, language)}</span>
        </span>
        {/*
          The tag is on the ROW, not only in the section head. A mixed board is
          the normal state mid-season — some leagues playing Thursday, others
          not until Sunday — and a header note cannot tell you which of the ten
          rows in front of you is a projection.
        */}
        {row.basis === 'projected' ? <span className="af-mp-tag">{copy('PROJ')}</span> : null}
        {/*
          FINAL on a MIXED board only: a week that is over sits beside leagues still being played,
          and "leading" would claim a game that can still turn. When every row is final the whole
          board says won/lost instead, and a tag on each row would repeat it.
        */}
        {tagFinal && row.final ? <span className="af-mp-tag" data-kind="final">{copy('FINAL')}</span> : null}
        <span className="af-mp-diff af-num" data-tone={marginTone}>
          {sign}
          {abs}
        </span>
        {/* The odds, as a ring — absent on a finished row (it is a result) and when the model refused. */}
        {row.pWin != null && !row.final ? <WinRing p={row.pWin} /> : null}
      </Link>
    </li>
  )
}

/**
 * Your chance of winning, as a ring with the number inside. Green above even, red below, and the
 * arc is the probability itself — read at a glance before the digits are.
 */
function WinRing({ p }: { p: number }) {
  const pct = Math.round(p * 100)
  const r = 15
  const c = 2 * Math.PI * r
  return (
    <span className="af-mp-ring" data-tone={p > 0.5 ? 'good' : p < 0.5 ? 'bad' : 'even'} aria-hidden>
      <svg viewBox="0 0 36 36" width="36" height="36">
        <circle className="af-mp-ring-track" cx="18" cy="18" r={r} fill="none" strokeWidth="3" />
        <circle
          className="af-mp-ring-arc"
          cx="18"
          cy="18"
          r={r}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${(c * Math.min(1, Math.max(0, p))).toFixed(2)} ${c.toFixed(2)}`}
          transform="rotate(-90 18 18)"
        />
      </svg>
      <span className="af-mp-ring-n af-num">{pct}</span>
    </span>
  )
}

/** One sentence naming what the whole board is measured in. */
function basisNote(pulse: MatchupPulse, language: string): string | null {
  if (pulse.basis === 'projected') {
    return coreUiCopy('Nothing has been scored yet, so every margin here is a projection priced under each league’s own scoring rules — not a live score.', language)
  }
  if (pulse.basis === 'mixed') {
    return coreUiCopy('Rows tagged PROJ have not kicked off — their margin is projected under that league’s own scoring rules. The rest are live points.', language)
  }
  return null
}

/** "we could not rank six of them, and here is why" — never a silent short list. */
function gapNote(pulse: MatchupPulse, language: string): string | null {
  const { noSchedule, noOpponent, unpriceable, uncomparable, unidentifiedRoster } = pulse.notRanked
  const notStarted = pulse.notRanked.notStarted ?? 0
  const elimination = pulse.notRanked.elimination ?? 0
  const parts: string[] = []
  /* The league's own state, not ours: there is no schedule until it drafts. */
  if (notStarted > 0) parts.push(`${notStarted} ${notStarted === 1 ? 'has' : 'have'} not started yet`)
  /* Not a gap at all — the format plays the whole field, so there is no one opponent to rank against. */
  if (elimination > 0) {
    parts.push(`${elimination} ${elimination === 1 ? 'is a guillotine league' : 'are guillotine leagues'}, scored against the whole field`)
  }
  if (noSchedule > 0) parts.push(`${noSchedule} carry no schedule`)
  if (noOpponent > 0) parts.push(`${noOpponent} have no game this week`)
  if (unpriceable > 0) parts.push(`${unpriceable} could not be scored or priced`)
  if (uncomparable > 0) {
    parts.push(`${uncomparable} have lineups we cannot compare like for like`)
  }
  /*
   * 🛑 THE ONE THAT IS OUR FAULT, AND IT IS SAID DIFFERENTLY FOR THAT REASON.
   * The others describe the league's state; this one describes a roster id this
   * loader cannot use — an ESPN SWID or a Fantrax slug where it needs Sleeper's
   * numeric roster_id. Wording it like the rest would blame the league for our
   * gap. See `notRanked.unidentifiedRoster`.
   */
  if (unidentifiedRoster > 0) {
    parts.push(
      `${unidentifiedRoster} carry a roster id we cannot match to a schedule — our gap, not theirs`,
    )
  }
  if (parts.length === 0) return null
  if (language === 'es') {
    const reasons: string[] = []
    if (notStarted > 0) reasons.push(`${notStarted} aún sin comenzar`)
    if (elimination > 0) reasons.push(`${elimination} de eliminación (guillotina), contra toda la liga`)
    if (noSchedule > 0) reasons.push(`${noSchedule} sin calendario`)
    if (noOpponent > 0) reasons.push(`${noOpponent} sin partido esta semana`)
    if (unpriceable > 0) reasons.push(`${unpriceable} sin puntuación o proyección`)
    if (uncomparable > 0) reasons.push(`${uncomparable} con alineaciones no comparables`)
    if (unidentifiedRoster > 0) reasons.push(`${unidentifiedRoster} con identificadores que no podemos vincular al calendario; es una limitación nuestra`)
    return `Sin clasificar: ${reasons.join(', ')}.`
  }
  return `Not ranked: ${parts.join(', ')}.`
}

/**
 * Can anything on this board still move?
 *
 * ⚠ `basis === 'scored'` ALONE IS NOT THE TEST, because a finished week is
 * scored too. A row is in play only if points exist AND starters remain, which
 * is what stops the fast cadence running all week on a board whose games ended
 * on Monday night.
 *
 * ⚠ AND `startersLeft: null` COUNTS AS IN PLAY. Null means we could not place
 * that lineup against a fixture list — a non-NFL league, or a week the schedule
 * does not reach — so it is unknown, not zero. Treating an unknown as "nothing
 * left" would freeze the board for exactly the leagues whose data we are worst
 * at, which is the wrong way round.
 */
function anyInPlay(pulse: MatchupPulse): boolean {
  /* The closest games are on screen too, and the likeliest to be the ones still moving. */
  return [...pulse.leading, ...pulse.trailing, ...(pulse.closest ?? [])].some(
    (r) => r.basis === 'scored' && !r.final && (r.startersLeft == null || r.startersLeft > 0),
  )
}

const ISSUE_RANK: Record<string, number> = { bad: 0, warn: 1, info: 2 }

export function MatchupPulseBoard({
  pulse,
  issues,
  allHref,
  totalLeagues,
}: MatchupPulseBoardProps) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const note = basisNote(pulse, language)
  /*
   * 🛑 A FINISHED WEEK IS A RESULT, NOT A STANDING. On the Tuesday after week 3 (App Review account,
   * 2026-09-29) this board said "0 leading · 3 trailing" and "You are not ahead in any league right
   * now" about three games that had all ended. When every ranked row is final the board says
   * won/lost; a mixed board keeps leading/trailing and tags the finished rows FINAL.
   */
  const done = pulse.allFinal === true
  /*
   * The columns are chosen by WIN PROBABILITY whenever any row has one (`matchupPulse.ts`), so they
   * are named for what they measure. "Leading" over a row that is up 30.9 but projected to lose is
   * the exact claim the ranking change exists to stop; "Favoured" is true of it. A board where the
   * model priced nothing keeps the margin's own words.
   */
  const byOdds = (pulse.withOdds ?? 0) > 0
  const [aheadWord, behindWord] = done ? ['won', 'lost'] : byOdds ? ['favoured', 'underdog'] : ['leading', 'trailing']
  const [aheadHead, behindHead] = done ? ['Won', 'Lost'] : byOdds ? ['Favoured', 'Underdog'] : ['Leading', 'Trailing']
  const closest = pulse.closest ?? []
  const gap = gapNote(pulse, language)
  const inPlay = anyInPlay(pulse)

  const routable = (issues ?? [])
    .filter((i) => i.leagueId != null)
    .sort((a, b) => (ISSUE_RANK[a.severity] ?? 9) - (ISSUE_RANK[b.severity] ?? 9))
    .slice(0, 5)

  /*
   * The closest-games rows are on screen as well. Leaving them out told a 65-league account that
   * "55 more leagues" sat off screen when 50 did (production, 2026-10-02).
   */
  const shown = pulse.leading.length + pulse.trailing.length + closest.length
  const hidden = Math.max(0, totalLeagues - shown)
  const scale = Math.max(0, ...[...pulse.leading, ...pulse.trailing, ...(pulse.closest ?? [])].map((r) => Math.abs(r.margin)))
  const ahead = pulse.leadingTotal ?? pulse.leading.length
  const behind = pulse.trailingTotal ?? pulse.trailing.length
  const decided = ahead + behind

  return (
    <div className="af-bd">
      <BoardHead
        eyebrow={`Core · ${copy('Matchup')}`}
        title={copy('Matchup')}
        blurb={copy(
          byOdds
            ? 'Every league with a head-to-head this week, ranked by your chance of winning. Open one for the full box score.'
            : 'Every league with a head-to-head this week, ranked by margin. Open one for the full box score.',
        )}
      />

      <section className="af-mp" aria-labelledby="af-mp-head">
        <header className="af-mp-head">
          <h2 className="af-label" id="af-mp-head">
            {copy('Where you stand')}
          </h2>
          <span className="af-mp-rule" aria-hidden />
          <span className="af-mp-count">
            {pulse.leadingTotal ?? pulse.leading.length} {copy(aheadWord)} · {pulse.trailingTotal ?? pulse.trailing.length} {copy(behindWord)}
          </span>
          {/*
            Only when there is something to keep current. On a board with nothing
            ranked, a "live" indicator would be claiming to watch a thing that is
            not there.
          */}
          {pulse.ranked > 0 ? <MatchupPulseRefresh inPlay={inPlay} /> : null}
        </header>

        {/*
          The week as one scoreboard: how many leagues you are ahead in against how many you are
          behind in, as two numbers and one split bar. This is the line a manager with twenty
          leagues opens the screen for, and it used to be 11px text at the end of a rule.
        */}
        {pulse.ranked > 0 && decided > 0 ? (
          <div className="af-mp-score" data-done={done || undefined}>
            <div className="af-mp-score-side" data-tone="good">
              <span className="af-mp-score-n af-num">{ahead}</span>
              <span className="af-mp-score-word">{copy(aheadWord)}</span>
            </div>
            <div
              className="af-mp-split"
              role="img"
              aria-label={`${ahead} ${copy(aheadWord)}, ${behind} ${copy(behindWord)}`}
            >
              <span className="af-mp-split-good" style={{ width: `${(ahead / decided) * 100}%` }} />
            </div>
            <div className="af-mp-score-side" data-tone="bad">
              <span className="af-mp-score-n af-num">{behind}</span>
              <span className="af-mp-score-word">{copy(behindWord)}</span>
            </div>
          </div>
        ) : null}

        {/*
          The week's expected record: the model's odds summed. "You should win about 23 of these 41"
          is the number a twenty-league manager actually wants, and it moves all weekend.
        */}
        {!done && pulse.expectedWins != null && (pulse.withOdds ?? 0) > 0 ? (
          <p className="af-mp-expected">
            <span className="af-mp-expected-label">{copy('Expected record')}</span>{' '}
            <span className="af-num af-mp-expected-n">
              {pulse.expectedWins.toFixed(1)}–{Math.max(0, pulse.withOdds - pulse.expectedWins).toFixed(1)}
            </span>{' '}
            <span className="af-mp-expected-of">
              {/*
                "of N" whenever some ranked rows carry no odds. "19 favoured · 24 underdog" above an
                expected record "across 38 matchups" read as two boards that disagreed; the five
                rows ranked by margin alone were the difference (production, 2026-10-02).
              */}
              {pulse.withOdds < decided
                ? language === 'es'
                  ? `· en ${pulse.withOdds} de ${decided} enfrentamientos con probabilidades`
                  : `· across ${pulse.withOdds} of ${decided} matchups with odds`
                : language === 'es'
                  ? `· de ${pulse.withOdds} enfrentamientos con probabilidades`
                  : `· across ${pulse.withOdds} matchups with odds`}
            </span>
          </p>
        ) : null}

        {note ? <p className="af-mp-basis">{note}</p> : null}

        {pulse.ranked > 0 ? (
          /*
            ⚠ THE TWO COLUMNS ARE ROUTINELY UNEQUAL AND THAT LEAVES A HOLE. Being
            ahead in one league and behind in five is an ordinary week, and the
            short column then reads as a panel that failed to load rather than as
            a short list. `columnsTooUneven` lives in BoardKit so every
            two-column board applies the same threshold.
          */
          <div
            className="af-mp-cols"
            data-stack={columnsTooUneven(pulse.leading.length, pulse.trailing.length) || undefined}
          >
            <div className="af-mp-col">
              <h3 className="af-label af-mp-col-head" data-tone="good">
                {copy(aheadHead)} · {copy('top 5')}
              </h3>
              {pulse.leading.length > 0 ? (
                <ul className="af-mp-rows">
                  {pulse.leading.map((r) => (
                    <Row key={r.leagueId} row={r} tone="good" tagFinal={!done} scale={scale} />
                  ))}
                </ul>
              ) : (
                <p className="af-mp-quiet">{copy(done ? 'You did not win a league this week.' : byOdds ? 'You are not favoured in any league right now.' : 'You are not ahead in any league right now.')}</p>
              )}
            </div>

            <div className="af-mp-col">
              <h3 className="af-label af-mp-col-head" data-tone="bad">
                {copy(behindHead)} · {copy('bottom 5')}
              </h3>
              {pulse.trailing.length > 0 ? (
                <ul className="af-mp-rows">
                  {pulse.trailing.map((r) => (
                    <Row key={r.leagueId} row={r} tone="bad" tagFinal={!done} scale={scale} />
                  ))}
                </ul>
              ) : (
                <p className="af-mp-quiet">{copy(done ? 'You did not lose a league this week.' : byOdds ? 'You are not the underdog in any league right now.' : 'You are not behind in any league right now.')}</p>
              )}
            </div>
          </div>
        ) : (
          /*
            ⚠ "NOTHING TO RANK" AND "NOTHING IS HAPPENING" ARE DIFFERENT FACTS.
            A user with sixty leagues in the offseason and a user with none must
            not read the same sentence, so the count is stated either way.
          */
          <p className="af-mp-quiet">
            {pulse.considered > 0
              ? language === 'es'
                ? pulse.considered === 1
                  ? 'Tu equipo asignado no tiene un enfrentamiento clasificable esta semana; abajo se explica por qué.'
                  : `Ninguno de tus ${pulse.considered} equipos asignados tiene un enfrentamiento clasificable esta semana; abajo se explica por qué.`
                : `None of your ${pulse.considered} claimed ${pulse.considered === 1 ? 'team' : 'teams'} has a head-to-head we can rank this week — the line below says why.`
              : copy('No claimed team yet, so there is no head-to-head to stand in.')}
          </p>
        )}

        {/*
          The coin flips — the matchups the top-5/bottom-5 columns hide, and the ones worth watching.
          Only rows not already shown above, so nothing is listed twice.
        */}
        {closest.length > 0 ? (
          <div className="af-mp-col af-mp-closest">
            <h3 className="af-label af-mp-col-head" data-tone="even">
              {copy('Closest games')} · {copy('worth watching')}
            </h3>
            <ul className="af-mp-rows">
              {closest.map((r) => (
                <Row
                  key={r.leagueId}
                  row={r}
                  tone={(r.pWin ?? (r.margin >= 0 ? 1 : 0)) >= 0.5 ? 'good' : 'bad'}
                  tagFinal={!done}
                  scale={scale}
                />
              ))}
            </ul>
          </div>
        ) : null}

        {gap ? <p className="af-mp-gap">{gap}</p> : null}
      </section>

      {/*
        The stale-data queue. A league we cannot read carries no margin, so it is
        absent from the board above — this is where it says so, rather than
        being silently missing from a screen that claims to cover every league.
      */}
      {routable.length > 0 ? (
        <section className="af-bd-sec af-mp-needs" aria-labelledby="af-mp-needs">
          <SectionHead
            id="af-mp-needs"
            label={copy('Needs you first')}
            count={language === 'es' ? `${routable.length} en ${new Set(routable.map((i) => i.leagueId)).size} ligas` : `${routable.length} across ${new Set(routable.map((i) => i.leagueId)).size} leagues`}
          />
          <ul className="af-bd-rows">
            {routable.map((i) => (
              <li key={i.id}>
                <Link
                  className="af-bd-row"
                  href={`/core/matchup?league=${encodeURIComponent(i.leagueId as string)}`}
                >
                  <span className="af-bd-rank" aria-hidden>
                    {i.glyph}
                  </span>
                  <span className="af-bd-league af-bd-league--wide">
                    <span className="af-bd-name">{i.title}</span>
                    <span className="af-bd-sub">{i.meta}</span>
                  </span>
                  <span className="af-bd-mid" />
                  <span className="af-bd-cta">{i.leagueName ?? copy('Open')} →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <FooterSummary
        hidden={hidden}
        total={totalLeagues}
        href={allHref}
        /* Most of the rest ARE scored — they sit between the top and bottom five. This said "have no
           game this week or could not be scored", which was false for ~43 of 55 on the measured account. */
        quiet={language === 'es'
          ? hidden === 1
            ? 'está entre los cinco mostrados a cada lado, no juega esta semana o no se pudo puntuar.'
            : 'están entre los cinco mostrados a cada lado, no juegan esta semana o no se pudieron puntuar.'
          : 'sit between the five shown on each side, have no game this week, or could not be scored.'}
        language={language}
      />
    </div>
  )
}

export default MatchupPulseBoard
