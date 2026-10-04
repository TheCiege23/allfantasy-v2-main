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

/** "Sep 21, 2025" / "21 sept 2025" — pinned to Eastern so the server paint and the client agree. */
const DAY_EN = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
const DAY_ES = new Intl.DateTimeFormat('es-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })

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
  const es = language === 'es'
  return {
    es,
    copy: (english: string) => coreUiCopy(english, language),
    day: (iso: string | null): string | null => {
      if (!iso) return null
      const d = new Date(iso)
      return Number.isNaN(d.getTime()) ? null : (es ? DAY_ES : DAY_EN).format(d)
    },
  }
}

/**
 * One manager's record as counts — "7 trades · last Sep 21, 2025 · 12 waiver claims won · $64 FAAB
 * left". Facts only, the Competitive Edge contract: nothing here says what kind of trader they are.
 */
function EdgeLine({ m }: { m: ScoutEdgeManager }) {
  const { es, day } = useScoutCopy()
  const parts: string[] = []
  if (m.trades != null) {
    const last = day(m.lastTradeAt)
    parts.push(
      m.trades === 0
        ? es
          ? 'ningún intercambio completado'
          : 'no completed trades'
        : es
          ? `${m.trades} ${m.trades === 1 ? 'intercambio' : 'intercambios'}${last ? ` · el último ${last}` : ''}`
          : `${m.trades} ${m.trades === 1 ? 'trade' : 'trades'}${last ? ` · last ${last}` : ''}`,
    )
  }
  if (m.waiverClaims != null) {
    parts.push(
      es
        ? `${m.waiverClaims} ${m.waiverClaims === 1 ? 'reclamo ganado' : 'reclamos ganados'}`
        : `${m.waiverClaims} waiver ${m.waiverClaims === 1 ? 'claim' : 'claims'} won`,
    )
  }
  if (m.faabRemaining != null) {
    const left = Math.round(m.faabRemaining).toLocaleString('en-US')
    parts.push(es ? `le quedan $${left} de FAAB` : `$${left} FAAB left`)
  }
  if (parts.length === 0) return null
  return <p className="af-sc-edge af-num">{parts.join(' · ')}</p>
}

/** What the edge counts are measured over — said once, above the cards, like the standings basis. */
function EdgeBasis({ edge, access }: { edge: SectionState<ScoutEdge>; access: CoreDepthAccess | null }) {
  const { es, copy, day } = useScoutCopy()
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
        ? es
          ? `intercambios completados${span ? ` en ${span}` : ''}, leídos ${day(t.data.asOf) ?? 'hace poco'}${t.data.stale ? ' (puede estar desactualizado)' : ''}`
          : `completed trades${span ? ` across ${span}` : ''}, read ${day(t.data.asOf) ?? 'recently'}${t.data.stale ? ' (may be out of date)' : ''}`
        : `${es ? 'intercambios' : 'trades'}: ${copy(t.reason)}`}
      {' · '}
      {w.available
        ? es
          ? `reclamos ganados en ${w.data.season}${w.data.stale ? ' (puede estar desactualizado)' : ''}: Sleeper solo registra los reclamos ganados`
          : `waiver claims won in ${w.data.season}${w.data.stale ? ' (may be out of date)' : ''} — Sleeper records only winning claims`
        : `${es ? 'agentes libres' : 'waivers'}: ${copy(w.reason)}`}
      .{access ? <> <FreeUntilNote access={access} /></> : null}
    </p>
  )
}

const ZONE_LABEL: Record<Zone, string> = {
  bye: 'Bye spot',
  playoff: 'Playoff spot',
  bubble: 'On the bubble',
  out: 'Outside the playoffs',
  eliminated: 'Eliminated',
}
const ZONE_LABEL_ES: Record<Zone, string> = {
  bye: 'Puesto con descanso',
  playoff: 'Puesto de playoffs',
  bubble: 'En el límite',
  out: 'Fuera de los playoffs',
  eliminated: 'Eliminado',
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
const ELIM_LABEL: Record<ElimStatus, string> = { safe: 'Safe', bubble: 'On the bubble', eliminated: 'Eliminated' }
const ELIM_LABEL_ES: Record<ElimStatus, string> = { safe: 'A salvo', bubble: 'En el límite', eliminated: 'Eliminado' }
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
  return n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/*
 * ⚠ "ON THE PLAYOFF LINE" READ AS A CONTRADICTION beside "Outside the playoffs" on the live page: the
 * zone is where the tiebreak puts the team, games-back is the record alone, and a team level on record
 * with the last playoff spot can sit either side of it. Say what the number is — tied, behind, ahead —
 * in games, so the two lines read as two facts.
 */
function gamesBackText(gb: number, es: boolean): string {
  if (es) {
    const juegos = (n: number) => `${n} ${n === 1 ? 'juego' : 'juegos'}`
    if (gb > 0) return `a ${juegos(gb)} de un puesto de playoffs`
    if (gb < 0) return `${juegos(-gb)} por encima del corte`
    return 'empatado en récord con el último puesto de playoffs'
  }
  const games = (n: number) => `${n} ${n === 1 ? 'game' : 'games'}`
  if (gb > 0) return `${games(gb)} back of a playoff spot`
  if (gb < 0) return `${games(-gb)} clear of the cut`
  return 'tied on record with the last playoff spot'
}

/** Last five head-to-head results as chips — the letters carry the meaning, the colour only repeats it. */
function Form({ form }: { form: ScoutStanding['form'] }) {
  const { es } = useScoutCopy()
  if (form.length === 0) return null
  return (
    <span className="af-sc-form" aria-label={es ? `Últimos ${form.length}: ${form.join(' ')}` : `Last ${form.length}: ${form.join(' ')}`}>
      {form.map((r, i) => (
        <span key={i} className="af-sc-form-r" data-r={r} aria-hidden>
          {r}
        </span>
      ))}
    </span>
  )
}

function Facts({ s }: { s: ScoutStanding }) {
  const { es } = useScoutCopy()
  return (
    <dl className="af-sc-facts">
      <div>
        <dt>{es ? 'Posición' : 'Seed'}</dt>
        <dd className="af-num">#{s.seed}</dd>
      </div>
      <div>
        <dt>{es ? 'Récord' : 'Record'}</dt>
        <dd className="af-num">{recordText(s.record)}</dd>
      </div>
      <div>
        <dt>{es ? 'Puntos a favor' : 'Points for'}</dt>
        <dd className="af-num">{points(s.pointsFor)}</dd>
      </div>
      <div>
        <dt>{es ? 'Poder' : 'Power'}</dt>
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
  const { es } = useScoutCopy()
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
            <span className="af-sc-owner">{m.ownerName ?? (es ? 'Mánager sin nombre' : 'Manager not named')}</span>
          </span>

          {m.eliminated ? (
            <span className="af-sc-tag" data-sev="out">
              {es
                ? m.eliminated.week != null
                  ? `FUERA · SEMANA ${m.eliminated.week}`
                  : 'FUERA'
                : m.eliminated.week != null
                  ? `OUT · WEEK ${m.eliminated.week}`
                  : 'OUT'}
            </span>
          ) : m.isNextOpponent ? (
            <span className="af-sc-tag" data-sev="bad">
              {es ? 'ESTA SEMANA' : 'THIS WEEK'}
            </span>
          ) : m.isYou ? (
            <span className="af-sc-tag" data-sev="info">
              {es ? 'TÚ' : 'YOU'}
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
                    {(es ? ELIM_LABEL_ES : ELIM_LABEL)[elimination.status]}
                  </span>
                ) : null
              ) : (
                <span className="af-sc-zone" data-tone={ZONE_TONE[s.zone]}>
                  {(es ? ZONE_LABEL_ES : ZONE_LABEL)[s.zone]}
                </span>
              )}
              {/* Games back is a playoff-line measure; an elimination league has no line to be back of. */}
              {!elimination && s.gamesBack != null ? <span className="af-num">{gamesBackText(s.gamesBack, es)}</span> : null}
              <Form form={s.form} />
            </p>
          </>
        ) : (
          <p className="af-sc-unavailable">{es ? 'Todavía no aparece en la clasificación.' : 'Not on the standings table yet.'}</p>
        )}

        {/* Dynasty: the dynasty War Room's own pick read, as a count — facts, never a valuation label. */}
        {m.picks ? (
          <p className="af-sc-picks af-num">
            {m.picks.count === 0
              ? es
                ? 'Sin selecciones futuras'
                : 'No future picks held'
              : es
                ? `${m.picks.count} ${m.picks.count === 1 ? 'selección futura' : 'selecciones futuras'} · ${m.picks.early} en rondas 1–2`
                : `${m.picks.count} future ${m.picks.count === 1 ? 'pick' : 'picks'} · ${m.picks.early} in rounds 1–2`}
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
              {es ? 'Armar un intercambio' : 'Build a trade'} &rarr;
            </Link>
          </footer>
        )}
      </article>
    </li>
  )
}

function OpponentBanner({ data, matchupHref, tradesHref }: { data: ScoutData; matchupHref: string; tradesHref: string }) {
  const { es } = useScoutCopy()
  const opp = data.opponent
  if (!opp) return null
  const them = data.managers.available ? data.managers.data.find((m) => m.managerId === opp.managerId) ?? null : null
  const youStanding = data.you?.standing ?? null
  const h2h = opp.headToHead

  return (
    <section className="af-frame af-sc-vs" aria-labelledby="af-sc-vs-h">
      <h2 className="af-label af-sc-vs-label" id="af-sc-vs-h">
        {es ? 'Esta semana' : 'This week'}
        {data.week ? (es ? ` · semana ${data.week.week}` : ` · week ${data.week.week}`) : ''}
      </h2>
      <div className="af-sc-vs-sides">
        <div className="af-sc-vs-side" data-side="you">
          <span className="af-sc-vs-name">{data.you?.teamName ?? (es ? 'Tú' : 'You')}</span>
          <span className="af-sc-vs-meta af-num">
            {youStanding ? `#${youStanding.seed} · ${recordText(youStanding.record)}` : es ? 'todavía no en la tabla' : 'not on the table yet'}
          </span>
        </div>
        <span className="af-sc-vs-v" aria-hidden>
          vs
        </span>
        <div className="af-sc-vs-side" data-side="them">
          <span className="af-sc-vs-name">{opp.teamName}</span>
          <span className="af-sc-vs-meta af-num">
            {them?.standing ? `#${them.standing.seed} · ${recordText(them.standing.record)}` : es ? 'todavía no en la tabla' : 'not on the table yet'}
          </span>
          {them?.standing ? <Form form={them.standing.form} /> : null}
        </div>
      </div>
      <p className="af-sc-vs-h2h">
        {h2h ? (
          es ? (
            <>
              Vas <span className="af-num">{recordText(h2h)}</span> contra ellos esta temporada.
            </>
          ) : (
            <>
              You are <span className="af-num">{recordText(h2h)}</span> against them this season.
            </>
          )
        ) : es ? (
          'Todavía no te enfrentaste a ellos esta temporada.'
        ) : (
          'You have not played them yet this season.'
        )}
      </p>
      <div className="af-sc-vs-links">
        <Link className="af-sc-cta af-sc-cta--primary" href={matchupHref}>
          {es ? 'Puntuación proyectada y probabilidad de ganar' : 'Projected score & win odds'} &rarr;
        </Link>
        <Link className="af-sc-cta" href={tradesHref}>
          {es ? 'Armar un intercambio' : 'Build a trade'} &rarr;
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
  const { es } = useScoutCopy()
  const me = data.managers.available ? data.managers.data.find((m) => m.isYou) ?? null : null
  if (me?.eliminated) {
    return (
      <section className="af-frame af-sc-vs" data-elimination="out" aria-labelledby="af-sc-vs-h">
        <h2 className="af-label af-sc-vs-label" id="af-sc-vs-h">
          {es ? 'Liga de eliminación' : 'Elimination league'}
        </h2>
        <p className="af-sc-vs-h2h">
          {es
            ? `Te eliminaron${me.eliminated.week != null ? ` en la semana ${me.eliminated.week}` : ''}. Las tarjetas de abajo son los mánagers que siguen vivos.`
            : `You were chopped${me.eliminated.week != null ? ` in week ${me.eliminated.week}` : ''}. The cards below are the managers still alive.`}
        </p>
      </section>
    )
  }
  return (
    <section className="af-frame af-sc-vs" data-elimination="alive" aria-labelledby="af-sc-vs-h">
      <h2 className="af-label af-sc-vs-label" id="af-sc-vs-h">
        {es ? 'Semana de eliminación' : 'Elimination week'}
        {data.week ? (es ? ` · semana ${data.week.week}` : ` · week ${data.week.week}`) : ''}
      </h2>
      {standing ? (
        <p className="af-sc-vs-h2h af-num">
          {es ? 'Vas' : 'You are'} <strong>#{standing.rank}</strong> {es ? 'de' : 'of'} {standing.outOf}
          {standing.overCut == null
            ? es
              ? ': en la línea de corte.'
              : ' — at the cut line.'
            : es
              ? `: ${standing.overCut.toFixed(1)} por encima del corte.`
              : ` — ${standing.overCut.toFixed(1)} over the cut.`}
          {standing.basis === 'projected'
            ? es
              ? ' Proyectado: la mayoría de los equipos todavía no jugó.'
              : ' Projected: most teams have not played yet.'
            : ''}{' '}
          {/* Beside the h2, not in it: the h2 names the section (aria-labelledby). */}
          <TopicTip topic="scoutEliminationStanding" />
        </p>
      ) : (
        <p className="af-sc-vs-h2h">
          {es ? 'Todavía no se puede leer la línea de corte esta semana.' : 'The cut line is not readable yet this week.'}{' '}
          <TopicTip topic="scoutEliminationStanding" />
        </p>
      )}
      <div className="af-sc-vs-links">
        <Link className="af-sc-cta af-sc-cta--primary" href={standingsHref}>
          {es ? 'Todos los equipos frente al corte' : 'Every team against the cut'} &rarr;
        </Link>
      </div>
    </section>
  )
}

/** One line on what this format changes about the screen, when it changes anything. */
function FormatNote({ format }: { format: ScoutData['format'] }) {
  const { es, copy } = useScoutCopy()
  if (format.bestBall) {
    return (
      <p className="af-sc-format">
        {es
          ? 'Best ball: la plataforma alinea a tus máximos anotadores cada semana, así que no hay alineación que armar ni plan de juego para esta liga.'
          : 'Best ball: the platform starts your highest scorers each week, so there is no lineup to set and no game plan for this league.'}
      </p>
    )
  }
  if (format.dynasty && format.picks) {
    if (format.picks.state === 'missing') {
      return (
        <p className="af-sc-format">
          {es ? 'Dinastía: no se pudieron leer las selecciones futuras de esta liga.' : 'Dynasty: future picks could not be read for this league.'}
        </p>
      )
    }
    if (format.picks.state === 'partial' && format.picks.note) {
      return (
        <p className="af-sc-format">
          {es ? 'Selecciones de dinastía' : 'Dynasty picks'}: {copy(format.picks.note)}
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
  const { es, copy } = useScoutCopy()
  return (
    <div className="af-sc">
      <header className="af-frame af-sc-head">
        <div className="af-sc-head-text">
          <h1 className="af-display af-sc-title">Scout · {data.league.name}</h1>
          <p className="af-sc-blurb">
            {es
              ? 'Dónde está cada mánager de esta liga y cómo viene jugando.'
              : 'Where every manager in this league stands, and how they have played lately.'}
            {data.week
              ? es
                ? ` Semana ${data.week.week} de ${data.week.seasonYear}.`
                : ` Week ${data.week.week} of ${data.week.seasonYear}.`
              : ''}
          </p>
        </div>
        {/*
          The War Room's other room. Scout is about WHO you are playing; Game
          Plan is about what you must do before kickoff — different questions,
          so they are two rooms rather than one crowded screen.
        */}
        {/* This league's plan is on this page now (step 4c); the link is to every league's. */}
        <Link className="af-sc-switch" href={gamePlanHref}>
          {es ? 'El plan de juego de cada liga' : "Every league's game plan"} &rarr;
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
              {es ? 'Clasificación hasta la semana' : 'Standings through week'} <span className="af-num">{data.basis.data.throughWeek}</span>{' '}
              {es ? 'de' : 'of'} <span className="af-num">{data.basis.data.season}</span>
              {data.basis.data.seasonComplete ? (es ? ' (final)' : ' — final') : ''}. {copy(data.basis.data.orderBasis)}{' '}
              <TopicTip topic="scoutCardLegend" />
            </>
          ) : (
            <>
              {es ? 'Todavía no hay clasificación' : 'No standings yet'}: {copy(data.basis.reason).replace(/\.$/, '')}.
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
            what={es ? 'El historial de intercambios y reclamos de cada mánager' : 'Every manager’s trade and waiver record'}
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
