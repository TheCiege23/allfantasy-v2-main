import Link from 'next/link'

import type {
  BoardTrade,
  TradeAsset,
  TradeWindowRow,
  TradesBoardData,
} from '@/lib/core-app/tradesBoard'
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
import '@/components/core-app/af-core-boards.css'

/**
 * `/core/trades` with no league held.
 *
 * 2026-09-07 handoff (`AF Core Trades.dc.html`), re-aimed — see the long note at
 * the top of `lib/core-app/tradesBoard.ts` for why "top-10 pending trades" is a
 * board that would be empty on every account forever, and what replaced it.
 *
 * The design's anatomy survives intact: two-sided hairline asset rows, a
 * fairness grade, the deadline ranking, a reasoning line per card. What changed
 * is the subject — your trade windows, with the latest real trade in each.
 *
 * ⚠ A MISSING LETTER IS RENDERED AS ITS REASON, NOT AS A "C". `gradeTrade`
 * returns a middle-band C when nothing on either side could be priced, so a C
 * would mean ZERO DATA while reading as "an average trade". This is the one
 * screen where that distinction is the whole product.
 */

export type TradesBoardProps = {
  data: TradesBoardData
  /** Where the footer's "View all" goes — the full picker. */
  allHref: string
}

const GRADE_SEV: Record<string, 'good' | 'warn' | 'bad'> = {
  A: 'good',
  B: 'good',
  C: 'warn',
  D: 'bad',
  F: 'bad',
}

function Asset({ a, leagueId }: { a: TradeAsset; leagueId: string }) {
  return (
    <span className="af-bd-asset">
      <PlayerFace
        imageUrl={a.imageUrl}
        name={a.name}
        teamLogoUrl={teamLogoUrl('NFL', a.team)}
        size="sm"
      />
      <span className="af-bd-asset-name">
        {/*
          Opens the player card in THIS league's context.

          ⚠ `TradeAsset.id` is documented as "Sleeper id, or a synthetic key for
          a pick", and only the first half is true today: the loader builds these
          from `playersGiven`/`playersReceived` and never reads `picksGiven`, so
          every asset here is a player. If picks are ever added to this list they
          need a `kind` discriminator FIRST — a synthetic pick key is a non-empty
          string, so it would not degrade to text, it would open the wrong card.
        */}
        <PlayerName
          sport="NFL"
          sleeperId={a.id}
          name={a.name}
          position={a.position}
          team={a.team}
          imageUrl={a.imageUrl}
          leagueId={leagueId}
        />
        {a.position ? (
          <span className="af-bd-pos" data-pos={a.position.toUpperCase()}>
            {' '}
            {a.position.toUpperCase()}
          </span>
        ) : null}
      </span>
      {/*
        ⚠ AN UNPRICED ASSET SHOWS AN EM DASH, NEVER A ZERO. A zero beside a real
        player name is a claim that he is worthless; a dash says we hold no
        price. The grade above already refuses the letter for the same reason.
      */}
      <span className="af-bd-asset-val">{a.value != null ? a.value.toLocaleString() : '—'}</span>
    </span>
  )
}

function TradeBody({ t, leagueId }: { t: BoardTrade; leagueId: string }) {
  return (
    <>
      <div className="af-bd-card-body">
        <div className="af-bd-side">
          <span className="af-bd-side-label">{t.fromName} sent</span>
          {t.sent.length > 0 ? (
            t.sent.map((a) => <Asset key={`s-${a.id}`} a={a} leagueId={leagueId} />)
          ) : (
            <span className="af-bd-asset">
              <span className="af-bd-asset-name">Picks or FAAB only — no players on this side.</span>
            </span>
          )}
        </div>
        <div className="af-bd-side">
          <span className="af-bd-side-label">{t.toName} sent</span>
          {t.received.length > 0 ? (
            t.received.map((a) => <Asset key={`r-${a.id}`} a={a} leagueId={leagueId} />)
          ) : (
            <span className="af-bd-asset">
              <span className="af-bd-asset-name">Picks or FAAB only — no players on this side.</span>
            </span>
          )}
        </div>
      </div>
    </>
  )
}

function WindowCard({ row, i }: { row: TradeWindowRow; i: number }) {
  const t = row.latest
  const urgent = row.weeksLeft != null && row.weeksLeft >= 0 && row.weeksLeft <= 1

  const deadlineLabel = row.noDeadline
    ? 'NO DEADLINE'
    : row.deadlineWeek == null
      ? 'DEADLINE UNKNOWN'
      : row.weeksLeft == null
        ? `WEEK ${row.deadlineWeek}`
        : row.weeksLeft > 0
          ? `${row.weeksLeft}W LEFT`
          : row.weeksLeft === 0
            ? 'THIS WEEK'
            : 'CLOSED'

  return (
    <li>
      <article className="af-bd-card" data-sev={urgent ? 'bad' : undefined}>
        <header className="af-bd-card-head">
          <span className="af-bd-rank" aria-hidden>
            {rankLabel(i)}
          </span>
          <LeagueCrest
            imageUrl={row.logoUrl}
            name={row.leagueName}
            platform={row.platform}
            size="sm"
          />
          <span className="af-bd-league">
            <span className="af-bd-name">{row.leagueName}</span>
            <span className="af-bd-sub">
              <span className="af-bd-plat" data-platform={row.platform}>
                {row.platform.toUpperCase()}
              </span>
              {` · ${row.tradesOnFile} ${row.tradesOnFile === 1 ? 'trade' : 'trades'} on file`}
            </span>
          </span>
          <span
            className="af-bd-tag"
            data-sev={urgent ? 'bad' : row.deadlineWeek != null ? 'warn' : 'info'}
          >
            {deadlineLabel}
          </span>
          {/*
            ⚠ THE REFUSAL IS RENDERED HERE, NOT LEFT TO THE LOADER'S PROSE. The
            loader also mentions it in `reasoning`, but a card that shows a
            trade with an empty grade slot and no explanation is exactly the
            shape this screen must not have — and prose is the wrong place to
            carry a structural fact. Where a letter would be, the reason is.
          */}
          {t?.letter ? (
            <StatPair k="Latest grade" v={t.letter} sev={GRADE_SEV[t.letter]} />
          ) : t ? (
            <span className="af-bd-kv">
              <span className="af-bd-k">Latest grade</span>
              <span className="af-bd-sub" style={{ maxWidth: 220 }}>
                ungraded: {t.withheldReason ?? 'no reason recorded'}
              </span>
            </span>
          ) : null}
        </header>

        {t ? (
          <TradeBody t={t} leagueId={row.leagueId} />
        ) : (
          <p className="af-bd-reason">No trade has been made in this league on any season we hold.</p>
        )}

        <p className="af-bd-reason">{row.reasoning}</p>

        <div className="af-bd-card-head">
          <span className="af-bd-mid">
            {t?.season != null ? (
              <span className="af-bd-tag" data-sev="info">
                LATEST
                <span className="af-bd-tag-detail">
                  {' '}
                  {t.week != null ? `week ${t.week}, ` : ''}
                  {t.season}
                </span>
              </span>
            ) : null}
          </span>
          <Link className="af-bd-cta" href={row.href}>
            Open trades →
          </Link>
        </div>
      </article>
    </li>
  )
}

export function TradesBoard({ data, allHref }: TradesBoardProps) {
  const live = data.windows.filter((w) => w.weeksLeft != null && w.weeksLeft >= 0).length
  const anyDeadline = data.windows.some((w) => w.deadlineWeek != null || w.noDeadline)

  return (
    <div className="af-bd">
      <BoardHead
        eyebrow="Core · Trades"
        title="Trades"
        blurb="Your trade windows, soonest to close first — with the most recent real trade in each league and how it graded."
      />

      {/*
        ⚠ THIS SECTION IS WIRED AND ALMOST ALWAYS EMPTY, AND THAT IS CORRECT.
        AllFantasy-native pending trades live in `af_league_trades`, which has
        zero rows in production because trades happen on Sleeper. It renders the
        moment one exists. Deleting it would mean the first real one appears
        nowhere; rendering an empty shell for it would tell every user their
        inbox is broken. So it renders only when there is something in it.
      */}
      {data.pending.length > 0 ? (
        <section className="af-bd-sec" aria-labelledby="af-tr-pending">
          <SectionHead
            id="af-tr-pending"
            label="Waiting on you"
            count={`${data.pending.length} pending`}
          />
          <ul className="af-bd-cards">
            {data.pending.map((p) => (
              <li key={p.id}>
                <article className="af-bd-card" data-sev="bad">
                  <header className="af-bd-card-head">
                    <LeagueCrest
                      imageUrl={p.logoUrl}
                      name={p.leagueName}
                      platform={p.platform}
                      size="sm"
                    />
                    <span className="af-bd-league">
                      <span className="af-bd-name">{p.leagueName}</span>
                      <span className="af-bd-sub">
                        {p.youProposed ? 'You proposed this' : 'Proposed to you'}
                        {p.expiresAt
                          ? ` · expires ${new Date(p.expiresAt).toUTCString().slice(0, 16)}`
                          : ''}
                      </span>
                    </span>
                    <span className="af-bd-tag" data-sev="bad">
                      {p.status.toUpperCase()}
                    </span>
                  </header>
                  <div className="af-bd-side">
                    <span className="af-bd-side-label">On the table</span>
                    {p.items.map((it, n) => (
                      <span className="af-bd-asset" key={`${p.id}-${n}`}>
                        <span className="af-bd-asset-name">
                          {it.reference ?? it.itemType}
                        </span>
                        <span className="af-bd-asset-val">
                          {it.faabAmount != null ? `$${it.faabAmount}` : it.itemType}
                        </span>
                      </span>
                    ))}
                  </div>
                  <div className="af-bd-card-head">
                    <span className="af-bd-mid" />
                    <Link
                      className="af-bd-cta"
                      href={`/core/trades?league=${encodeURIComponent(p.leagueId)}`}
                    >
                      Review it →
                    </Link>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.windows.length > 0 ? (
        <section className="af-bd-sec" aria-labelledby="af-tr-windows">
          <SectionHead
            id="af-tr-windows"
            /*
              ⚠ THE LABEL MUST DESCRIBE WHAT THE LIST ACTUALLY DID. With no
              deadline ingested for any league there is nothing to rank BY, and
              "ranked by deadline" over four rows that all read DEADLINE UNKNOWN
              is a stated rule the list is not following. Found by rendering it.
            */
            label={
              anyDeadline
                ? `Top ${data.windows.length} · ranked by deadline`
                : `Your ${data.windows.length} ${data.windows.length === 1 ? 'league' : 'leagues'} · no deadline ingested for any of them`
            }
            count={
              data.currentWeek != null
                ? `${live} still open · currently week ${data.currentWeek}`
                : anyDeadline
                  ? `${live} still open`
                  : null
            }
          />
          <ul className="af-bd-cards">
            {data.windows.map((w, i) => (
              <WindowCard key={w.leagueId} row={w} i={i} />
            ))}
          </ul>
        </section>
      ) : (
        <p className="af-bd-note">
          No team of yours is claimed in a league we can read a trade window for.
        </p>
      )}

      {/*
        ⚠ "WE DO NOT HOLD THE SETTING" IS NOT "THERE IS NO DEADLINE". Present on
        54 of 120 production leagues; the rest simply never published it, and a
        board that silently treats those as open-all-season is telling a manager
        their window is safe on no evidence.
      */}
      {data.deadlineUnknown > 0 ? (
        <p className="af-bd-note">
          <strong>
            {data.deadlineUnknown} of your leagues have never published a trade deadline.
          </strong>{' '}
          They sort below the ones that have — not because their window is open, but because
          we do not know when it shuts.
        </p>
      ) : null}

      <p className="af-bd-note">
        Grades price both sides against current market rank. A trade whose assets could not all
        be priced is shown with its reason instead of a letter — a &ldquo;C&rdquo; from no data
        would read as &ldquo;an average trade&rdquo;.
      </p>

      <FooterSummary
        hidden={Math.max(0, data.considered - data.windows.length)}
        total={data.considered}
        href={allHref}
        quiet="have a window further out, or none we can read."
      />
    </div>
  )
}

export default TradesBoard
