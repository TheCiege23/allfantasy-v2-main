import Link from 'next/link'

import type { OutlookLeague, SeasonOutlook, SwingMatchup } from '@/lib/core-app/seasonOutlook'
import {
  BoardHead,
  FooterSummary,
  LeagueCrest,
  SectionHead,
  columnsTooUneven,
  platformKey,
} from '@/components/core-app/boards/BoardKit'
import '@/components/core-app/af-core-boards.css'

/**
 * `/core/standings` with no league held — where you sit in every league at once.
 *
 * 2026-09-07 handoff (`AF Core Standings.dc.html`).
 *
 * ⚠ RANKED BY SEED, NOT BY POINTS FOR, AND THAT IS THE WHOLE DESIGN. The old
 * empty state said it in as many words: points-for only means something inside
 * one league, because two leagues with different scoring settings produce
 * numbers that cannot be compared. A seed is comparable — "#1 of 12" means the
 * same thing everywhere — so the board ranks on it and prints the field size
 * beside it so a #3 of 10 is not read as a #3 of 32.
 *
 * ⚠ AND THE ODDS ARE SIMULATED, NOT INFERRED FROM THE TABLE. `playoffPct` comes
 * out of `getSeasonOutlook`'s season simulation over the real remaining
 * schedule. The board says so in its blurb, because a percentage with no stated
 * basis reads as a fact rather than as a model output.
 *
 * ⚠ A LEAGUE WHOSE TEAM WE COULD NOT IDENTIFY IS EXCLUDED AND COUNTED, never
 * rendered with a blank seed. `OutlookLeague.you` is null exactly then, and a
 * row that says "#— of 12" is a row claiming we looked and found nothing.
 */

export type StandingsBoardProps = {
  outlook: SeasonOutlook
  /** Where the footer's "View all" goes — the full picker. */
  allHref: string
  /**
   * Leagues on the account, for the footer's denominator.
   *
   * ⚠ NOT THE SIMULATION'S OWN COUNT. `outlook.leagues` holds only the leagues
   * the simulation could run for; on an account whose season has not started
   * that is zero, and the footer — the only remaining route to the league
   * picker — then offered "View all 0". Found by rendering it, 2026-09-07.
   */
  totalLeagues: number
}

type Ranked = OutlookLeague & { you: NonNullable<OutlookLeague['you']> }

/** Above this, the field is all but locked in. Below the lower one, all but gone. */
const SAFE_PCT = 60
const LONG_SHOT_PCT = 25

function sevOf(pct: number): 'good' | 'warn' | 'bad' {
  if (pct >= SAFE_PCT) return 'good'
  if (pct >= LONG_SHOT_PCT) return 'warn'
  return 'bad'
}

/*
 * 2026-09-13 handoff: a compact row — crest, league over "record · N% playoff
 * odds", and the seed stacked over its status on the right.
 *
 * ⚠ NOTHING THE OLD ROW SAID IS GONE, IT MOVED. The rank numeral is dropped (the
 * section label states the order); the platform word and record stay on the sub
 * line with the odds; `whatDecidesIt` gets its own second line rather than being
 * cut to a status word; and IN / OUT sits under the seed.
 */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/**
 * The row's third line: this week's stakes, then the schedule ahead.
 *
 * ⚠ ONLY WHAT THE SIMULATION ALREADY PRODUCED. The swing game exists only for leagues where your odds
 * are still in play (Season Outlook runs branch simulations for at most eight of them), so a missing
 * swing means "not contested or not computed", never "nothing matters" — the line falls back to the
 * schedule, and to nothing at all, rather than inventing a stake.
 */
function stakesLine(league: Ranked, swing: SwingMatchup | null): string | null {
  const parts: string[] = []
  if (swing) {
    const opp = swing.opponentName ? ` vs ${swing.opponentName}` : ''
    parts.push(
      swing.clinchOnWin
        ? `Wk ${swing.week}${opp}: win and you are in`
        : `Wk ${swing.week}${opp}: ${Math.round(swing.ifWin)}% with a win, ${Math.round(swing.ifLose)}% with a loss`,
    )
    const top = swing.rooting?.[0]
    if (top) {
      const pick = top.rootFor === top.a ? top.aName : top.bName
      if (pick) parts.push(`root for ${pick}`)
    }
  }
  const sos = league.you.schedule
  const ranked = league.teams.filter((t) => t.schedule?.remainingRank != null).length
  if (sos?.remainingRank != null && ranked >= 3) {
    parts.push(`${ordinal(sos.remainingRank)}-hardest schedule left of ${ranked}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * Where the seed sits in the field, drawn: a track the width of the league, the
 * playoff cutoff marked on it, and your seed as a dot.
 *
 * ⚠ DECORATION OF A NUMBER ALREADY PRINTED, so it is `aria-hidden`. "#3 of 12"
 * beside it is the fact; the bar only makes a #7 of 8 and a #7 of 14 look as
 * different as they are.
 */
function SeedMeter({
  seed,
  field,
  playoffTeams,
  sev,
}: {
  seed: number
  field: number
  playoffTeams: number
  sev: 'good' | 'warn' | 'bad'
}) {
  if (field < 2) return null
  const at = Math.min(100, Math.max(0, ((seed - 0.5) / field) * 100))
  const cut = (Math.min(playoffTeams, field) / field) * 100
  return (
    <span className="af-bd-seedbar" aria-hidden>
      <span className="af-bd-seedbar-in" style={{ width: `${cut.toFixed(1)}%` }} />
      <span className="af-bd-seedbar-dot" data-sev={sev} style={{ left: `${at.toFixed(1)}%` }} />
    </span>
  )
}

/**
 * The account at a glance — the counts Season Outlook already computes, which
 * this board used to throw away.
 *
 * ⚠ THE DENOMINATOR IS THE RANKED LEAGUES, NOT THE ACCOUNT. `summary` is built
 * from leagues where your team was identified, which is exactly `ranked` here;
 * dividing by every league on the account would count leagues we never modelled
 * as leagues you are missing the playoffs in.
 */
function SeasonPulse({ summary, ranked }: { summary: SeasonOutlook['summary']; ranked: number }) {
  return (
    <section className="af-bd-pulse" aria-label="Your playoff picture across leagues">
      <p className="af-bd-pulse-lead">
        On playoff pace in <span className="af-num">{summary.makingPlayoffs}</span> of{' '}
        <span className="af-num">{ranked}</span> {ranked === 1 ? 'league' : 'leagues'}
      </p>
      <div className="af-bd-pulse-tiles">
        <div className="af-bd-pulse-tile" data-sev="good">
          <span className="af-bd-pulse-v">{summary.clinched}</span>
          <span className="af-bd-pulse-k">Clinched</span>
        </div>
        <div className="af-bd-pulse-tile" data-sev="warn">
          <span className="af-bd-pulse-v">{summary.onTheBubble}</span>
          <span className="af-bd-pulse-k">On the bubble</span>
        </div>
        {summary.bestTitle ? (
          <div className="af-bd-pulse-tile" title={summary.bestTitle.leagueName}>
            <span className="af-bd-pulse-v">{Math.round(summary.bestTitle.pct)}%</span>
            <span className="af-bd-pulse-k">Best title shot</span>
            <span className="af-bd-pulse-s">{summary.bestTitle.leagueName}</span>
          </div>
        ) : null}
      </div>
      <p className="af-bd-pulse-note">
        Pace is 50%+ playoff odds; the bubble is 25–75%.
      </p>
    </section>
  )
}

/**
 * The one game this week that moves your playoff odds the most, anywhere.
 *
 * ⚠ IT IS ALSO ON ITS LEAGUE'S ROW, AND THAT IS NOT A DUPLICATE. The row says
 * what is at stake in that league; this says which league to watch first. Only
 * drawn for a league on this board, so its link always resolves.
 */
function MustWin({ swing, league }: { swing: SwingMatchup; league: Ranked }) {
  const top = swing.rooting?.[0]
  const root = top ? (top.rootFor === top.a ? top.aName : top.bName) : null
  return (
    <Link className="af-bd-mustwin" href={league.href}>
      <span className="af-bd-mustwin-k">Biggest game this week</span>
      <span className="af-bd-mustwin-title">
        Wk {swing.week}
        {swing.opponentName ? ` vs ${swing.opponentName}` : ''}
      </span>
      <span className="af-bd-mustwin-league">{league.leagueName}</span>
      <span className="af-bd-mustwin-branches">
        <span data-sev="good">
          <span className="af-bd-mustwin-bk">Win</span>
          <span className="af-num">{Math.round(swing.ifWin)}%</span>
        </span>
        <span data-sev="bad">
          <span className="af-bd-mustwin-bk">Lose</span>
          <span className="af-num">{Math.round(swing.ifLose)}%</span>
        </span>
      </span>
      {swing.clinchOnWin || root ? (
        <span className="af-bd-mustwin-note">
          {swing.clinchOnWin ? 'Win and you are in.' : null}
          {swing.clinchOnWin && root ? ' ' : null}
          {root ? `Root for ${root}.` : null}
        </span>
      ) : null}
    </Link>
  )
}

function Row({ league, swing }: { league: Ranked; swing: SwingMatchup | null }) {
  const you = league.you
  const pct = Math.round(you.playoffPct)
  const sev = sevOf(you.playoffPct)
  const record = you.wins === 0 && you.losses === 0 ? null : `${you.wins}-${you.losses}`
  const inField = you.seed <= league.playoffTeams
  const stakes = stakesLine(league, swing)

  return (
    <li>
      <Link className="af-bd-row" href={league.href}>
        <LeagueCrest name={league.leagueName} platform={league.platform} size="sm" />
        <span className="af-bd-league">
          <span className="af-bd-name">{league.leagueName}</span>
          <span className="af-bd-sub">
            <span className="af-bd-plat" data-platform={platformKey(league.platform)}>
              {league.platform.toUpperCase()}
            </span>
            {' · '}
            {/*
              ⚠ AN ABSENT RECORD IS NOT 0-0. A freshly synced league carries a
              whole season of unplayed rows; printing "0-0" states a result.
            */}
            {record ?? 'no games played yet'}
            {' · '}
            {/*
              ⚠ `modelled: false` MEANS TOO FEW WEEKS TO MODEL, so the percentage
              behind it is the simulation's prior rather than a read on this team.
              It is marked rather than hidden — the seed beside it is still real.
            */}
            {pct}%{you.modelled ? '' : '*'} playoff odds
          </span>
          {/*
            The condition in words. `whatDecidesIt` is deliberately specific —
            "win once in three", not "in contention" — so it is printed rather
            than collapsed into a status word.
          */}
          <span className="af-bd-sub2" title={league.whatDecidesIt}>
            {league.whatDecidesIt}
          </span>
          {stakes ? (
            <span className="af-bd-sub2 af-bd-sub3" title={stakes}>
              {stakes}
            </span>
          ) : null}
        </span>
        <span className="af-bd-val af-bd-val--seed" data-sev={sev}>
          <span>
            #{you.seed} of {league.teams.length}
          </span>
          <SeedMeter seed={you.seed} field={league.teams.length} playoffTeams={league.playoffTeams} sev={sev} />
          <span className="af-bd-val-sub af-bd-val-sub--status" data-sev={sev}>
            {inField ? 'In' : 'Out'}
          </span>
        </span>
      </Link>
    </li>
  )
}

function Column({
  label,
  rows,
  quiet,
  tone,
  swings,
}: {
  label: string
  rows: Ranked[]
  quiet: string
  tone: 'good' | 'warn'
  swings: SeasonOutlook['swingByLeague']
}) {
  return (
    <section className="af-bd-sec">
      <SectionHead label={label} tone={tone} />
      {rows.length > 0 ? (
        <ul className="af-bd-rows af-bd-rows--compact">
          {rows.map((l) => (
            <Row key={l.leagueId} league={l} swing={swings[l.leagueId] ?? null} />
          ))}
        </ul>
      ) : (
        <p className="af-bd-note">{quiet}</p>
      )}
    </section>
  )
}

export function StandingsBoard({ outlook, allHref, totalLeagues }: StandingsBoardProps) {
  const ranked = outlook.leagues.filter((l): l is Ranked => l.you != null)
  const unidentified = outlook.leagues.length - ranked.length
  const total = Math.max(totalLeagues, outlook.leagues.length + outlook.withheld.length)

  /*
   * ⚠ TWO DIFFERENT SORTS, AND THE SECOND IS NOT THE REVERSE OF THE FIRST.
   * Strongest is "best position", which is seed first and odds as the
   * tiebreak — a #1 of 12 is a stronger claim than a #2 of 10 with better odds.
   * The bubble is "closest to missing", which is odds ascending, because a #7
   * of 10 with a soft run-in is in better shape than a #6 of 12 with a hard
   * one. Ranking the bubble by seed would put the wrong five in front of you.
   */
  const strongest = [...ranked]
    .sort((a, b) => a.you.seed - b.you.seed || b.you.playoffPct - a.you.playoffPct)
    .slice(0, 5)

  const strongestIds = new Set(strongest.map((l) => l.leagueId))
  const bubble = [...ranked]
    .filter((l) => !strongestIds.has(l.leagueId))
    .sort((a, b) => a.you.playoffPct - b.you.playoffPct)
    .slice(0, 5)
    /* Displayed best-first so the column reads downhill, like the design. */
    .reverse()

  const shown = strongest.length + bubble.length
  const anyUnmodelled = [...strongest, ...bubble].some((l) => !l.you.modelled)
  const swing = outlook.weekThatMatters
  const swingLeague = swing ? (ranked.find((l) => l.leagueId === swing.leagueId) ?? null) : null

  return (
    <div className="af-bd">
      <BoardHead
        eyebrow="Core · Standings"
        title="Standings"
        blurb="Points-for cannot be compared across leagues, so this ranks on seed instead — your strongest positions against the ones on the bubble."
      />

      {ranked.length > 0 ? (
        <>
          <div className="af-bd-pulse-row">
            <SeasonPulse summary={outlook.summary} ranked={ranked.length} />
            {swing && swingLeague ? <MustWin swing={swing} league={swingLeague} /> : null}
          </div>
          <div
            className="af-bd-split"
            data-stack={columnsTooUneven(strongest.length, bubble.length) || undefined}
          >
            <Column
              label="Strongest seeds · top 5"
              rows={strongest}
              tone="good"
              quiet="No league has a seed we can read yet."
              swings={outlook.swingByLeague ?? {}}
            />
            <Column
              label="On the bubble · bottom 5"
              rows={bubble}
              tone="warn"
              quiet="Nothing else is close enough to call a bubble."
              swings={outlook.swingByLeague ?? {}}
            />
          </div>

          <p className="af-bd-note af-bd-note--plain">
            Playoff odds are simulated over each league&apos;s real remaining schedule —{' '}
            {outlook.basis}
            {/* `basis` is whole sentences ending in a period; appending one read "…how uncertain they are..". */}
            {anyUnmodelled
              ? ' A percentage marked * comes from too few completed weeks to model that team, so read the seed beside it rather than the number.'
              : null}
          </p>
        </>
      ) : (
        <p className="af-bd-note">
          {outlook.leagues.length > 0
            ? 'We could not identify your own team in any league with a simulated season, so there is no seed to rank.'
            : 'No league of yours has enough of a season on file to simulate yet.'}
        </p>
      )}

      {/*
        ⚠ WITHHELD LEAGUES ARE NAMED WITH THEIR REASON, not folded into the
        footer's count. "We chose not to model this and here is why" is a
        different fact from "nothing is happening there".
      */}
      {outlook.withheld.length > 0 || unidentified > 0 ? (
        <p className="af-bd-note">
          {unidentified > 0 ? (
            <>
              <strong>
                {unidentified} {unidentified === 1 ? 'league' : 'leagues'} could not be ranked
              </strong>{' '}
              because we could not tell which team is yours.{' '}
            </>
          ) : null}
          {outlook.withheld.length > 0 ? (
            <>
              Withheld: {outlook.withheld.slice(0, 4).map((w) => `${w.leagueName} (${w.reason})`).join('; ')}
              {outlook.withheld.length > 4 ? `; and ${outlook.withheld.length - 4} more` : ''}.
            </>
          ) : null}
        </p>
      ) : null}

      <FooterSummary
        hidden={Math.max(0, total - shown)}
        total={total}
        href={allHref}
        quiet="sit between these two columns or have no seed to read."
      />
    </div>
  )
}

export default StandingsBoard
