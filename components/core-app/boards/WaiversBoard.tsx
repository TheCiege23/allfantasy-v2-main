import Link from 'next/link'

import type { WaiverBoardRow, WaiverPlayer, WaiversBoardData } from '@/lib/core-app/waiversBoard'
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
} from '@/components/core-app/boards/BoardKit'
import '@/components/core-app/af-core-boards.css'

/**
 * `/core/waivers` with no league held — the best add on every wire at once.
 *
 * 2026-09-07 handoff (`AF Core Waivers.dc.html`).
 *
 * ⚠ RANKED BY NET GAIN, AND THE SECTION LABEL SAYS SO. Net gain is the one
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
}: {
  label: string
  player: WaiverPlayer | null
  tone: 'good' | 'bad'
  emptyNote?: string
  leagueId: string
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
              teamLogoUrl={teamLogoUrl('NFL', player.team)}
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
              */}
              <PlayerName
                sport="NFL"
                sleeperId={player.playerId}
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
            <span className="af-bd-k">Proj pts</span>
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
  const claim = claimLink({ id: row.leagueId, platform: row.platform })
  const gain = `${row.netGain >= 0 ? '+' : ''}${row.netGain.toFixed(1)}`

  return (
    <li>
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
            className="af-bd-pill"
            data-sev={row.netGain >= 0 ? 'good' : 'bad'}
            aria-label={`Net gain ${gain} projected points this week`}
          >
            {gain} <span className="af-bd-pill-unit">pts/wk</span>
          </span>
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
          <Side label="Add" player={row.add} tone="good" leagueId={row.leagueId} />
          <span className="af-bd-swap-arrow" aria-hidden>
            →
          </span>
          <Side
            label="Drop"
            player={row.drop}
            tone="bad"
            emptyNote="No bench player here could be priced, so no drop is named."
            leagueId={row.leagueId}
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

        <div className="af-bd-card-foot">
          {row.runsAt ? (
            <span className="af-bd-tag" data-sev="muted">
              RUNS
              <span className="af-bd-tag-detail"> {row.runsAt}</span>
            </span>
          ) : null}
          <Link className="af-bd-cta" href={row.href}>
            League waivers →
          </Link>
        </div>
      </article>
    </li>
  )
}

export function WaiversBoard({ data, allHref, totalLeagues }: WaiversBoardProps) {
  const { withheld } = data
  const excluded =
    withheld.noRoster + withheld.idSpace + withheld.noScoring + withheld.noCandidate

  return (
    <div className="af-bd">
      <BoardHead
        eyebrow="Core · Waivers"
        title="Waivers"
        blurb="The single best available player on each of your wires, ranked by how many points the add actually gains you over the player you would drop."
      />

      {data.rows.length > 0 ? (
        <section className="af-bd-sec" aria-labelledby="af-wv-board">
          <SectionHead
            id="af-wv-board"
            label={`Top ${data.rows.length} · ranked by net gain`}
            count={
              data.at ? `week ${data.at.week}, ${data.at.season}` : null
            }
          />
          <ul className="af-bd-cards af-bd-cards--rich">
            {data.rows.map((r) => (
              <Card key={r.leagueId} row={r} />
            ))}
          </ul>
        </section>
      ) : (
        <p className="af-bd-note">
          {data.considered === 0
            ? 'No NFL team is claimed to this account, so there is no wire to read. Waiver pricing needs a weekly projection feed, which today exists for NFL only.'
            : 'None of your leagues could be priced this week — the reasons are below.'}
        </p>
      )}

      <p className="af-bd-note af-bd-note--plain">
        Every projection here is re-scored under that league&apos;s own{' '}
        <code>scoring_settings</code>
        {data.at ? ` for week ${data.at.week} of ${data.at.season}` : ''}, which is what makes
        the net-gain column comparable between leagues.
        {data.marketLeagues > 0
          ? ` Rostered and started rates are measured across ${data.marketLeagues.toLocaleString()} leagues on AllFantasy.`
          : ' Rostered and started rates are withheld — too few leagues to measure them over.'}
      </p>

      {/*
        ⚠ FOUR DIFFERENT EXCLUSIONS, NAMED SEPARATELY. "We could not find your
        roster", "this league's ids are not in the projection feed's id space",
        "this league published no scoring settings" and "the wire had nobody we
        could price" are four different facts, and a single "N leagues excluded"
        would be the shape that makes a board stop being trustworthy at sixty
        leagues.
      */}
      {excluded > 0 ? (
        <p className="af-bd-note">
          <strong>
            {excluded} {excluded === 1 ? 'league is' : 'leagues are'} not on this board.
          </strong>{' '}
          {withheld.idSpace > 0
            ? `${withheld.idSpace} ${withheld.idSpace === 1 ? 'stores' : 'store'} player ids the projection feed does not use, so we cannot tell a free agent from a rostered player there. `
            : ''}
          {withheld.noScoring > 0
            ? `${withheld.noScoring} ${withheld.noScoring === 1 ? 'has' : 'have'} never published their scoring settings, and a projection scored under someone else's rules is not this league's number. `
            : ''}
          {withheld.noRoster > 0
            ? `${withheld.noRoster} ${withheld.noRoster === 1 ? 'has' : 'have'} no roster of yours imported. `
            : ''}
          {withheld.noCandidate > 0
            ? `${withheld.noCandidate} had nobody on the wire we could price.`
            : ''}
        </p>
      ) : null}

      <FooterSummary
        hidden={Math.max(0, totalLeagues - data.rows.length)}
        total={totalLeagues}
        href={allHref}
        quiet="are not on this board — either already covered above, or named in the note."
      />
    </div>
  )
}

export default WaiversBoard
