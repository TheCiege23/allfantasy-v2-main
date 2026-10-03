import Link from 'next/link'

import type { MultiLeagueAdd, WaiverBoardRow, WaiverPlayer, WaiversBoardData, WaiverSportSection } from '@/lib/core-app/waiversBoard'
import { TopicTip } from '@/components/core-app/TopicTip'
import { WaiverRunClock } from '@/components/core-app/WaiverRunClock'
import { WaiversBoardList, WaiversDueSoon } from '@/components/core-app/boards/WaiversBoardList'
import { PER_GAME_UNIT, waiverSportLabel } from '@/lib/waivers/waiverSportBasis'
import { claimLink } from '@/lib/core-app/platformLinks'
import { teamLogoUrl } from '@/lib/core-app/teamLogo'
import PlayerName from '@/components/core-app/player-card/PlayerName'
import {
  BoardHead,
  FooterSummary,
  LeagueCrest,
  PlayerFace,
  SectionHead,
  StatPair,
  platformKey,
  NoLeaguesYet,
} from '@/components/core-app/boards/BoardKit'
import '@/components/core-app/af-core-boards.css'

/**
 * `/core/waivers` with no league held — the best add on every wire at once.
 *
 * 2026-09-07 handoff (`AF Core Waivers.dc.html`).
 *
 * ⚠ RANKED BY LINEUP GAIN (what the add does to your best starting lineup — see
 * `lib/core-app/waiverSwap.ts`), AND THE SECTION LABEL SAYS SO. That gain is the one
 * quantity on this screen that is comparable between leagues: a FAAB bid is not
 * (budgets differ), and a raw projection is not (scoring differs). See the
 * loader's header for the full argument.
 *
 * ⚠ EVERY PROJECTION HERE IS SCORED UNDER ITS OWN LEAGUE'S RULES, which is what
 * makes the comparison legitimate — and the basis line under the board says so,
 * because a points figure with no stated basis reads as a fact rather than as a
 * model output.
 *
 * ⚠ THE CLAIM BUTTON LEAVES FOR THE PLATFORM. AllFantasy is read-only; the claim
 * is made on Sleeper. `claimLink` falls back to the in-app screen for a native
 * league and for any provider whose deep-link format is not yet verified, so
 * this is never a dead destination.
 */

export type WaiversBoardProps = {
  data: WaiversBoardData
  /** Where the footer's "View all" goes — the full picker. */
  allHref: string
  /** Total leagues on the account, for the footer's denominator. */
  totalLeagues: number
  /** The render's clock, for the "most of the week is played" note. Defaults to now; tests pin it. */
  nowMs?: number
}

function pct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`
}

function Side({
  label,
  player,
  tone,
  emptyNote,
  leagueId,
  sport,
  note,
}: {
  label: string
  player: WaiverPlayer | null
  tone: 'good' | 'bad'
  emptyNote?: string
  /** One short line under the player: who the add starts over, or why this is the drop. */
  note?: string
  leagueId: string
  /** Set on a season-rate row only: its figures are per game and its `playerId` is not a Sleeper id. */
  sport?: string
}) {
  return (
    <div className="af-bd-side" data-tone={tone}>
      <span className="af-bd-side-label">{label}</span>
      {player ? (
        <>
          <span className="af-bd-asset">
            <PlayerFace
              imageUrl={player.imageUrl}
              name={player.name}
              teamLogoUrl={teamLogoUrl(sport ?? 'NFL', player.team)}
            />
            <span className="af-bd-asset-name">
              {/*
                Opens the player card in THIS league's context.

                ⚠ `WaiverPlayer.playerId` IS A SLEEPER ID, and that is an
                invariant of this loader rather than a hope: `idSpaceOk` gates
                the whole computation on the caller's roster resolving into the
                projection id space, which is Sleeper's. A league whose ids do
                not resolve is withheld before a row is ever built, so there is
                no path by which an ESPN id reaches here.

                🛑 EXCEPT ON A SEASON-RATE ROW (`sport` set), where `playerId` is
                a projection key. It is never passed as a Sleeper id: the name
                renders as text rather than open a card on someone else's number.
              */}
              <PlayerName
                sport={sport ?? 'NFL'}
                sleeperId={sport ? null : player.playerId}
                name={player.name}
                position={player.position}
                team={player.team}
                imageUrl={player.imageUrl}
                leagueId={leagueId}
              />
              {player.position ? (
                <span className="af-bd-pos" data-pos={player.position.toUpperCase()}>
                  {' '}
                  {player.position.toUpperCase()}
                </span>
              ) : null}
              {player.team ? <span className="af-bd-sub af-bd-asset-team"> {player.team}</span> : null}
            </span>
          </span>
          {/*
            The projection is the headline of each side (2026-09-13 handoff), so
            it sits on its own line under the player rather than as a row value.
          */}
          <span className="af-bd-proj">
            <span className="af-bd-asset-val" data-sev={tone}>
              {player.projected.toFixed(1)}
            </span>
            <span className="af-bd-k">{sport ? `Proj ${PER_GAME_UNIT}` : 'Proj pts'}</span>
            {/* AllFantasy's own engine, beside the provider's figure above. NFL rows only. */}
            {!sport && player.afProjected != null ? (
              <span className="af-bd-af" title="AllFantasy engine projection, adjusted to this league's scoring">
                AF {player.afProjected.toFixed(1)}
              </span>
            ) : null}
          </span>
          {/*
            ⚠ THE MARKET PERCENTAGES ARE NULL BELOW THE DENOMINATOR GATE, and an
            em dash is the correct rendering of that. A 0% own rate computed over
            four leagues would call a widely-rostered player a free agent.
          */}
          <span className="af-bd-kvrow">
            <StatPair k="Rostered" v={pct(player.ownPct)} />
            <StatPair k="Started" v={pct(player.startPct)} />
          </span>
          {note ? <span className="af-bd-side-note">{note}</span> : null}
        </>
      ) : (
        <span className="af-bd-asset af-bd-asset--empty">
          <span className="af-bd-asset-name">{emptyNote ?? 'Nothing to show.'}</span>
        </span>
      )}
    </div>
  )
}

function Card({ row }: { row: WaiverBoardRow }) {
  /*
   * 🛑 THE PROVIDER'S LEAGUE ID HAS TO TRAVEL WITH THE LINK. Without it the resolver has nothing to
   * build `sleeper.com/leagues/{id}/players` from and falls back to the provider's HOMEPAGE — so
   * "Open in Sleeper ↗" on every card landed on sleeper.com's front page, one tap from the claim
   * it promised and no closer. The row has always carried the id; it was simply never passed.
   */
  const claim = claimLink({
    id: row.leagueId,
    platform: row.platform,
    platformLeagueId: row.platformLeagueId,
    name: row.leagueName,
  })
  const gain = `${row.netGain >= 0 ? '+' : ''}${row.netGain.toFixed(1)}`
  /* A season-rate row's gain is per GAME; saying "this week" of it would be a forecast it never made. */
  const perGame = row.sport != null

  return (
    <>
      {/*
        2026-09-13 handoff: net gain as a pill and the claim as a button in the
        header; the add and the drop as two tinted panels with an arrow between;
        the reasoning in its own box. The rank numeral is gone (the section label
        states the order).
      */}
      <article className="af-bd-card">
        <header className="af-bd-card-head">
          <LeagueCrest
            imageUrl={row.logoUrl}
            name={row.leagueName}
            platform={row.platform}
            size="sm"
          />
          <span className="af-bd-league">
            <span className="af-bd-name">{row.leagueName}</span>
            <span className="af-bd-sub">
              <span className="af-bd-plat" data-platform={platformKey(row.platform)}>
                {row.platform.toUpperCase()}
              </span>
              {row.format ? ` · ${row.format}` : null}
            </span>
          </span>
          {row.faabRemaining != null ? (
            <StatPair k="FAAB left" v={`$${row.faabRemaining}`} />
          ) : null}
          {/*
            Net gain is the ranking key, so it is the loudest number on the card.
            The words live in the accessible name; the pill shows the figure.
          */}
          <span
            className="af-bd-gain"
            data-sev={row.netGain >= 0 ? 'good' : 'bad'}
            aria-label={perGame ? `Lineup gain ${gain} projected points per game` : `Lineup gain ${gain} projected points this week`}
          >
            {gain} <span className="af-bd-gain-unit">{perGame ? PER_GAME_UNIT : 'pts/wk'}</span>
          </span>
          {/* The same swap on AllFantasy's own engine. The pill above is the ranking key; this is not. */}
          {!perGame && row.afNetGain != null ? (
            <span className="af-bd-af-net" title="Net gain on AllFantasy's own projection engine">
              AF {row.afNetGain >= 0 ? '+' : ''}{row.afNetGain.toFixed(1)}
            </span>
          ) : null}
          {claim ? (
            <a
              className="af-bd-btn"
              href={claim.href}
              {...(claim.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              {claim.label} {claim.external ? '↗' : '→'}
            </a>
          ) : null}
        </header>

        <div className="af-bd-card-body af-bd-swap">
          <Side
            label="Add"
            player={row.add}
            tone="good"
            leagueId={row.leagueId}
            sport={row.sport}
            note={
              row.startsOver
                ? `Starts over ${row.startsOver.name} (${row.startsOver.projected.toFixed(1)})`
                : row.startsOver === null
                  ? 'Fills an empty starting slot'
                  : undefined
            }
          />
          <span className="af-bd-swap-arrow" aria-hidden>
            →
          </span>
          <Side
            label="Drop"
            player={row.drop}
            tone="bad"
            emptyNote={
              row.openRosterSpot
                ? 'You have an open roster spot — nothing needs to go.'
                : 'No bench player here could be priced, so no drop is named.'
            }
            leagueId={row.leagueId}
            sport={row.sport}
            note={row.dropBasis === 'market_value' ? 'Lowest dynasty market value on your bench' : undefined}
          />
        </div>

        {/*
          ⚠ NOT LABELLED "DECISION OS", THOUGH THE HANDOFF IS. This line is the
          loader's own explanation of its arithmetic; Decision OS runs beside the
          product and does not produce it. A label that names a system which did
          not make the call is a claim about provenance we cannot back.
        */}
        <div className="af-bd-why">
          <span className="af-bd-why-label">Why</span>
          <p className="af-bd-reason">{row.reasoning}</p>
        </div>

        {row.alternatives && row.alternatives.length > 0 ? (
          /*
            The next options on this wire. A native <details>: no script, keyboard-reachable, and
            collapsed by default so a 40-league board stays one card tall per league.
          */
          <details className="af-wvb-alts" data-testid={`waivers-alts-${row.leagueId}`}>
            <summary>
              {row.alternatives.length} more {row.alternatives.length === 1 ? 'option' : 'options'} on this wire
            </summary>
            <ul>
              {row.alternatives.map((a) => (
                <li key={a.add.playerId}>
                  <span className="af-wvb-alt-who">
                    <PlayerName
                      sport={row.sport ?? 'NFL'}
                      sleeperId={row.sport ? null : a.add.playerId}
                      name={a.add.name}
                      position={a.add.position}
                      team={a.add.team}
                      imageUrl={a.add.imageUrl}
                      leagueId={row.leagueId}
                    />
                    <span className="af-bd-sub">
                      {' '}
                      {a.add.position ?? ''}
                      {a.add.team ? ` · ${a.add.team}` : ''} · {a.add.projected.toFixed(1)}
                      {a.startsOver ? ` · over ${a.startsOver.name}` : ' · fills an empty slot'}
                    </span>
                  </span>
                  <span className="af-wvb-alt-gain">
                    +{a.gain.toFixed(1)}
                    {perGame ? ` ${PER_GAME_UNIT}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <div className="af-bd-card-foot">
          {row.runsAt ? (
            <span className="af-bd-tag" data-sev="muted">
              RUNS
              <span className="af-bd-tag-detail">
                {' '}
                {/* The viewer's own time and a countdown once mounted; the UTC label until then. */}
                {row.runsSchedule ? <WaiverRunClock schedule={row.runsSchedule} compact /> : row.runsAt}
              </span>
            </span>
          ) : null}
          <Link className="af-bd-cta" href={row.href}>
            League waivers →
          </Link>
        </div>
      </article>
    </>
  )
}

/**
 * Free agents who would start for you in two or more leagues — one claim decision that a
 * per-league list spreads across several cards.
 */
/**
 * How to read a card, once per section — a "?" for each term the cards use, instead of the same
 * icons repeated on all forty cards. A term only gets its "?" when some card here shows it.
 */
function CardLegend({ rows }: { rows: WaiverBoardRow[] }) {
  const hasAf = rows.some((r) => r.afNetGain != null || r.add?.afProjected != null)
  const hasFaab = rows.some((r) => r.faabRemaining != null)
  const hasRuns = rows.some((r) => r.runsAt)
  /* Always: a dash under Rostered / Started (too few leagues) needs explaining as much as a number. */
  const hasMarket = rows.length > 0
  return (
    <p className="af-bd-note af-bd-note--plain af-wvb-legend" data-testid="waivers-card-legend">
      <span>How to read a card:</span>
      <span>
        lineup gain <TopicTip topic="lineupGain" />
      </span>
      {hasAf ? (
        <span>
          AF <TopicTip topic="afProjection" />
        </span>
      ) : null}
      {hasMarket ? (
        <span>
          Rostered / Started <TopicTip topic="marketRates" />
        </span>
      ) : null}
      {hasFaab ? (
        <span>
          FAAB left <TopicTip topic="faab" />
        </span>
      ) : null}
      {hasRuns ? (
        <span>
          Runs <TopicTip topic="waiverRun" />
        </span>
      ) : null}
    </p>
  )
}

function MultiLeagueSection({ players }: { players: MultiLeagueAdd[] }) {
  return (
    <section className="af-bd-sec" aria-labelledby="af-wv-multi" data-testid="waivers-multi-league">
      <SectionHead id="af-wv-multi" label="Available in more than one of your leagues" count={`${players.length}`} />
      <ul className="af-wvb-multi">
        {players.map((p) => (
          <li key={p.playerId}>
            <span className="af-wvb-multi-who">
              <PlayerName
                sport="NFL"
                sleeperId={p.playerId}
                name={p.name}
                position={p.position}
                team={p.team}
                imageUrl={p.imageUrl}
              />
              <span className="af-bd-sub">
                {' '}
                {p.position ?? ''}
                {p.team ? ` · ${p.team}` : ''}
              </span>
            </span>
            <span className="af-wvb-multi-n">starts for you in {p.leagues.length} leagues</span>
            <span className="af-wvb-multi-leagues">
              {p.leagues.map((l, i) => (
                <span key={l.leagueId}>
                  {i > 0 ? ' · ' : ''}
                  <Link href={l.href}>{l.leagueName}</Link> +{l.gain.toFixed(1)}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="af-bd-note af-bd-note--plain">
        Each gain is that league&apos;s own lineup gain, scored under its own rules — they are not added
        into one number, because a point in one league is not a point in another.
      </p>
    </section>
  )
}

/**
 * ⚠ FOUR DIFFERENT EXCLUSIONS, NAMED SEPARATELY. "We could not find your
 * roster", "this league's ids are not in the projection feed's id space",
 * "this league published no scoring settings" and "the wire had nobody we
 * could price" are four different facts, and a single "N leagues excluded"
 * would be the shape that makes a board stop being trustworthy at sixty
 * leagues. One component, so the NFL rows and every sport section say them
 * the same way.
 */
function ExcludedNote({ withheld }: { withheld: WaiversBoardData['withheld'] }) {
  const noUpgrade = withheld.noUpgrade ?? 0
  const excluded = withheld.noRoster + withheld.idSpace + withheld.noScoring + withheld.noCandidate + noUpgrade
  if (excluded <= 0) return null
  return (
    <p className="af-bd-note">
      <strong>
        {excluded} {excluded === 1 ? 'league is' : 'leagues are'} not on this board.
      </strong>{' '}
      {withheld.idSpace > 0
        ? `${withheld.idSpace} ${withheld.idSpace === 1 ? 'stores' : 'store'} player ids the projection feed does not use, so we cannot tell a free agent from a rostered player there. `
        : ''}
      {withheld.noScoring > 0
        ? `${withheld.noScoring} ${withheld.noScoring === 1 ? 'has' : 'have'} never published their scoring or lineup settings, and a projection scored under someone else's rules is not this league's number. `
        : ''}
      {withheld.noRoster > 0
        ? `${withheld.noRoster} ${withheld.noRoster === 1 ? 'has' : 'have'} no roster of yours imported. `
        : ''}
      {withheld.noCandidate > 0
        ? `${withheld.noCandidate} had nobody on the wire we could price. `
        : ''}
      {noUpgrade > 0
        ? `${noUpgrade} ${noUpgrade === 1 ? 'has' : 'have'} nobody on the wire who would crack your starting lineup — nothing to claim there.`
        : ''}
    </p>
  )
}

/**
 * One sport's section. Ranked on its own — a per-game gain is not a weekly one — and never
 * missing: a sport with no producer shows its reason, so no league leaves the board unexplained.
 */
function SportSection({ section }: { section: WaiverSportSection }) {
  const label = waiverSportLabel(section.sport)
  const id = `af-wv-${section.sport.toLowerCase()}`
  const leagues = `${section.considered.toLocaleString()} ${section.considered === 1 ? 'league' : 'leagues'}`
  return (
    <section className="af-bd-sec" aria-labelledby={id} data-testid={`waivers-sport-${section.sport}`}>
      <SectionHead
        id={id}
        label={
          section.rows.length > 0
            ? `${label} · top ${section.rows.length} · ranked by lineup gain per game`
            : label
        }
        count={section.season != null ? `season rate, ${section.season}` : leagues}
      />
      {section.state !== 'ok' ? (
        <p className="af-bd-note">{section.reason}</p>
      ) : section.rows.length > 0 ? (
        <>
        <CardLegend rows={section.rows} />
        <ul className="af-bd-cards af-bd-cards--rich af-bd-cards--waivers">
          {section.rows.map((r) => (
            <li key={r.leagueId}>
              <Card row={r} />
            </li>
          ))}
        </ul>
        </>
      ) : (
        <p className="af-bd-note">None of your {label} leagues could be priced — the reasons are below.</p>
      )}
      {section.basisLabel && section.state === 'ok' ? (
        <p className="af-bd-note af-bd-note--plain">{section.basisLabel}</p>
      ) : null}
      <ExcludedNote withheld={section.withheld} />
    </section>
  )
}

export function WaiversBoard({ data, allHref, totalLeagues, nowMs = Date.now() }: WaiversBoardProps) {
  /* Counted HERE, at render, because the loader is cached and must stay clock-free. */
  const kickoffs = data.weekKickoffs ?? []
  const weekPlayed =
    kickoffs.length > 0
      ? { played: kickoffs.filter((iso) => Date.parse(iso) <= nowMs).length, total: kickoffs.length }
      : null
  const sports = data.sports ?? []
  /*
   * The NFL block renders whenever the account has an NFL league, or has nothing else to show. An
   * account whose leagues are all basketball gets its basketball section — not an NFL empty state
   * above it saying no NFL team is claimed.
   */
  const showNfl = data.rows.length > 0 || data.considered > 0 || sports.length === 0
  const shownRows = data.rows.length + sports.reduce((n, s) => n + s.rows.length, 0)

  /* No leagues on this account yet: say so and offer a way forward (BoardKit NoLeaguesYet). */
  if (totalLeagues === 0) {
    return (
      <div className="af-bd">
        <BoardHead eyebrow="Core · Waivers" title="Waivers" blurb="The free agent on each of your wires who would add the most to your starting lineup, ranked by that gain." />
        <NoLeaguesYet what="Once one is, this board finds the best available player on each of your wires and ranks the adds by the points they gain you." />
      </div>
    )
  }

  return (
    <div className="af-bd">
      <BoardHead
        eyebrow="Core · Waivers"
        title="Waivers"
        blurb="The free agent on each of your wires who would add the most to your starting lineup, ranked by that gain."
      />

      {/*
        The projection feed holds ONE week (see `WaiversBoardData.weekKickoffs`). Once most of it has
        kicked off, the gains below describe a week that is nearly over — say so, and say which week
        a claim made now is actually for.
      */}
      {data.rows.length > 0 && data.at && weekPlayed && weekPlayed.played / weekPlayed.total >= 0.75 ? (
        <p className="af-bd-note" data-tone="warn" data-testid="waivers-spent-week">
          <strong>
            Most of week {data.at.week} has been played ({weekPlayed.played} of {weekPlayed.total}{' '}
            games).
          </strong>{' '}
          These gains are week {data.at.week} projections — the projection feed has not published week{' '}
          {data.at.week + 1} yet, and a claim that processes now is for week {data.at.week + 1}. Read them
          as each player&apos;s current role, not next week&apos;s points.
        </p>
      ) : null}

      {!showNfl ? null : data.rows.length > 0 ? (
        <section className="af-bd-sec" aria-labelledby="af-wv-board">
          <SectionHead
            id="af-wv-board"
            label={`${sports.length > 0 ? 'NFL · ' : ''}${data.rows.length} ${data.rows.length === 1 ? 'league' : 'leagues'} · ranked by lineup gain`}
            count={
              data.at
                ? `week ${data.at.week}, ${data.at.season}${data.pricedOn === 'next_week' ? ' · next week' : ''}`
                : null
            }
          />
          <CardLegend rows={data.rows} />
          <WaiversDueSoon
            leagues={data.rows.flatMap((r) =>
              r.runsSchedule ? [{ key: r.leagueId, leagueName: r.leagueName, href: r.href, schedule: r.runsSchedule }] : [],
            )}
          />
          <WaiversBoardList
            items={data.rows.map((r) => ({
              key: r.leagueId,
              gain: r.netGain,
              leagueName: r.leagueName,
              position: r.add.position,
              schedule: r.runsSchedule ?? null,
            }))}
            cards={Object.fromEntries(data.rows.map((r) => [r.leagueId, <Card key={r.leagueId} row={r} />]))}
          />
        </section>
      ) : (
        <p className="af-bd-note">
          {data.considered === 0
            ? 'No team is claimed to this account, so there is no wire to read.'
            : `None of your ${sports.length > 0 ? 'NFL ' : ''}leagues could be priced this week — the reasons are below.`}
        </p>
      )}

      {showNfl && data.multiLeague && data.multiLeague.length > 0 ? <MultiLeagueSection players={data.multiLeague} /> : null}

      {showNfl ? (
        <p className="af-bd-note af-bd-note--plain">
          Every projection here is re-scored under that league&apos;s own scoring settings
          {data.at ? ` for week ${data.at.week} of ${data.at.season}` : ''}, which is what makes
          the lineup-gain column comparable between leagues.
          {/*
            Next week's board is said in words, not only in the header: it is published days ahead,
            and a reader should know these numbers will move before kickoff.
          */}
          {data.pricedOn === 'next_week' && data.at
            ? ` A claim made now is for week ${data.at.week}, so these are Sleeper's week ${data.at.week} projections — published ahead, and they move as injuries and depth charts settle.`
            : ''}
          {data.marketLeagues > 0
            ? ` Rostered and started rates are measured across ${data.marketLeagues.toLocaleString()} leagues on AllFantasy.`
            : ' Rostered and started rates are withheld — too few leagues to measure them over.'}
        </p>
      ) : null}

      {showNfl ? <ExcludedNote withheld={data.withheld} /> : null}

      {sports.map((s) => (
        <SportSection key={s.sport} section={s} />
      ))}

      <FooterSummary
        hidden={Math.max(0, totalLeagues - shownRows)}
        total={totalLeagues}
        href={allHref}
        quiet="are not on this board — either already covered above, or named in the note."
      />
    </div>
  )
}

export default WaiversBoard
