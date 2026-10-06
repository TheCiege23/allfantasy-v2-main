'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { OutlookLeague, SwingMatchup } from '@/lib/core-app/seasonOutlook'
import type { FreshnessMeta } from '@/lib/sports-os/freshness'
import type { StandingsLineups } from '@/lib/core-app/standingsLineups'
import { WeekLineupsTable } from '@/components/core-app/standings/WeekLineupsTable'
import { describeTeamOutlook, ordinal, pct, rangeLabel, signedPts, band } from '@/lib/core-app/outlookCopy'
import { FreshnessChip } from '@/components/sports-os/FreshnessChip'
import {
  AssumptionsPanel,
  DriverList,
  DurabilityPanel,
  MilestonePanel,
  MoveList,
  OddsTile,
  SchedulePanel,
  StatusPill,
} from '@/components/core-app/outlook/OutlookParts'
import { OutlookScenarioPanel } from '@/components/core-app/outlook/OutlookScenarioPanel'
import { TopicTip } from '@/components/core-app/TopicTip'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { outlookText, ordinalEs, seasonOutlookSentence } from '@/lib/core-app/outlookSpanish'
import '@/components/core-app/af-season-outlook-league.css'
import '@/components/core-app/af-outlook.css'

/**
 * Screen 38a·5 — Season Outlook, scoped to one league.
 *
 * ── THE LAYOUT IS THE MOBILE BRIEF ────────────────────────────────────────────
 * The forecast leads: your odds (playoffs, bye, title, missing out — each with its range), the next
 * action, and the three factors that move your season most. Everything else sits behind one tab row,
 * so a phone shows the answer first and the working second.
 *
 * ⚠ ALMOST NOTHING HERE IS NEW MATHS ON THE CLIENT. The odds, ranges, milestones, drivers and moves
 * all arrive computed. The one thing this file runs is the what-if panel, which calls the SAME pure
 * simulation the server used (`outlookSim.ts`).
 *
 * The clinch scenario's named help is a conditional probability out of the lose-branch simulation —
 * P(you make it | this rival misses) − P(you make it) — not a read of who sits next to you in the
 * table. Seeding depends on points for as well as record, so the team directly above you is
 * frequently NOT the one whose loss helps you most.
 *
 * ── LANGUAGE ──────────────────────────────────────────────────────────────────
 * A live Spanish sweep (2026-10-05) found this whole screen English. Fixed copy is inline es/en; the
 * loader's sentences go through `outlookText` (drivers, moves, flags, notes) and then the cross-league
 * page's own `seasonOutlookSentence` (what decides it, the attention reasons, the basis), so one
 * sentence is never translated two different ways on two screens.
 */

function useOutlookLanguage() {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const say = (english: string) => {
    const t = outlookText(english, language)
    return t !== english ? t : seasonOutlookSentence(english, language)
  }
  return { es, say }
}

export type SeasonOutlookLeagueProps = {
  league: OutlookLeague
  /** This league's own swing game. Null when the season has nothing left to swing. */
  swing: SwingMatchup | null
  /** Printed verbatim — a simulated number without its basis is a guess. */
  basis: string
  /** The cross-league attention ranking, shown here for the OTHER leagues. */
  priorities?: Array<{ leagueName: string; reason: string; href: string }>
  /** The board's age. Null when it was computed on this request. */
  freshness?: { meta: FreshnessMeta; initialLabel: string; initialWarn: boolean } | null
  /**
   * Every team's lineup for this week, AF beside API. DISPLAY ONLY — the odds above are simulated
   * without AF and nothing here feeds them. Null draws no section.
   */
  lineups?: StandingsLineups | null
}

const TABS = [
  { key: 'path', label: 'Path to playoffs', es: 'Camino a playoffs' },
  { key: 'whatif', label: 'What-if', es: 'Escenarios' },
  { key: 'moves', label: 'Moves & drivers', es: 'Movimientos y factores' },
  { key: 'schedule', label: 'Schedule', es: 'Calendario' },
  { key: 'roster', label: 'Roster risk', es: 'Riesgo de plantilla' },
  { key: 'standings', label: 'Standings', es: 'Clasificación' },
  { key: 'basis', label: 'Assumptions', es: 'Supuestos' },
] as const

type TabKey = (typeof TABS)[number]['key']

const TAB_PARAM = 'so_tab'

function readTab(): TabKey | null {
  if (typeof window === 'undefined') return null
  const v = new URLSearchParams(window.location.search).get(TAB_PARAM)
  return TABS.some((t) => t.key === v) ? (v as TabKey) : null
}

export function SeasonOutlookLeague({ league, swing, basis, priorities = [], freshness = null, lineups = null }: SeasonOutlookLeagueProps) {
  const { es, say } = useOutlookLanguage()
  const you = league.you
  const focus = league.focus
  const [tab, setTab] = useState<TabKey>('path')
  const [nowMs, setNowMs] = useState<number | null>(null)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  /* The tab lives in the URL so a reload or a shared link lands on it. Read after mount, so SSR agrees. */
  useEffect(() => {
    const initial = readTab()
    if (initial) setTab(initial)
    setNowMs(Date.now())
  }, [])

  const choose = (key: TabKey, focusIt = false) => {
    setTab(key)
    try {
      const url = new URL(window.location.href)
      if (key === 'path') url.searchParams.delete(TAB_PARAM)
      else url.searchParams.set(TAB_PARAM, key)
      window.history.replaceState(window.history.state, '', url)
    } catch {
      /* A URL we cannot rewrite only costs the deep link. */
    }
    if (focusIt) tabRefs.current[TABS.findIndex((t) => t.key === key)]?.focus()
  }

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TABS.length - 1
    const next =
      e.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null
    if (next == null) return
    e.preventDefault()
    choose(TABS[next].key, true)
  }

  /* The attention ranking minus the league already on screen. */
  const elsewhere = priorities.filter((p) => p.leagueName !== league.leagueName).slice(0, 4)

  if (!you) {
    return (
      <div className="af-sol af-olk">
        <Header league={league} freshness={freshness} />
        <div className="af-sol-empty">
          <p className="af-sol-empty-t">{es ? 'No sabemos cuál es tu equipo en esta liga.' : 'We cannot tell which team is yours in this league.'}</p>
          <p className="af-sol-empty-b">
            {es
              ? 'Cada número de esta pantalla trata de tu posición en la liga, así que nada puede mostrarse hasta que la plantilla se empareje con tu cuenta. La clasificación de la liga sigue abajo.'
              : "Every number on this screen is about your position in the field, so none of it can be shown until the roster is matched to your account. The league's own standings are still below."}
          </p>
        </div>
        <Standings league={league} lineups={lineups} />
      </div>
    )
  }

  const cutTeam = league.teams.find((t) => t.seed === league.playoffTeams) ?? null
  const gamesFromCut = cutTeam ? you.wins - cutTeam.wins : null
  const topMove = focus?.moves.find((m) => m.playoffDelta > 0) ?? null

  return (
    <div className="af-sol af-olk">
      <Header league={league} freshness={freshness} />

      {/* ── The forecast ─────────────────────────────────────────────── */}
      <section className="af-olk-hero" aria-labelledby="so-forecast">
        <header className="af-olk-hero-head">
          <h2 id="so-forecast" className="af-label">
            {es ? `Tu pronóstico · ${ordinalEs(you.seed)} puesto` : `Your forecast · ${ordinal(you.seed)} seed`}, {you.wins}–{you.losses}
            {you.ties ? `–${you.ties}` : ''}
          </h2>
          {/* Beside the heading, not in it: the section is labelled by it. */}
          <TopicTip topic="outlookPlayoffOdds" />
          <StatusPill status={you.status} />
          <span className="af-olk-g">
            {gamesFromCut == null
              ? ''
              : gamesFromCut > 0
                ? es ? `${gamesFromCut} por encima del corte · ` : `${gamesFromCut} clear of the cut · `
                : gamesFromCut === 0
                  ? es ? 'igualado con el corte · ' : 'level with the cut · '
                  : es ? `${Math.abs(gamesFromCut)} por debajo del corte · ` : `${Math.abs(gamesFromCut)} back of the cut · `}
            {league.weeksRemaining === 0
              ? es ? 'temporada regular terminada' : 'regular season over'
              : es ? `${league.weeksRemaining} por jugar` : `${league.weeksRemaining} to play`}
          </span>
        </header>

        <div className="af-olk-odds-row">
          <OddsTile
            label="Playoffs"
            value={you.playoffPct}
            range={you.range?.playoff ?? null}
            sub={es ? `los ${league.playoffTeams} primeros de ${league.teams.length}` : `top ${league.playoffTeams} of ${league.teams.length}`}
          />
          {league.byeTeams > 0 ? (
            <OddsTile
              label={es ? 'Descanso en primera ronda' : 'First-round bye'}
              value={you.byePct}
              range={you.range?.bye ?? null}
              sub={
                es
                  ? league.byeTeams === 1 ? 'el primer puesto' : `los ${league.byeTeams} primeros puestos`
                  : `top ${league.byeTeams} seed${league.byeTeams === 1 ? '' : 's'}`
              }
              tone="neutral"
            />
          ) : null}
          <OddsTile
            label={es ? 'Título' : 'Title'}
            value={you.titlePct}
            range={you.range?.title ?? null}
            sub={es ? 'ganar el cuadro' : 'win the bracket'}
            tone="neutral"
          />
          <OddsTile
            label={you.status === 'eliminated' ? (es ? 'Eliminado' : 'Eliminated') : es ? 'Quedar fuera de playoffs' : 'Miss the playoffs'}
            value={you.missPct}
            range={you.range ? { lo: 100 - you.range.playoff.hi, hi: 100 - you.range.playoff.lo } : null}
            sub={es ? 'la temporada termina sin plaza' : 'season ends without a berth'}
            tone="invert"
          />
        </div>

        <p className="af-olk-decides">{say(league.whatDecidesIt)}</p>

        <div className="af-olk-hero-grid">
          <div className="af-olk-next">
            <h3 className="af-label">{es ? 'Siguiente acción' : 'Next action'}</h3>
            {topMove ? (
              <>
                <p className="af-olk-next-t">{say(topMove.title)}</p>
                <p className="af-olk-next-d">
                  {say(topMove.detail)}{' '}
                  <b className="af-num">
                    {signedPts(topMove.playoffDelta)} {es ? 'pts de playoffs' : 'playoff pts'}
                  </b>
                </p>
                <Link className="af-btn af-olk-next-cta" href={topMove.href}>
                  {topMove.kind === 'lineup' ? (es ? 'Ajusta tu alineación' : 'Set your lineup') : es ? 'Abrir agentes libres' : 'Open waivers'}
                </Link>
              </>
            ) : swing ? (
              <>
                <p className="af-olk-next-t">
                  {es ? `Gana la semana ${swing.week}` : `Win week ${swing.week}`}
                  {swing.opponentName ? (es ? ` contra ${swing.opponentName}` : ` against ${swing.opponentName}`) : ''}
                </p>
                <p className="af-olk-next-d">
                  {es ? 'Vale ' : 'It is worth '}
                  <b className="af-num">
                    {swing.swing.toFixed(0)} {es ? 'puntos' : 'points'}
                  </b>
                  {es
                    ? ` de probabilidad de playoffs: ${pct(swing.ifWin)}% si ganas, ${pct(swing.ifLose)}% si pierdes.`
                    : ` of playoff odds — ${pct(swing.ifWin)}% with a win, ${pct(swing.ifLose)}% with a loss.`}
                </p>
                <Link className="af-btn af-olk-next-cta" href={`/core/matchup?league=${encodeURIComponent(league.leagueId)}`}>
                  {es ? 'Abrir ese enfrentamiento' : 'Open that matchup'}
                </Link>
              </>
            ) : elsewhere[0] ? (
              <>
                <p className="af-olk-next-t">
                  {es ? `Aquí no hace falta nada; en ${elsewhere[0].leagueName}, sí.` : `Nothing here needs you — ${elsewhere[0].leagueName} does.`}
                </p>
                <p className="af-olk-next-d">{say(elsewhere[0].reason)}</p>
                <Link className="af-btn af-olk-next-cta" href={elsewhere[0].href}>
                  {es ? 'Abrir' : 'Open'} {elsewhere[0].leagueName}
                </Link>
              </>
            ) : (
              <p className="af-olk-next-d">
                {es ? 'Nada en esta liga necesita una decisión ahora mismo.' : 'Nothing in this league needs a decision right now.'}
              </p>
            )}
          </div>

          <div className="af-olk-drivebox">
            <h3 className="af-label">{es ? 'Lo que más mueve tu temporada' : 'What moves your season most'}</h3>
            {focus ? (
              <DriverList drivers={focus.drivers} limit={3} />
            ) : (
              <p className="af-olk-empty">
                {es ? 'Los factores se calculan cuando esta liga se abre por separado.' : 'Drivers are worked out when this league is open on its own.'}
              </p>
            )}
            {focus && focus.drivers.length > 0 ? (
              <p className="af-olk-note">
                {es
                  ? 'Puntos de probabilidad de playoffs, frente a una versión promedio de la liga de cada factor.'
                  : 'Points of playoff probability, against a league-average version of each factor.'}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── The working ──────────────────────────────────────────────── */}
      <div className="af-olk-tabs" role="tablist" aria-label={es ? 'Detalle de la proyección de temporada' : 'Season Outlook detail'}>
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              tabRefs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`so-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls="so-panel"
            tabIndex={tab === t.key ? 0 : -1}
            className="af-olk-tab"
            onClick={() => choose(t.key)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {es ? t.es : t.label}
          </button>
        ))}
      </div>

      <div id="so-panel" role="tabpanel" aria-labelledby={`so-tab-${tab}`} className="af-olk-panel" tabIndex={0}>
        {tab === 'path' ? (
          <>
            <Clinch league={league} swing={swing} />
            {league.milestones ? (
              <MilestonePanel m={league.milestones} playoffTeams={league.playoffTeams} />
            ) : (
              <p className="af-olk-empty">
                {es ? 'Tu equipo tiene muy pocas semanas completas para proyectar un récord.' : 'Your team has too few completed weeks to project a record.'}
              </p>
            )}
          </>
        ) : tab === 'whatif' ? (
          focus ? (
            <OutlookScenarioPanel model={focus.scenario} />
          ) : (
            <p className="af-olk-empty">
              {es ? 'No se pudieron preparar escenarios para esta liga ahora mismo.' : 'What-ifs could not be prepared for this league just now.'}
            </p>
          )
        ) : tab === 'moves' ? (
          <>
            <h3 className="af-label">
              {es ? 'Movimientos recomendados' : 'Recommended moves'} <TopicTip topic="playoffPts" />
            </h3>
            {focus ? (
              <MoveList moves={focus.moves} />
            ) : (
              <p className="af-olk-empty">
                {es ? 'No se pudieron preparar movimientos para esta liga ahora mismo.' : 'Moves could not be prepared for this league just now.'}
              </p>
            )}
            <p className="af-olk-note">
              {es
                ? `Cada movimiento se simula con y sin él sobre la misma temporada${
                    focus ? `, ${focus.branchIterations.toLocaleString('es-ES')} veces cada uno` : ''
                  }. Aquí no se sugieren intercambios: prueba uno en Escenarios.`
                : `Each move is simulated against the same season with and without it${
                    focus ? `, ${focus.branchIterations.toLocaleString('en-US')} times each` : ''
                  }. Trades are not suggested here — try one in What-if.`}
            </p>
            <h3 className="af-label">{es ? 'Todos los factores que medimos' : 'Every factor we measured'}</h3>
            {focus ? <DriverList drivers={focus.drivers} /> : null}
          </>
        ) : tab === 'schedule' ? (
          <SchedulePanel teams={league.teams} />
        ) : tab === 'roster' ? (
          focus?.durability ? (
            <DurabilityPanel d={focus.durability} />
          ) : (
            <p className="af-olk-empty">
              {focus?.scenario.refusal ?? focus?.notes[0]
                ? say((focus?.scenario.refusal ?? focus?.notes[0])!)
                : es ? 'No se pudo leer el riesgo de plantilla de esta liga.' : 'Roster risk could not be read for this league.'}
            </p>
          )
        ) : tab === 'standings' ? (
          <Standings league={league} lineups={lineups} />
        ) : (
          <>
            <p className="af-sol-basis">{say(basis)}</p>
            <AssumptionsPanel
              a={league.assumptions}
              nowMs={nowMs}
              extra={{
                branchIterations: focus?.branchIterations,
                basisWeek: focus?.scenario.basisWeek ?? null,
                notes: focus?.notes,
              }}
            />
          </>
        )}
      </div>

      {elsewhere.length > 0 ? (
        <section className="af-sol-attention">
          <header className="af-sol-attention-head">
            <h2 className="af-label">{es ? 'Dónde poner tu atención' : 'Where to spend your attention'}</h2>
            <span className="af-sol-attention-note">{es ? 'tus otras ligas, primero la más urgente' : 'your other leagues, most urgent first'}</span>
          </header>
          <ul className="af-sol-attention-rows">
            {elsewhere.map((p) => (
              <li key={p.href}>
                <Link className="af-sol-attention-row" href={p.href}>
                  <span className="af-sol-attention-league">{p.leagueName}</span>
                  <span className="af-sol-attention-reason">{say(p.reason)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function Header({
  league,
  freshness,
}: {
  league: OutlookLeague
  freshness: SeasonOutlookLeagueProps['freshness']
}) {
  const { es } = useOutlookLanguage()
  return (
    <header className="af-sol-head">
      <p className="af-label af-sol-eyebrow">{league.leagueName}</p>
      <div className="af-olk-titlerow">
        <h1 className="af-display af-sol-title">{es ? 'Proyección de temporada' : 'Season Outlook'}</h1>
        {freshness ? (
          <FreshnessChip meta={freshness.meta} initialLabel={freshness.initialLabel} initialWarn={freshness.initialWarn} />
        ) : null}
      </div>
      <p className="af-sol-sub">
        {es
          ? 'Probabilidades de playoffs, descanso y título, simuladas con el calendario, la puntuación y las plazas de playoffs de esta liga, no con un modelo genérico.'
          : "Playoff, bye and title odds, simulated against this league's own schedule, scoring and playoff field — not a generic model."}
      </p>
    </header>
  )
}

function Clinch({ league, swing }: { league: OutlookLeague; swing: SwingMatchup | null }) {
  const { es } = useOutlookLanguage()
  if (!swing) {
    return (
      <section className="af-sol-clinch" data-empty="true">
        <h3 className="af-label">{es ? 'Cómo clasificas' : 'How you clinch'}</h3>
        <p className="af-sol-clinch-why">
          {league.weeksRemaining === 0
            ? es
              ? 'La temporada regular terminó en esta liga: no queda nada por asegurar.'
              : 'The regular season is over in this league — there is nothing left to clinch.'
            : es
              ? 'No encontramos tu próximo partido sin jugar en esta liga, así que no hay un único resultado del que partir.'
              : 'We could not find your next unplayed game in this league, so there is no single result to branch on.'}
        </p>
      </section>
    )
  }
  return (
    <section className="af-sol-clinch">
      <header className="af-sol-clinch-head">
        <h3 className="af-label">
          {es ? 'Cómo clasificas' : 'How you clinch'} <TopicTip topic="swingGame" />
        </h3>
        <span className="af-sol-clinch-note">
          {es ? 'Semana' : 'Week'} {swing.week}
          {swing.opponentName ? ` · vs ${swing.opponentName}` : ''}
        </span>
      </header>

      <div className="af-sol-branches">
        <div className="af-sol-branch" data-tone="good">
          <span className="af-label">{es ? 'Si ganas' : 'If you win'}</span>
          <span className="af-sol-branch-v af-num">{pct(swing.ifWin)}%</span>
          <p className="af-sol-branch-b">
            {swing.clinchOnWin
              ? es ? 'Estás dentro. Gana esto y lo demás es cuestión de posición.' : 'You are in. Win this and the rest is about seeding.'
              : es
                ? 'Aún no está decidido, pero es el movimiento más grande que tienes a tu alcance.'
                : 'Still not decided, but this is the single biggest move available to you.'}
          </p>
        </div>

        <div className="af-sol-branch" data-tone="bad">
          <span className="af-label">
            {es ? 'Si pierdes' : 'If you lose'} <TopicTip topic="clinchHelp" />
          </span>
          <span className="af-sol-branch-v af-num">{pct(swing.ifLose)}%</span>
          <p className="af-sol-branch-b">
            {/* An empty help list is a real finding — no one other result moves your odds enough. */}
            {swing.helpIfLose.length === 0
              ? es
                ? 'Ningún otro resultado por sí solo te rescata: necesitarías que varios partidos salieran a tu favor, no uno.'
                : 'No single other result rescues this — you would need the run of play to go your way across several games, not one.'
              : swing.helpIfLose.length === 1
                ? es
                  ? `Necesitarías que ${swing.helpIfLose[0]} también se quedara fuera. Esa ausencia sube tus probabilidades más que cualquier otro resultado.`
                  : `You would need ${swing.helpIfLose[0]} to miss out too. That one absence lifts your odds more than any other result on the board.`
                : es
                  ? `Necesitarías que ${swing.helpIfLose[0]} o ${swing.helpIfLose[1]} también se quedaran fuera: esas dos ausencias mueven tu número más que cualquier otra cosa que no controlas.`
                  : `You would need ${swing.helpIfLose[0]} or ${swing.helpIfLose[1]} to miss out too — those two absences move your number more than anything else you do not control.`}
          </p>
        </div>

        <div className="af-sol-branch" data-tone="accent">
          <span className="af-label">{es ? 'Diferencia' : 'Swing'}</span>
          <span className="af-sol-branch-v af-num">{swing.swing.toFixed(0)} pts</span>
          <p className="af-sol-branch-b">
            {es ? 'de probabilidad de playoffs dependen de este resultado.' : 'of playoff probability rest on this one result.'}
          </p>
        </div>
      </div>

      <Link href={`/core/matchup?league=${encodeURIComponent(league.leagueId)}`} className="af-btn af-sol-clinch-cta">
        {es ? 'Abrir ese enfrentamiento' : 'Open that matchup'}
      </Link>
    </section>
  )
}

function Standings({ league, lineups }: { league: OutlookLeague; lineups: StandingsLineups | null }) {
  const { es, say } = useOutlookLanguage()
  const showBye = league.byeTeams > 0
  return (
    <div className="af-sol-tablewrap">
      <table className="af-sol-table">
        <caption className="af-sol-caption">
          {es
            ? `Todos los equipos de ${league.leagueName}, ordenados por su posición actual. La línea marca el corte de playoffs. Pasa el cursor por un porcentaje de playoffs para ver su rango.`
            : `Every team in ${league.leagueName}, ordered by current seed. The line marks the playoff cut. Hover a playoff figure for its range.`}
        </caption>
        <thead>
          <tr>
            <th scope="col">{es ? 'Equipo' : 'Team'}</th>
            <th scope="col" className="af-sol-n">
              {es ? 'Récord' : 'Record'}
            </th>
            <th scope="col" className="af-sol-n">
              {es ? 'Puntos a favor' : 'Points for'}
            </th>
            <th scope="col" className="af-sol-n">
              Playoffs <TopicTip topic="outlookPlayoffOdds" />
            </th>
            {showBye ? (
              <th scope="col" className="af-sol-n">
                {es ? 'Descanso' : 'Bye'}
              </th>
            ) : null}
            <th scope="col" className="af-sol-n">
              {es ? 'Título' : 'Title'}
            </th>
            <th scope="col">
              {es ? 'Qué lo decide' : 'What decides it'} <TopicTip topic="whatDecidesIt" />
            </th>
          </tr>
        </thead>
        <tbody>
          {league.teams.map((t) => (
            <tr key={t.rosterId} data-you={t.isYou} data-cut={t.seed === league.playoffTeams}>
              <th scope="row">
                <span className="af-sol-seed af-num">{t.seed}</span>
                <span className="af-sol-name">{t.name ?? (es ? 'Equipo sin nombre' : 'Unnamed team')}</span>
                {t.isYou ? <span className="af-sol-you af-label">{es ? 'Tú' : 'You'}</span> : null}
              </th>
              <td className="af-sol-n af-num">
                {t.wins}—{t.losses}{t.ties ? `—${t.ties}` : ''}
              </td>
              <td className="af-sol-n af-num">{t.pointsFor.toFixed(1)}</td>
              {/* An unmodelled team showing "0%" would read as eliminated rather than as unknown. */}
              <td className="af-sol-n">
                {t.modelled ? (
                  <span
                    className="af-sol-pct"
                    data-band={band(t.playoffPct)}
                    title={t.range ? `${es ? 'Rango' : 'Range'} ${rangeLabel(t.range.playoff)}` : undefined}
                  >
                    {pct(t.playoffPct)}%
                  </span>
                ) : (
                  <span className="af-sol-pct" data-band="none">
                    —
                  </span>
                )}
              </td>
              {showBye ? <td className="af-sol-n af-num">{t.modelled ? `${pct(t.byePct)}%` : '—'}</td> : null}
              <td className="af-sol-n">
                {t.modelled ? (
                  <span className="af-sol-pct" data-band={band(t.titlePct)}>
                    {pct(t.titlePct)}%
                  </span>
                ) : (
                  <span className="af-sol-pct" data-band="none">
                    —
                  </span>
                )}
              </td>
              <td className="af-sol-decides">{say(describeTeamOutlook(t, league.weeksRemaining, league.playoffTeams))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {lineups ? (
        <WeekLineupsTable lineups={lineups} caveat="the playoff and title odds above are simulated without AF." />
      ) : null}
    </div>
  )
}

export default SeasonOutlookLeague
