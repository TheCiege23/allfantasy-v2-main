import type {
  BoardTrade,
  TradeAsset,
  TradeWindowRow,
  TradesBoardData,
} from '@/lib/core-app/tradesBoard'
import { WhyFold } from '@/components/core-app/home/WhyFold'
import { teamLogoUrl } from '@/lib/core-app/teamLogo'
import PlayerName from '@/components/core-app/player-card/PlayerName'
import BoardActionLink from '@/components/core-app/boards/BoardActionLink'
import { SleeperOffersNotice } from '@/components/trades/SleeperOffersNotice'
import {
  BoardHead,
  FooterSummary,
  LeagueCrest,
  PlayerFace,
  SectionHead,
  platformKey,
  NoLeaguesYet,
} from '@/components/core-app/boards/BoardKit'
import '@/components/core-app/af-core-boards.css'
import { messagesFor } from '@/lib/i18n/messages'
import { tradesGuideMessages } from '@/lib/core-app/messages/tradesGuide'
import { tradeTeamGradesMessages } from '@/lib/core-app/messages/tradeTeamGrades'
import { letterTone, teamGrades, tradeVerdict, type Letter } from '@/lib/core-app/tradeTeamGrades'
import '@/components/core-app/af-trade-team-grades.css'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'

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

type TradesBoardProps = {
  /**
   * Under the /core/trades guide (2026-11-13): no second page title (the guide headline is the page's
   * h1), no Sleeper notice (the "Check a trade" card says it in one line), a plain section heading, and
   * the grading notes folded behind "How grades work".
   */
  embedded?: boolean
  /** The reader's language, for the embedded headings (this board renders on the server). */
  language?: string | null
  data: TradesBoardData
  /** Where the footer's "View all" goes — the full picker. */
  allHref: string
  /** Leagues on this account. 0 shows the no-leagues next steps instead of an empty board. */
  totalLeagues?: number
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
      <span className="af-bd-asset-val">{a.value != null ? a.value.toLocaleString(getAppIntlLocale()) : '—'}</span>
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
        team={a.team}
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
      <span className="af-bd-asset-val">{a.value != null ? a.value.toLocaleString(getAppIntlLocale()) : '—'}</span>
    </span>
  )
}

type TeamGradeCopy = (typeof tradeTeamGradesMessages)['en']

/** One side of the trade: who got it, their grade beside their name, then what they got. */
function TradeSide({
  team,
  assets,
  letter,
  leagueId,
  copy,
  testId,
}: {
  team: string
  assets: TradeAsset[]
  letter: Letter | null
  leagueId: string
  copy: TeamGradeCopy
  testId: string
}) {
  return (
    <div className="af-bd-side" data-testid={testId}>
      <span className="af-bd-side-label af-tg-side-head">
        <span>{copy.got(team)}</span>
        {letter ? (
          <span className="af-tg-grade" data-tone={letterTone(letter)} aria-label={copy.gradeFor(team, letter)} data-testid={`${testId}-grade`}>
            <span className="af-tg-grade-k" aria-hidden>
              {copy.grade}
            </span>
            <span className="af-tg-grade-v" aria-hidden>
              {letter}
            </span>
          </span>
        ) : null}
      </span>
      {assets.length > 0 ? (
        assets.map((a) => <Asset key={`${testId}-${a.id}`} a={a} leagueId={leagueId} />)
      ) : (
        <span className="af-bd-asset">
          {/*
            ⚠ THIS SENTENCE USED TO READ "Picks or FAAB only — no players on this side", AND IT WAS
            USUALLY FALSE. Picks render as assets now, so an empty side is genuinely empty: FAAB, or a
            side the importer never captured.
          */}
          <span className="af-bd-asset-name">{copy.nothingOnRecord}</span>
        </span>
      )}
    </div>
  )
}

/*
 * Each side is named for the team that RECEIVED it (2026-10-01) — "<team> got" — and since 2026-11-14 each
 * carries THAT team's grade beside its name. The board used to show one letter ("Latest grade A") for
 * `fromName` only, with nothing saying whose it was.
 *
 * ⚠ `received` IS `fromName`'s SIDE AND `letter` IS `fromName`'s GRADE; `sent` went to `toName`, whose
 * grade is `partnerLetter`. Pairing them the other way round silently inverts every grade on the board.
 */
function TradeBody({ t, leagueId, copy }: { t: BoardTrade; leagueId: string; copy: TeamGradeCopy }) {
  const grades = teamGrades(t.letter, t.partnerLetter)
  const verdict = grades ? tradeVerdict(grades) : null
  return (
    <>
      {verdict ? (
        <p className="af-tg-verdict" data-tone={verdict.kind === 'fair' ? 'warn' : 'good'} data-testid="trade-verdict">
          {verdict.kind === 'fair' ? copy.fair : copy.won(verdict.winner === 'first' ? t.fromName : t.toName)}
        </p>
      ) : null}
      <div className="af-bd-card-body">
        <TradeSide team={t.fromName} assets={t.received} letter={grades?.first ?? null} leagueId={leagueId} copy={copy} testId="trade-side-first" />
        <TradeSide team={t.toName} assets={t.sent} letter={grades?.second ?? null} leagueId={leagueId} copy={copy} testId="trade-side-second" />
      </div>
    </>
  )
}

function WindowCard({ row, copy }: { row: TradeWindowRow; copy: TeamGradeCopy }) {
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
          {row.freshTrade ? (
            <span className="af-bd-tag" data-sev="good">
              NEW TRADE
            </span>
          ) : null}
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
          <TradeBody t={t} leagueId={row.leagueId} copy={copy} />
        ) : (
          <p className="af-bd-reason">No trade has been made in this league on any season we hold.</p>
        )}

        <div className="af-bd-card-foot af-tg-foot">
          {/*
            2026-11-14: one line of numbers and the date, then the details folded. Gone from here: the lone
            "Latest grade" letter (each side carries its own grade now), "Who got more value 60% · 40%" (the
            same fact as the letters and the line below), and the league's deadline sentence, which sat
            under the grade looking like an explanation of it — the header's tag already says it.

            ⚠ THE REFUSAL IS STILL RENDERED HERE, NOT LEFT TO PROSE: an ungraded trade says why in the
            slot where its grades would be, and shows no letter at all.
          */}
          {t && !t.letter ? (
            <p className="af-tg-values" data-testid="trade-not-graded">
              {copy.notGraded(t.withheldReason ?? 'no reason recorded')}
            </p>
          ) : null}
          {t?.letter && t.getValue != null && t.giveValue != null ? (
            <p className="af-tg-values" data-testid="trade-values">
              {copy.values(t.fromName, t.getValue.toLocaleString(getAppIntlLocale()), t.giveValue.toLocaleString(getAppIntlLocale()))}
              {t.season != null ? <span className="af-tg-when"> · {copy.when(t.week, t.season)}</span> : null}
            </p>
          ) : t?.season != null ? (
            <p className="af-tg-values af-tg-when">{copy.when(t.week, t.season)}</p>
          ) : null}
          {!t ? <p className="af-bd-reason">{row.reasoning}</p> : null}
          {/*
            WHY it graded that way, folded. The first breakdown line is the verdict in other words ("X came
            out well ahead — …"), which the verdict line and the numbers above already say, so it is left
            out; the rest (the most valuable asset, any league-specific prices, and the basis) is what a
            reader opens this for.

            🛑 EMPTY FOR AN UNGRADED TRADE, BY CONSTRUCTION IN THE LOADER.
          */}
          {t && t.breakdown.length > 1 ? (
            <details className="af-tg-fold" data-testid="trade-how-graded">
              <summary>{copy.howGraded}</summary>
              <ul className="af-bd-breakdown">
                {t.breakdown.slice(1).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </article>
    </li>
  )
}

export function TradesBoard({ data, allHref, totalLeagues, embedded = false, language = null }: TradesBoardProps) {
  // A server component: the catalog is read directly, not through the client hook.
  const guide = messagesFor(tradesGuideMessages, language)
  const teamCopy = messagesFor(tradeTeamGradesMessages, language)
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
  /* The loader leads with leagues traded this week or last, newest first — the label must say so. */
  const anyFresh = data.windows.some((w) => w.freshTrade)

  /* No leagues on this account yet: say so and offer a way forward (BoardKit NoLeaguesYet). */
  if (totalLeagues === 0) {
    return (
      <div className="af-bd">
        <BoardHead eyebrow="Core · Trades" title="Trades" blurb="Your trade windows, soonest to close first — with the most recent real trade in each league and how it graded." />
        <NoLeaguesYet what="Once one is, this board ranks your leagues' trade windows, soonest to close first, with each league's latest trade and how it graded." />
      </div>
    )
  }

  return (
    <div className="af-bd" id={embedded ? 'af-tg-trades' : undefined}>
      {embedded ? (
        <div className="af-tg-sec-head">
          <h2>{guide.tradesTitle}</h2>
          <p>{guide.tradesSub}</p>
        </div>
      ) : (
        <BoardHead
          eyebrow="Core · Trades"
          title="Trades"
          blurb="Your trade windows, soonest to close first — with the most recent real trade in each league and how it graded."
        />
      )}

      {/*
        Sleeper never shares an offer before it is accepted, so a manager looking here for one they
        were just sent must be told why it is missing and how to grade it (Guap, 2026-09-30).
        Embedded, the guide's "Check a trade" card says this in one line with the upload link.
      */}
      {!embedded && data.windows.some((w) => w.platform === 'sleeper') ? <SleeperOffersNotice className="af-bd-sec" /> : null}

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
              embedded
                ? anyFresh
                  ? 'Newest trades first'
                  : anyTrades
                    ? 'Leagues with trades first'
                    : 'No trades on file yet'
                : anyDeadline
                ? anyFresh
                  ? `Top ${data.windows.length} · newest trades first, then leagues with trades, then deadline`
                  : anyTrades
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
              <WindowCard key={w.leagueId} row={w} copy={teamCopy} />
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
      {embedded ? (
        <details className="af-bd-note af-bd-note--plain af-tg-how">
          <summary>{guide.howGrades}</summary>
          <p>
            Grades price both sides on this league&rsquo;s own values. A completed trade keeps the grade it got
            the first time AllFantasy graded it, so it does not change as values move. A trade whose assets could
            not all be priced is shown with its reason instead of a letter.
            {data.deadlineUnknown > 0
              ? ` ${data.deadlineUnknown} of your leagues have never published a trade deadline; they sort below the ones that have.`
              : ''}
          </p>
        </details>
      ) : null}
      {embedded ? (
        <WhyFold label={guide.why}>{guide.tradesTeach}</WhyFold>
      ) : null}

      {!embedded && data.deadlineUnknown > 0 ? (
        <p className="af-bd-note">
          <strong>
            {data.deadlineUnknown} of your leagues have never published a trade deadline.
          </strong>{' '}
          They sort below the ones that have — not because their window is open, but because
          we do not know when it shuts.
        </p>
      ) : null}

      {embedded ? null : (
      <p className="af-bd-note af-bd-note--plain">
        Grades price both sides on this league&rsquo;s own values. A completed trade keeps the
        grade it got the first time AllFantasy graded it, so it does not change as values move.
        A trade whose assets could not all be priced is shown with its reason instead of a
        letter — a &ldquo;C&rdquo; from no data would read as &ldquo;an average trade&rdquo;.
      </p>
      )}

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
