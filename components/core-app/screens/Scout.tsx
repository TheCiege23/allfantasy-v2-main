'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

import '@/components/core-app/af-scout.css'
import { CoreDepthLock, FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import { TopicTip } from '@/components/core-app/TopicTip'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import type { ScoutEdge, ScoutEdgeManager } from '@/lib/competitive-edge/scoutEdgeLoader'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import type { SectionState } from '@/lib/core-app/leagueHome'
import type { ScoutData, ScoutedManager, ScoutStanding } from '@/lib/core-app/scout'
import type { Record3, Zone } from '@/lib/core-app/standingsModel'
import type { RailStanding } from '@/lib/core-app/railMatchups'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'
import { messagesFor } from '@/lib/i18n/messages'
import { scoutScreenMessages } from '@/lib/core-app/messages/scoutScreen'

/**
 * Scout — the first room of the War Room.
 *
 * Every manager in the league, where they stand and how they have played lately, with the one you
 * play this week pinned above the rest and your head-to-head record against them.
 *
 * ── 🛑 WHAT THIS SCREEN REFUSES TO DO ───────────────────────────────────────
 *
 * ❌ IT DOES NOT CHARACTERISE A MANAGER. Every line is a fact from the Standings screen's own table —
 *    seed, record, points, last five results, playoff zone. No label, no score, no "type". See the
 *    loader's header (lib/core-app/scout.ts) for why.
 *
 * ❌ IT DOES NOT COMPUTE A PROJECTION. The matchup's projected score and win odds live on Matchup,
 *    priced through My Team's own lineup rules; a second, simpler number here would disagree with
 *    them. The banner links there instead.
 *
 * ❌ IT DOES NOT HIDE THE BASIS. "Through week 3" is printed before the cards, because it changes how
 *    every record under it reads — the same rule the old coverage line followed.
 */

export type ScoutProps = {
  data: ScoutData
  /**
   * The War Room's other room, and the two screens the opponent banner hands off to.
   *
   * Passed in rather than built here: the league query param belongs to the
   * router, and a screen that assembles its own sibling's href is a screen that
   * can silently disagree with it.
   */
  gamePlanHref: string
  matchupHref: string
  /**
   * The league's standings — where an elimination week's whole field is listed against the cut,
   * with every lineup's projection. The elimination banner links here, not to `matchupHref`: a
   * guillotine league's Matchup screen only says there is no head-to-head, so "Every team against
   * the cut" landed on a page with no teams on it (2026-10-03).
   */
  standingsHref: string
  tradesHref: string
  /**
   * Competitive Edge — every other manager's trade and waiver record. Null to a viewer whose plan
   * does not include it: the server never loaded it, and `edgeAccess` draws the lock in its place.
   */
  edge?: SectionState<ScoutEdge> | null
  edgeAccess?: CoreDepthAccess | null
  /**
   * THIS league's game plan (War Room step 4c), rendered after the opponent banner: who you play,
   * then what you must fix before it locks, then everyone else. A node rather than data so Scout
   * stays a reader of standings and the page decides what Game Plan shows.
   */
  leaguePlan?: ReactNode
  /**
   * Elimination formats: your place against the cut this week — the rail's own read (getRailMatchups
   * `standing`), handed down so this banner and the rail cannot disagree. Null outside an elimination
   * week or when the rail could not rank the league.
   */
  eliminationStanding?: RailStanding | null
}

/**
 * "Sep 21, 2025" / "21 sept 2025" — pinned to Eastern so the server paint and the client agree. One
 * formatter per locale (the catalog's `dayLocale`), built once.
 */
const DAY_FORMATS = new Map<string, Intl.DateTimeFormat>()
function dayFormat(locale: string): Intl.DateTimeFormat {
  let f = DAY_FORMATS.get(locale)
  if (!f) DAY_FORMATS.set(locale, (f = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })))
  return f
}

/**
 * The reader's language, for every part of this screen.
 *
 * ⚠ A CLIENT COMPONENT NOW, FOR THIS. Scout rendered on the server, where the language switch (client
 * state) cannot be read, so the whole room stayed English in Spanish mode (2026-10-03 audit). Its
 * imports were checked first: nothing in its graph is server-only.
 *
 * ⚠ AND MUCH OF IT IS WRITTEN BY A LOADER — the standings basis, every "unavailable" reason, the
 * Competitive Edge reasons — which arrive in English whatever the reader chose. Each goes through
 * `copy`, whose patterns rebuild the templated ones around their values.
 */
function useScoutCopy() {
  const { language } = useOptionalLanguage()
  const m = messagesFor(scoutScreenMessages, language)
  return {
    language,
    m,
    copy: (english: string) => coreUiCopy(english, language),
    day: (iso: string | null): string | null => {
      if (!iso) return null
      const d = new Date(iso)
      return Number.isNaN(d.getTime()) ? null : dayFormat(m.dayLocale).format(d)
    },
  }
}

/**
 * One manager's record as counts — "7 trades · last Sep 21, 2025 · 12 waiver claims won · $64 FAAB
 * left". Facts only, the Competitive Edge contract: nothing here says what kind of trader they are.
 */
function EdgeLine({ m }: { m: ScoutEdgeManager }) {
  const { m: msg, day } = useScoutCopy()
  const parts: string[] = []
  if (m.trades != null) {
    const last = day(m.lastTradeAt)
    parts.push(m.trades === 0 ? msg.edgeNoTrades : msg.edgeTrades(m.trades, last))
  }
  if (m.waiverClaims != null) {
    parts.push(msg.edgeWaiverClaims(m.waiverClaims))
  }
  if (m.faabRemaining != null) {
    const left = Math.round(m.faabRemaining).toLocaleString(getAppIntlLocale())
    parts.push(msg.edgeFaabLeft(left))
  }
  if (parts.length === 0) return null
  return <p className="af-sc-edge af-num">{parts.join(' · ')}</p>
}

/** What the edge counts are measured over — said once, above the cards, like the standings basis. */
function EdgeBasis({ edge, access }: { edge: SectionState<ScoutEdge>; access: CoreDepthAccess | null }) {
  const { language, m, copy, day } = useScoutCopy()
  if (!edge.available) {
    return <p className="af-sc-edge-basis">Competitive Edge: {copy(edge.reason).replace(/\.$/, '')}.</p>
  }
  const t = edge.data.trades
  const w = edge.data.waivers
  const seasons = t.available ? t.data.seasons : []
  const span = seasons.length > 1 ? `${[...seasons].sort()[0]}–${[...seasons].sort().slice(-1)[0]}` : seasons[0] ?? null
  return (
    <p className="af-sc-edge-basis">
      <strong>Competitive Edge</strong> <TopicTip topic="competitiveEdge" />
      {' · '}
      {t.available
        ? m.edgeBasisTrades(span, day(t.data.asOf), t.data.stale)
        : `${m.edgeBasisTradesLabel}: ${copy(t.reason)}`}
      {' · '}
      {w.available
        ? m.edgeBasisWaivers(w.data.season, w.data.stale)
        : `${m.edgeBasisWaiversLabel}: ${copy(w.reason)}`}
      .{access ? <> <FreeUntilNote access={access} lang={language} /></> : null}
    </p>
  )
}

const ZONE_TONE: Record<Zone, 'good' | 'warn' | 'bad' | 'info'> = {
  bye: 'good',
  playoff: 'good',
  bubble: 'warn',
  out: 'info',
  eliminated: 'bad',
}

/**
 * Where a team stands in an ELIMINATION week — the only zones such a league has.
 *
 * 🛑 AN ELIMINATION LEAGUE HAS NO PLAYOFFS. The cards labelled every team from the season table's
 * playoff zones — "Bye spot", "Playoff spot", "Outside the playoffs" — in a guillotine league (owner's
 * report, 2026-10-03). What a card should speak to is this week's cut: chopped already, in the bottom
 * of the live field this week (`RailStanding.bubble`, the banner's own ordering), or safe.
 */
type ElimStatus = 'safe' | 'bubble' | 'eliminated'
const ELIM_TONE: Record<ElimStatus, 'good' | 'warn' | 'bad'> = { safe: 'good', bubble: 'warn', eliminated: 'bad' }

/**
 * A chopped team is Eliminated. A live team is On the bubble or Safe by THIS week's ordering — and
 * when the week cannot be ranked yet (no standing from the rail), nothing is said rather than a guess.
 */
function elimStatusOf(m: ScoutedManager, standing: RailStanding | null): ElimStatus | null {
  if (m.eliminated) return 'eliminated'
  if (!standing?.bubble) return null
  return standing.bubble.includes(m.managerId) ? 'bubble' : 'safe'
}

function recordText(r: Record3): string {
  return `${r.wins}-${r.losses}${r.ties > 0 ? `-${r.ties}` : ''}`
}

/** Points with one decimal, pinned to en-US so the server and any client agree on the separator. */
function points(n: number): string {
  return n.toLocaleString(getAppIntlLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/*
 * ⚠ "ON THE PLAYOFF LINE" READ AS A CONTRADICTION beside "Outside the playoffs" on the live page: the
 * zone is where the tiebreak puts the team, games-back is the record alone, and a team level on record
 * with the last playoff spot can sit either side of it. Say what the number is — tied, behind, ahead —
 * in games, so the two lines read as two facts. The wording is `gamesBack` in the screen's catalog.
 */

/** Last five head-to-head results as chips — the letters carry the meaning, the colour only repeats it. */
function Form({ form }: { form: ScoutStanding['form'] }) {
  const { m } = useScoutCopy()
  if (form.length === 0) return null
  return (
    <span className="af-sc-form" aria-label={m.formAria(form.length, form.join(' '))}>
      {form.map((r, i) => (
        <span key={i} className="af-sc-form-r" data-r={r} aria-hidden>
          {r}
        </span>
      ))}
    </span>
  )
}

function Facts({ s }: { s: ScoutStanding }) {
  const { m } = useScoutCopy()
  return (
    <dl className="af-sc-facts">
      <div>
        <dt>{m.factSeed}</dt>
        <dd className="af-num">#{s.seed}</dd>
      </div>
      <div>
        <dt>{m.factRecord}</dt>
        <dd className="af-num">{recordText(s.record)}</dd>
      </div>
      <div>
        <dt>{m.factPointsFor}</dt>
        <dd className="af-num">{points(s.pointsFor)}</dd>
      </div>
      <div>
        <dt>{m.factPower}</dt>
        <dd className="af-num">#{s.powerRank}</dd>
      </div>
    </dl>
  )
}

function ManagerCard({
  m,
  tradesHref,
  edge,
  elimination = null,
}: {
  m: ScoutedManager
  tradesHref: string
  edge: ScoutEdgeManager | null
  /** Set in an elimination league: the card shows Safe / On the bubble / Eliminated, never a playoff zone. */
  elimination?: { status: ElimStatus | null } | null
}) {
  const { m: msg } = useScoutCopy()
  const s = m.standing
  return (
    <li>
      <article
        className="af-card af-sc-card"
        data-opponent={m.isNextOpponent || undefined}
        data-you={m.isYou || undefined}
        data-eliminated={m.eliminated ? 'true' : undefined}
      >
        <header className="af-sc-card-head">
          {m.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="af-sc-face" src={m.avatarUrl} alt="" width={36} height={36} loading="lazy" />
          ) : (
            <span className="af-sc-face af-sc-face--none" aria-hidden>
              {m.teamName.charAt(0).toUpperCase()}
            </span>
          )}

          <span className="af-sc-who">
            <span className="af-sc-team">{m.teamName}</span>
            <span className="af-sc-owner">{m.ownerName ?? msg.ownerUnnamed}</span>
          </span>

          {m.eliminated ? (
            <span className="af-sc-tag" data-sev="out">
              {msg.tagOut(m.eliminated.week)}
            </span>
          ) : m.isNextOpponent ? (
            <span className="af-sc-tag" data-sev="bad">
              {msg.tagThisWeek}
            </span>
          ) : m.isYou ? (
            <span className="af-sc-tag" data-sev="info">
              {msg.tagYou}
            </span>
          ) : null}
        </header>

        {s ? (
          <>
            <Facts s={s} />
            <p className="af-sc-line">
              {elimination ? (
                elimination.status ? (
                  <span className="af-sc-zone" data-tone={ELIM_TONE[elimination.status]} data-elim={elimination.status}>
                    {msg.elimLabel(elimination.status)}
                  </span>
                ) : null
              ) : (
                <span className="af-sc-zone" data-tone={ZONE_TONE[s.zone]}>
                  {msg.zoneLabel(s.zone)}
                </span>
              )}
              {/* Games back is a playoff-line measure; an elimination league has no line to be back of. */}
              {!elimination && s.gamesBack != null ? <span className="af-num">{msg.gamesBack(s.gamesBack)}</span> : null}
              <Form form={s.form} />
            </p>
          </>
        ) : (
          <p className="af-sc-unavailable">{msg.notOnStandings}</p>
        )}

        {/* Dynasty: the dynasty War Room's own pick read, as a count — facts, never a valuation label. */}
        {m.picks ? (
          <p className="af-sc-picks af-num">
            {m.picks.count === 0 ? msg.picksNone : msg.picksHeld(m.picks.count, m.picks.early)}
          </p>
        ) : null}

        {edge ? <EdgeLine m={edge} /> : null}

        {/* No trade with yourself, and none with a chopped team — its roster has gone to waivers. */}
        {m.isYou || m.eliminated ? null : (
          <footer className="af-sc-card-foot">
            {/*
              The Trade Center grades a deal with them, and its Competitive Edge section binds their
              trade record to the positions in that deal — more than the counts above can say.
            */}
            <Link className="af-sc-cta" href={tradesHref}>
              {msg.buildTrade} &rarr;
            </Link>
          </footer>
        )}
      </article>
    </li>
  )
}

function OpponentBanner({ data, matchupHref, tradesHref }: { data: ScoutData; matchupHref: string; tradesHref: string }) {
  const { m } = useScoutCopy()
  const opp = data.opponent
  if (!opp) return null
  const them = data.managers.available ? data.managers.data.find((m) => m.managerId === opp.managerId) ?? null : null
  const youStanding = data.you?.standing ?? null
  const h2h = opp.headToHead

  return (
    <section className="af-frame af-sc-vs" aria-labelledby="af-sc-vs-h">
      <h2 className="af-label af-sc-vs-label" id="af-sc-vs-h">
        {m.thisWeek}
        {data.week ? m.weekSuffix(data.week.week) : ''}
      </h2>
      <div className="af-sc-vs-sides">
        <div className="af-sc-vs-side" data-side="you">
          <span className="af-sc-vs-name">{data.you?.teamName ?? m.youFallback}</span>
          <span className="af-sc-vs-meta af-num">
            {youStanding ? `#${youStanding.seed} · ${recordText(youStanding.record)}` : m.notOnTableYet}
          </span>
        </div>
        <span className="af-sc-vs-v" aria-hidden>
          vs
        </span>
        <div className="af-sc-vs-side" data-side="them">
          <span className="af-sc-vs-name">{opp.teamName}</span>
          <span className="af-sc-vs-meta af-num">
            {them?.standing ? `#${them.standing.seed} · ${recordText(them.standing.record)}` : m.notOnTableYet}
          </span>
          {them?.standing ? <Form form={them.standing.form} /> : null}
        </div>
      </div>
      <p className="af-sc-vs-h2h">
        {h2h ? (
          <>
            {m.h2hBefore}
            <span className="af-num">{recordText(h2h)}</span>
            {m.h2hAfter}
          </>
        ) : (
          m.h2hNone
        )}
      </p>
      <div className="af-sc-vs-links">
        <Link className="af-sc-cta af-sc-cta--primary" href={matchupHref}>
          {m.projectedLink} &rarr;
        </Link>
        <Link className="af-sc-cta" href={tradesHref}>
          {m.buildTrade} &rarr;
        </Link>
      </div>
    </section>
  )
}

/**
 * An elimination week has no opponent — it has a cut. Your rank and your margin over the lowest team,
 * from the rail's read; "projected" said out loud before a snap is played, because then the rank comes
 * from projections, not points.
 */
function EliminationBanner({ data, standing, standingsHref }: { data: ScoutData; standing: RailStanding | null; standingsHref: string }) {
  const { m } = useScoutCopy()
  const me = data.managers.available ? data.managers.data.find((m) => m.isYou) ?? null : null
  if (me?.eliminated) {
    return (
      <section className="af-frame af-sc-vs" data-elimination="out" aria-labelledby="af-sc-vs-h">
        <h2 className="af-label af-sc-vs-label" id="af-sc-vs-h">
          {m.eliminationLeague}
        </h2>
        <p className="af-sc-vs-h2h">
          {m.chopped(me.eliminated.week)}
        </p>
      </section>
    )
  }
  return (
    <section className="af-frame af-sc-vs" data-elimination="alive" aria-labelledby="af-sc-vs-h">
      <h2 className="af-label af-sc-vs-label" id="af-sc-vs-h">
        {m.eliminationWeek}
        {data.week ? m.weekSuffix(data.week.week) : ''}
      </h2>
      {standing ? (
        <p className="af-sc-vs-h2h af-num">
          {m.youAre} <strong>#{standing.rank}</strong> {m.of} {standing.outOf}
          {standing.overCut == null ? m.atCutLine : m.overCut(standing.overCut)}
          {standing.basis === 'projected' ? m.projectedNote : ''}{' '}
          {/* Beside the h2, not in it: the h2 names the section (aria-labelledby). */}
          <TopicTip topic="scoutEliminationStanding" />
        </p>
      ) : (
        <p className="af-sc-vs-h2h">
          {m.cutUnreadable}{' '}
          <TopicTip topic="scoutEliminationStanding" />
        </p>
      )}
      <div className="af-sc-vs-links">
        <Link className="af-sc-cta af-sc-cta--primary" href={standingsHref}>
          {m.everyTeamVsCut} &rarr;
        </Link>
      </div>
    </section>
  )
}

/** One line on what this format changes about the screen, when it changes anything. */
function FormatNote({ format }: { format: ScoutData['format'] }) {
  const { m, copy } = useScoutCopy()
  if (format.bestBall) {
    return (
      <p className="af-sc-format">
        {m.bestBallNote}
      </p>
    )
  }
  if (format.dynasty && format.picks) {
    if (format.picks.state === 'missing') {
      return (
        <p className="af-sc-format">
          {m.dynastyPicksMissing}
        </p>
      )
    }
    if (format.picks.state === 'partial' && format.picks.note) {
      return (
        <p className="af-sc-format">
          {m.dynastyPicksLabel}: {copy(format.picks.note)}
        </p>
      )
    }
  }
  return null
}

export function Scout({
  data,
  gamePlanHref,
  matchupHref,
  standingsHref,
  tradesHref,
  edge = null,
  edgeAccess = null,
  leaguePlan = null,
  eliminationStanding = null,
}: ScoutProps) {
  const edgeBy = edge?.available ? edge.data.byManager : null
  const { language, m, copy } = useScoutCopy()
  return (
    <div className="af-sc">
      <header className="af-frame af-sc-head">
        <div className="af-sc-head-text">
          <h1 className="af-display af-sc-title">Scout · {data.league.name}</h1>
          <p className="af-sc-blurb">
            {m.blurb}
            {data.week ? m.blurbWeek(data.week.week, data.week.seasonYear) : ''}
          </p>
        </div>
        {/*
          The War Room's other room. Scout is about WHO you are playing; Game
          Plan is about what you must do before kickoff — different questions,
          so they are two rooms rather than one crowded screen.
        */}
        {/* This league's plan is on this page now (step 4c); the link is to every league's. */}
        <Link className="af-sc-switch" href={gamePlanHref}>
          {m.everyLeaguePlan} &rarr;
        </Link>
      </header>

      {data.format.elimination ? (
        <EliminationBanner data={data} standing={eliminationStanding} standingsHref={standingsHref} />
      ) : (
        <OpponentBanner data={data} matchupHref={matchupHref} tradesHref={tradesHref} />
      )}

      <FormatNote format={data.format} />

      {leaguePlan}

      {/*
        ⚠ BEFORE THE CARDS, ALWAYS. What the records are measured over changes how every one of them
        reads; a basis printed after the evidence is a caveat that arrives too late.
      */}
      {/* Only beside a list: with no managers the list's own reason is the whole story, said once. */}
      {data.managers.available ? (
        <p className="af-sc-basis" data-available={data.basis.available || undefined}>
          {data.basis.available ? (
            <>
              {m.standingsThroughWeek} <span className="af-num">{data.basis.data.throughWeek}</span>{' '}
              {m.of} <span className="af-num">{data.basis.data.season}</span>
              {data.basis.data.seasonComplete ? m.seasonFinal : ''}. {copy(data.basis.data.orderBasis)}{' '}
              <TopicTip topic="scoutCardLegend" />
            </>
          ) : (
            <>
              {m.noStandingsYet}: {copy(data.basis.reason).replace(/\.$/, '')}.
            </>
          )}
        </p>
      ) : null}

      {/*
        Competitive Edge, once, above the cards. A viewer without the plan sees the lock in its place —
        and was never sent the counts (loadScoutEdgeForScreen returns null for them).
      */}
      {data.managers.available ? (
        edgeAccess && !edgeAccess.unlocked ? (
          <CoreDepthLock
            access={edgeAccess}
            what={m.edgeLockWhat}
            lang={language}
          />
        ) : edge ? (
          <EdgeBasis edge={edge} access={edgeAccess} />
        ) : null
      ) : null}

      {data.managers.available ? (
        <ul className="af-sc-list">
          {data.managers.data.map((m) => (
            <ManagerCard
              key={m.managerId}
              m={m}
              tradesHref={tradesHref}
              edge={m.isYou ? null : (edgeBy?.[m.managerId] ?? null)}
              elimination={data.format.elimination ? { status: elimStatusOf(m, eliminationStanding) } : null}
            />
          ))}
        </ul>
      ) : (
        <section className="af-frame af-sc-section">
          <p className="af-sc-unavailable">{copy(data.managers.reason)}</p>
        </section>
      )}
    </div>
  )
}

export default Scout
