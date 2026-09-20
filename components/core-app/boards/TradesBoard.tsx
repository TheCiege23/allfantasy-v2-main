import type {
  BoardTrade,
  TradeAsset,
  TradeWindowRow,
  TradesBoardData,
} from '@/lib/core-app/tradesBoard'
import { teamLogoUrl } from '@/lib/core-app/teamLogo'
import PlayerName from '@/components/core-app/player-card/PlayerName'
import BoardActionLink from '@/components/core-app/boards/BoardActionLink'
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

/**
 * A traded draft pick.
 *
 * 🛑 IT IS A SEPARATE COMPONENT BECAUSE `PlayerName` MUST NEVER SEE A PICK KEY. The
 * loader's synthetic `pick:2027:1:0` is a non-empty string, so it would not degrade
 * to plain text — it would open a player card for a player that is not in the trade.
 * `TradeAsset.kind` is the discriminator that makes picks safe to render here, and
 * this branch is the whole reason it exists.
 *
 * The round sits in the same 26px circle a headshot would, so a mixed side stays on
 * one grid and needs no new CSS.
 */
function PickAsset({ a }: { a: TradeAsset }) {
  /* "2027 1st" -> "1st". `||`, not `??`: an empty last segment is not a label. */
  const round = a.name.split(' ').slice(-1)[0] || 'PK'
  return (
    <span className="af-bd-asset">
      <span className="af-bd-facewrap">
        <span className="af-bd-face af-bd-face--sm af-bd-face--none" aria-hidden>
          {round}
        </span>
      </span>
      <span className="af-bd-asset-name">
        {a.name}
        <span className="af-bd-pos" data-pos="PICK">
          {' '}
          PICK
        </span>
      </span>
      {/*
        🛑 THIS WAS A HARDCODED DASH, UNDER A COMMENT SAYING a pick is one we do not
        price at all. That was true when it was written and stopped being true on
        2026-09-20, when `ingestPlayerValues` began storing FantasyCalc pick rows. The
        price was being computed, carried onto the asset, and thrown away one step from
        the screen — so a card could show a GRADE that only the pick value explains,
        beside a dash claiming we hold no value for it.

        ⚠ STILL A DASH WHEN IT IS GENUINELY UNPRICED, and that case is real rather than
        theoretical: FantasyCalc publishes picks on the DYNASTY books only, and only for
        the seasons and rounds it covers. A redraft league, or a round past the book’s
        depth, has no price here and must never be shown a zero.
      */}
      <span className="af-bd-asset-val">{a.value != null ? a.value.toLocaleString() : '—'}</span>
    </span>
  )
}

function Asset({ a, leagueId }: { a: TradeAsset; leagueId: string }) {
  if (a.kind === 'pick') return <PickAsset a={a} />
  return (
    <span className="af-bd-asset">
      <PlayerFace
        imageUrl={a.imageUrl}
        name={a.name}
        teamLogoUrl={teamLogoUrl('NFL', a.team)}
        size="sm"
      />
      <span className="af-bd-asset-name">
        {/* Opens the player card in THIS league's context. */}
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
              {/*
                ⚠ THIS SENTENCE USED TO READ "Picks or FAAB only — no players on this
                side", AND IT WAS USUALLY FALSE. Picks render as assets now, so an
                empty side is genuinely empty: FAAB, or a side the importer never
                captured. It no longer blames a category we simply were not reading.
              */}
              <span className="af-bd-asset-name">Nothing on record for this side — FAAB only, or not captured.</span>
            </span>
          )}
        </div>
        <div className="af-bd-side">
          <span className="af-bd-side-label">{t.toName} sent</span>
          {t.received.length > 0 ? (
            t.received.map((a) => <Asset key={`r-${a.id}`} a={a} leagueId={leagueId} />)
          ) : (
            <span className="af-bd-asset">
              {/*
                ⚠ THIS SENTENCE USED TO READ "Picks or FAAB only — no players on this
                side", AND IT WAS USUALLY FALSE. Picks render as assets now, so an
                empty side is genuinely empty: FAAB, or a side the importer never
                captured. It no longer blames a category we simply were not reading.
              */}
              <span className="af-bd-asset-name">Nothing on record for this side — FAAB only, or not captured.</span>
            </span>
          )}
        </div>
      </div>
    </>
  )
}

function WindowCard({ row }: { row: TradeWindowRow }) {
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
      {/*
        2026-09-13 handoff: league, deadline and the action in the header; the two
        sides; then one footer line — the latest grade, a divider, the reasoning.
        The rank numeral is gone (the section label states the rule) and the
        bottom link row became the header button.
      */}
      <article className="af-bd-card" data-sev={urgent ? 'bad' : undefined}>
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
              {` · ${row.tradesOnFile} ${row.tradesOnFile === 1 ? 'trade' : 'trades'} on file`}
            </span>
          </span>
          {/*
            An unknown or absent deadline is a fact about what we hold, not an
            alert — so it reads faint, not in the accent it used to borrow.
          */}
          <span
            className="af-bd-tag"
            data-sev={urgent ? 'bad' : row.deadlineWeek != null ? 'warn' : 'muted'}
          >
            {deadlineLabel}
          </span>
          {/*
            ⚠ NOT A PLAIN `<Link>`. This navigates `/core/trades` →
            `/core/trades?league=…`, which changes a SEARCH PARAM and not the
            segment key — so the route's `loading.tsx` never re-suspends, the
            skeleton never paints, and the tap produced no feedback at all while
            `getTradesData` made a live Sleeper call. Reported from a phone as
            the button "not working when clicked". See BoardActionLink's header.
          */}
          <BoardActionLink className="af-bd-btn" href={row.href}>
            Open trades →
          </BoardActionLink>
        </header>

        {t ? (
          <TradeBody t={t} leagueId={row.leagueId} />
        ) : (
          <p className="af-bd-reason">No trade has been made in this league on any season we hold.</p>
        )}

        <div className="af-bd-card-foot">
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
              <span className="af-bd-sub" style={{ maxWidth: 260 }}>
                ungraded: {t.withheldReason ?? 'no reason recorded'}
              </span>
            </span>
          ) : null}
          {/*
            Who came out ahead, and by how much — the half of the verdict a letter alone
            cannot carry. `sharePct` was already on `BoardTrade` and rendered nowhere.

            🛑 A SHARE, NOT TWO TOTALS, AND THE REASON IS ARITHMETIC THE READER CAN DO.
            The per-asset numbers above are the raw `PlayerValueSnapshot.value` for each
            man; the grade is computed in RANK space, by pushing each asset's rank through
            `DEFAULT_RANK_CURVE`. Those two agree closely but not exactly — the curve is a
            nine-point interpolation of the same market, so it is near the raw value and
            never equal to it. Print side totals and they will not sum to the rows anyone
            can see, and the discrepancy is the reader's to explain rather than ours. A
            share is scale-free, so it states the result without inviting an addition that
            does not balance — which is `tradeGrading.ts`'s own argument for banding the
            letter on share rather than on an absolute points gap.

            ⚠ `sharePct` IS THE SHARE RECEIVED BY `fromName`, because the loader passes
            their incoming side as side A. Naming the two managers in that order is what
            keeps it readable; swapping them silently inverts every verdict on the board.
          */}
          {t?.letter && t.sharePct != null ? (
            <span className="af-bd-kv">
              <span className="af-bd-k">Value split</span>
              <span className="af-bd-sub" style={{ maxWidth: 260 }}>
                {t.fromName} {Math.round(t.sharePct)}% · {t.toName} {100 - Math.round(t.sharePct)}%
              </span>
            </span>
          ) : null}
          {t?.season != null ? (
            <span className="af-bd-tag" data-sev="muted">
              LATEST
              <span className="af-bd-tag-detail">
                {' '}
                {t.week != null ? `week ${t.week}, ` : ''}
                {t.season}
              </span>
            </span>
          ) : null}
          {t ? <span className="af-bd-rule" aria-hidden /> : null}
          <p className="af-bd-reason">{row.reasoning}</p>
        </div>
      </article>
    </li>
  )
}

export function TradesBoard({ data, allHref }: TradesBoardProps) {
  const live = data.windows.filter((w) => w.weeksLeft != null && w.weeksLeft >= 0).length
  const anyDeadline = data.windows.some((w) => w.deadlineWeek != null || w.noDeadline)
  /*
    ⚠ THE LABEL MUST NAME THE RULE IN FORCE. The loader now sorts leagues that
    HAVE trades above ones that do not, so "ranked by deadline" would state a
    rule the list is not following -- and when nothing has trades at all, the
    reader deserves to be told that rather than shown ten empty cards under a
    heading promising trades.
  */
  const anyTrades = data.windows.some((w) => w.tradesOnFile > 0)

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
          <ul className="af-bd-cards af-bd-cards--rich">
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
                    <BoardActionLink
                      className="af-bd-btn"
                      href={`/core/trades?league=${encodeURIComponent(p.leagueId)}`}
                    >
                      Review it →
                    </BoardActionLink>
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
                ? anyTrades
                  ? `Top ${data.windows.length} · leagues with trades first, then deadline`
                  : `Top ${data.windows.length} · ranked by deadline · no trades on file in any of them`
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
          <ul className="af-bd-cards af-bd-cards--rich">
            {data.windows.map((w) => (
              <WindowCard key={w.leagueId} row={w} />
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

      <p className="af-bd-note af-bd-note--plain">
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
