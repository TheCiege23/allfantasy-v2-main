import Link from 'next/link'
import type { Milestones, ScheduleStrength } from '@/lib/core-app/outlookSim'
import type { OddsRange, OutlookAssumptions, OutlookTeam } from '@/lib/core-app/seasonOutlook'
import type { OutlookDriver, OutlookDurability, OutlookMove } from '@/lib/core-app/seasonOutlookFocus'
import { ageLabel, band, ordinal, pct, rangeLabel, signedPts } from '@/lib/core-app/outlookCopy'
import { outlookText, ordinalEs } from '@/lib/core-app/outlookSpanish'
import { ageText } from '@/lib/core-app/shellCopy'
import { TopicTip } from '@/components/core-app/TopicTip'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * Season Outlook — the pieces both screens are built from.
 *
 * ⚠ TYPE-ONLY IMPORTS FROM THE SERVER MODULES. `seasonOutlook.ts` and `seasonOutlookFocus.ts` are
 * `server-only`; `import type` is erased at build, which is the only reason these can name their
 * shapes from a client component.
 *
 * Charts here are deliberately small and single-purpose (the dataviz method: a stat tile when the
 * story is one number). Colour never carries meaning alone — every bar has its number in text, and
 * polarity is also a sign character.
 *
 * Every importer is a client component, so each part reads the reader's language itself (2026-10-05);
 * the server-built sentences it is handed go through `outlookText`.
 */

function useEs(): boolean {
  return useOptionalLanguage().language === 'es'
}

// ── Odds ───────────────────────────────────────────────────────────────

export function OddsTile({
  label,
  value,
  range,
  sub,
  tone,
}: {
  label: string
  value: number
  range: OddsRange | null
  sub?: string
  /**
   * `status` colours the number by whether it is good news (playoffs); `invert` does the same for a
   * number where high is bad (missing out). `neutral` is for odds that are naturally small — a 3%
   * title chance is ordinary, and painting it red would read as a warning it is not.
   */
  tone?: 'status' | 'invert' | 'neutral'
}) {
  const es = useEs()
  const b = tone === 'neutral' ? 'none' : tone === 'invert' ? band(100 - value) : band(value)
  return (
    <div className="af-olk-odds" data-band={b}>
      <span className="af-olk-odds-l af-label">{label}</span>
      <span className="af-olk-odds-v af-num">{pct(value)}%</span>
      {range ? (
        <span className="af-olk-range" role="img" aria-label={`${es ? 'Rango probable' : 'Likely range'} ${rangeLabel(range)}`}>
          <span className="af-olk-range-track" aria-hidden>
            <span
              className="af-olk-range-band"
              style={{ left: `${clamp(range.lo)}%`, width: `${Math.max(1.5, clamp(range.hi) - clamp(range.lo))}%` }}
            />
            <span className="af-olk-range-dot" style={{ left: `${clamp(value)}%` }} />
          </span>
          <span className="af-olk-range-t af-num">{es ? 'rango' : 'range'} {rangeLabel(range)}</span>
        </span>
      ) : null}
      {sub ? <span className="af-olk-odds-s">{sub}</span> : null}
    </div>
  )
}

const clamp = (n: number) => Math.max(0, Math.min(100, n))

export function StatusPill({ status }: { status: OutlookTeam['status'] }) {
  const es = useEs()
  if (!status) return null
  return (
    <span className="af-olk-pill" data-status={status}>
      {status === 'clinched' ? (es ? '✓ Clasificado' : '✓ Clinched') : es ? '✕ Eliminado' : '✕ Eliminated'}
    </span>
  )
}

// ── Drivers ────────────────────────────────────────────────────────────

/**
 * Signed impact, drawn from a centre line. Spread drivers (a single game that can go either way) are
 * drawn both sides of the centre, because their sign is not known yet.
 */
export function DriverList({ drivers, limit }: { drivers: OutlookDriver[]; limit?: number }) {
  const es = useEs()
  const say = (english: string) => outlookText(english, es ? 'es' : 'en')
  const shown = limit ? drivers.slice(0, limit) : drivers
  if (shown.length === 0) {
    return (
      <p className="af-olk-empty">
        {es ? 'Ningún factor mueve tus probabilidades de playoffs en un punto o más.' : 'No single factor moves your playoff odds by a point or more.'}
      </p>
    )
  }
  const scale = Math.max(10, ...shown.map((d) => Math.abs(d.impact)))
  return (
    <ol className="af-olk-drivers">
      {shown.map((d) => {
        const w = (Math.abs(d.impact) / scale) * 50
        const dir = d.spread ? 'both' : d.impact >= 0 ? 'up' : 'down'
        return (
          <li key={d.key} className="af-olk-driver" data-dir={dir}>
            <div className="af-olk-driver-top">
              <span className="af-olk-driver-l">{say(d.label)}</span>
              <span className="af-olk-driver-v af-num">
                {d.spread ? `±${Math.abs(d.impact).toFixed(0)}` : signedPts(d.impact, 0)} pts
              </span>
            </div>
            <span className="af-olk-diverge" aria-hidden>
              <span className="af-olk-diverge-mid" />
              {dir === 'both' ? (
                <>
                  <span className="af-olk-diverge-bar" data-side="left" style={{ width: `${w}%` }} />
                  <span className="af-olk-diverge-bar" data-side="right" style={{ width: `${w}%` }} />
                </>
              ) : (
                <span className="af-olk-diverge-bar" data-side={dir === 'up' ? 'right' : 'left'} style={{ width: `${w}%` }} />
              )}
            </span>
            <p className="af-olk-driver-d">{say(d.detail)}</p>
          </li>
        )
      })}
    </ol>
  )
}

// ── Moves ──────────────────────────────────────────────────────────────

export function MoveList({ moves, leagueHref }: { moves: OutlookMove[]; leagueHref?: string }) {
  const es = useEs()
  const say = (english: string) => outlookText(english, es ? 'es' : 'en')
  if (moves.length === 0) {
    return (
      <p className="af-olk-empty">
        {es
          ? 'Ningún cambio de alineación ni de agentes libres vale un punto por semana o más ahora mismo.'
          : 'No lineup or waiver move is worth a point a week or more right now.'}
        {leagueHref ? (
          <>
            {' '}
            <Link href={leagueHref}>{es ? 'Abrir la liga' : 'Open the league'}</Link>
          </>
        ) : null}
      </p>
    )
  }
  return (
    <ul className="af-olk-moves">
      {moves.map((m) => (
        <li key={m.key} className="af-olk-move">
          <div className="af-olk-move-main">
            <span className="af-olk-move-kind af-label">
              {m.kind === 'lineup'
                ? es ? `Alineación · semana ${m.week}` : `Lineup · week ${m.week}`
                : es ? 'Agentes libres · resto de la temporada' : 'Waivers · rest of season'}
            </span>
            <span className="af-olk-move-t">{say(m.title)}</span>
            <span className="af-olk-move-d">{say(m.detail)}</span>
          </div>
          <div className="af-olk-move-fx">
            <span className="af-olk-move-delta af-num" data-dir={m.playoffDelta >= 0.05 ? 'up' : m.playoffDelta <= -0.05 ? 'down' : 'flat'}>
              {signedPts(m.playoffDelta)}
            </span>
            <span className="af-olk-move-unit">{es ? 'pts de playoffs' : 'playoff pts'}</span>
            <span className="af-olk-move-sub af-num">
              {es ? 'título' : 'title'} {signedPts(m.titleDelta)} · +{m.pointsPerWeek} {es ? 'pts/sem' : 'pts/wk'}
            </span>
            <Link className="af-olk-move-cta" href={m.href}>
              {m.kind === 'lineup' ? (es ? 'Ajustar alineación' : 'Set lineup') : es ? 'Abrir agentes libres' : 'Open waivers'}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  )
}

// ── Milestones ─────────────────────────────────────────────────────────

export function MilestonePanel({ m, playoffTeams }: { m: Milestones; playoffTeams: number }) {
  const es = useEs()
  const seed = es ? ordinalEs(playoffTeams) : ordinal(playoffTeams)
  const num = (n: number) => Math.round(n).toLocaleString(es ? 'es-ES' : 'en-US')
  const losses = (w: number) => m.totalGames - w
  const record = (w: number | null) => (w == null ? '—' : `${w}–${losses(w)}`)
  const rows = m.oddsByWins
    .map((v, w) => ({ w, v }))
    .filter((r) => r.w >= m.currentWins && r.w <= m.maxWins)
  return (
    <div className="af-olk-miles">
      <div className="af-olk-miles-tiles">
        <div className="af-olk-mini">
          <span className="af-olk-mini-v af-num">{record(m.winsForSafe)}</span>
          <span className="af-olk-mini-l">{es ? 'te clasifica 9 de cada 10 veces' : 'gets you in 9 times in 10'}</span>
        </div>
        <div className="af-olk-mini">
          <span className="af-olk-mini-v af-num">{record(m.winsForLikely)}</span>
          <span className="af-olk-mini-l">{es ? 'te clasifica más de la mitad de las veces' : 'gets you in more often than not'}</span>
        </div>
        <div className="af-olk-mini">
          <span className="af-olk-mini-v af-num">
            {m.cutWinsMedian == null ? '—' : m.cutWinsLow === m.cutWinsHigh ? m.cutWinsMedian : `${m.cutWinsLow}–${m.cutWinsHigh}`}
          </span>
          <span className="af-olk-mini-l">{es ? `victorias para el ${seed} puesto, normalmente` : `wins for the ${seed} seed, usually`}</span>
        </div>
        <div className="af-olk-mini">
          <span className="af-olk-mini-v af-num">
            {m.cutPointsMedian == null ? '—' : num(m.cutPointsMedian)}
          </span>
          <span className="af-olk-mini-l">
            {es ? `puntos para el ${seed} puesto` : `points for the ${seed} seed`}
            {m.cutPointsLow != null && m.cutPointsHigh != null ? ` (${num(m.cutPointsLow)}–${num(m.cutPointsHigh)})` : ''}
          </span>
        </div>
      </div>
      <p className="af-olk-note">
        {es
          ? `Vas camino de ${m.projectedWins == null ? '—' : record(m.projectedWins)}${
              m.projectedPoints != null ? ` y unos ${num(m.projectedPoints)} puntos` : ''
            }: el punto medio de tus finales simulados.`
          : `On pace for ${m.projectedWins == null ? '—' : record(m.projectedWins)}${
              m.projectedPoints != null ? ` and about ${num(m.projectedPoints)} points` : ''
            } — the middle of your simulated finishes.`}
      </p>
      <figure className="af-olk-wins">
        <figcaption className="af-label">
          {es ? 'Probabilidad de playoffs según el récord final' : 'Playoff odds by final record'} <TopicTip topic="winsMilestones" />
        </figcaption>
        <div className="af-olk-wins-bars" aria-hidden>
          {rows.map(({ w, v }) => (
            <span
              key={w}
              className="af-olk-wins-col"
              data-v={v == null ? `${record(w)}: ${es ? 'pocas simulaciones' : 'too few runs'}` : `${record(w)}: ${pct(v)}%`}
            >
              <span className="af-olk-wins-bar" data-known={v != null} style={{ height: `${v == null ? 3 : Math.max(3, v)}%` }} />
              <span className="af-olk-wins-x af-num">{w}</span>
            </span>
          ))}
        </div>
        <table className="af-olk-sr">
          <caption>
            {es ? 'Probabilidad de playoffs según el récord final de la temporada regular' : 'Playoff odds by final regular-season record'}
          </caption>
          <thead>
            <tr>
              <th scope="col">{es ? 'Récord' : 'Record'}</th>
              <th scope="col">{es ? 'Probabilidad de playoffs' : 'Playoff odds'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ w, v }) => (
              <tr key={w}>
                <th scope="row">{record(w)}</th>
                <td>{v == null ? (es ? 'muy pocas simulaciones para saberlo' : 'too few runs to say') : `${pct(v)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="af-olk-note">
          {es
            ? 'Las barras muestran con qué frecuencia una temporada que termina con esas victorias llega a playoffs. Las barras vacías terminaron ahí demasiado pocas veces para medirlo.'
            : 'Bars show how often a season that ends on that many wins makes the field. Blank bars ended there too rarely to measure.'}
        </p>
      </figure>
    </div>
  )
}

// ── Schedule ───────────────────────────────────────────────────────────

export function SchedulePanel({ teams }: { teams: Array<OutlookTeam & { schedule: ScheduleStrength | null }> }) {
  const es = useEs()
  const rows = teams.filter((t) => t.schedule)
  if (rows.length === 0) {
    return <p className="af-olk-empty">{es ? 'No hay calendario registrado para esta liga.' : 'No schedule on file for this league.'}</p>
  }
  const league = rows[0].schedule!.leagueMu
  const fmt = (v: number | null) => (v == null ? '—' : v.toFixed(1))
  const vs = (v: number | null) => (v == null || league == null ? null : v - league)
  return (
    <div className="af-olk-tablewrap">
      <table className="af-olk-table">
        <caption className="af-olk-caption">
          {es
            ? `Promedio semanal ajustado de los rivales, ya jugados y por jugar, frente al promedio de la liga${league != null ? ` de ${league.toFixed(1)}` : ''}. El puesto 1 es el más difícil.`
            : `Opponents' fitted weekly average, already played and still to come, against the league average${league != null ? ` of ${league.toFixed(1)}` : ''}. Rank 1 is the hardest.`}
        </caption>
        <thead>
          <tr>
            <th scope="col">{es ? 'Equipo' : 'Team'}</th>
            <th scope="col" className="af-olk-n">{es ? 'Jugados' : 'Played'}</th>
            <th scope="col" className="af-olk-n">{es ? 'Puesto' : 'Rank'}</th>
            <th scope="col" className="af-olk-n">{es ? 'Restantes' : 'Remaining'}</th>
            <th scope="col" className="af-olk-n">{es ? 'Puesto' : 'Rank'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const s = t.schedule!
            const past = vs(s.pastOpponentMu)
            const rest = vs(s.remainingOpponentMu)
            return (
              <tr key={t.rosterId} data-you={t.isYou}>
                <th scope="row">{t.name ?? (es ? 'Equipo sin nombre' : 'Unnamed team')}</th>
                <td className="af-olk-n af-num">
                  {fmt(s.pastOpponentMu)}
                  {past != null ? <span className="af-olk-vs" data-dir={past > 0 ? 'hard' : 'easy'}> {signedPts(past)}</span> : null}
                  <span className="af-olk-g"> · {s.pastGames} {es ? 'p' : 'g'}</span>
                </td>
                <td className="af-olk-n af-num">{s.pastRank ?? '—'}</td>
                <td className="af-olk-n af-num">
                  {fmt(s.remainingOpponentMu)}
                  {rest != null ? <span className="af-olk-vs" data-dir={rest > 0 ? 'hard' : 'easy'}> {signedPts(rest)}</span> : null}
                  <span className="af-olk-g"> · {s.remainingGames} {es ? 'p' : 'g'}</span>
                </td>
                <td className="af-olk-n af-num">{s.remainingRank ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Durability ─────────────────────────────────────────────────────────

export function DurabilityPanel({ d }: { d: OutlookDurability }) {
  const es = useEs()
  const say = (english: string) => outlookText(english, es ? 'es' : 'en')
  const share = (n: number) => `${Math.round(n * 100)}%`
  return (
    <div className="af-olk-dur">
      {d.flags.length > 0 ? (
        <ul className="af-olk-flags">
          {d.flags.map((f) => (
            <li key={f}>
              <span aria-hidden>⚠</span> {say(f)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="af-olk-note">{es ? 'Nada en esta plantilla destaca como frágil.' : 'Nothing on this roster stands out as fragile.'}</p>
      )}

      <div className="af-olk-dur-grid">
        <section className="af-olk-card">
          <h3 className="af-label">{es ? 'Edad' : 'Age'}</h3>
          <p className="af-olk-card-v af-num">{d.age.averageAge ?? '—'}</p>
          <p className="af-olk-note">
            {es ? `edad media de ${d.age.knownAges} de ${d.starters} titulares` : `average age of ${d.age.knownAges} of ${d.starters} starters`}
          </p>
          {d.age.older.length > 0 ? (
            <ul className="af-olk-mini-list">
              {d.age.older.map((p) => (
                <li key={p.name}>
                  {p.name} <span className="af-olk-g">{p.position} · {p.age}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="af-olk-card">
          <h3 className="af-label">{es ? 'Profundidad' : 'Depth'}</h3>
          {d.depth == null ? (
            <p className="af-olk-note">
              {es ? 'Esta liga no guarda puestos de alineación, así que no se puede juzgar la profundidad.' : 'This league stores no lineup slots, so depth cannot be judged.'}
            </p>
          ) : d.depth.length === 0 ? (
            <p className="af-olk-note">{es ? 'Cada puesto específico tiene un suplente sano.' : 'Every dedicated slot has a healthy backup.'}</p>
          ) : (
            <ul className="af-olk-mini-list">
              {d.depth.map((f) => (
                <li key={f.position}>
                  <b>{f.position}</b> —{' '}
                  {es
                    ? `${f.healthy} ${f.healthy === 1 ? 'sano' : 'sanos'} para ${f.starters} ${f.starters === 1 ? 'puesto' : 'puestos'}`
                    : `${f.healthy} healthy for ${f.starters} slot${f.starters === 1 ? '' : 's'}`}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="af-olk-card">
          <h3 className="af-label">{es ? 'Lesiones' : 'Injuries'}</h3>
          {d.injuries.length === 0 ? (
            <p className="af-olk-note">
              {d.injuryFeedNote
                ? say(d.injuryFeedNote)
                : es ? 'Ningún jugador de esta plantilla figura como baja o en riesgo.' : 'No player on this roster is listed as out or at risk.'}
            </p>
          ) : (
            <>
              <ul className="af-olk-mini-list">
                {d.injuries.map((i) => (
                  <li key={i.name}>
                    {i.name} <span className="af-olk-pill" data-status={i.kind === 'out' ? 'eliminated' : 'risk'}>{i.status}</span>
                    {i.starting ? <span className="af-olk-g"> · {es ? 'en tu alineación' : 'in your lineup'}</span> : null}
                  </li>
                ))}
              </ul>
              {d.injuryFeedNote ? <p className="af-olk-note">{say(d.injuryFeedNote)}</p> : null}
            </>
          )}
        </section>

        <section className="af-olk-card">
          <h3 className="af-label">{es ? 'Descansos por venir' : 'Byes still to come'}</h3>
          {d.byes.length === 0 ? (
            <p className="af-olk-note">
              {es
                ? 'Ningún titular descansa en lo que queda de temporada regular, o el calendario de la NFL no está registrado.'
                : 'No starter has a bye in the remaining regular season, or the NFL schedule is not on file.'}
            </p>
          ) : (
            <ul className="af-olk-mini-list">
              {d.byes.map((b) => (
                <li key={b.week}>
                  <b>{es ? 'Sem' : 'Wk'} {b.week}</b> {b.players.join(', ')}
                  {b.pointsLost != null ? <span className="af-olk-g"> · −{b.pointsLost} pts</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="af-olk-card">
          <h3 className="af-label">{es ? 'Concentración' : 'Concentration'}</h3>
          <ul className="af-olk-mini-list">
            <li>
              {es ? 'Posición principal:' : 'Top position:'}{' '}
              {d.concentration.topPosition ? (
                <b>
                  {d.concentration.topPosition.position} {share(d.concentration.topPosition.share)}
                </b>
              ) : (
                '—'
              )}
            </li>
            <li>
              {es ? 'Jugador principal:' : 'Top player:'}{' '}
              {d.concentration.topPlayer ? (
                <b>
                  {d.concentration.topPlayer.name} {share(d.concentration.topPlayer.share)}
                </b>
              ) : (
                '—'
              )}
            </li>
            <li>
              {es ? 'Mismo equipo de la NFL:' : 'Same NFL team:'}{' '}
              {d.concentration.stack ? (
                <b>
                  {d.concentration.stack.players.length} {es ? 'de' : 'from'} {d.concentration.stack.team}
                </b>
              ) : es ? (
                'ningún grupo de dos o más'
              ) : (
                'no stack of two or more'
              )}
            </li>
          </ul>
          <p className="af-olk-note">
            {es ? 'Porcentajes de los puntos proyectados de tu mejor alineación.' : "Shares of your best lineup's projected points."}
          </p>
        </section>
      </div>
      {d.basisWeek ? (
        <p className="af-olk-note">
          {es
            ? `Los puntos son proyecciones de la semana ${d.basisWeek.week}, puntuadas con las reglas de esta liga.`
            : `Points are week ${d.basisWeek.week} projections, scored under this league's rules.`}
        </p>
      ) : null}
    </div>
  )
}

// ── Assumptions ────────────────────────────────────────────────────────

const SOURCE: Record<string, string> = {
  league: 'from the league’s settings',
  standard: 'standard bracket, not stated by the league',
  default: 'assumed — the league does not say',
}

const SOURCE_ES: Record<string, string> = {
  league: 'según la configuración de la liga',
  standard: 'cuadro estándar, la liga no lo indica',
  default: 'supuesto: la liga no lo indica',
}

export function AssumptionsPanel({
  a,
  nowMs,
  extra,
}: {
  a: OutlookAssumptions
  nowMs: number | null
  extra?: { branchIterations?: number; basisWeek?: { season: string; week: number } | null; notes?: string[] }
}) {
  const es = useEs()
  const say = (english: string) => outlookText(english, es ? 'es' : 'en')
  const n = (v: number) => v.toLocaleString(es ? 'es-ES' : 'en-US')
  const source = (key: string) => (es ? SOURCE_ES : SOURCE)[key]
  return (
    <div className="af-olk-assume">
      <dl className="af-olk-dl">
        <div>
          <dt>{es ? 'Simulaciones' : 'Simulations'}</dt>
          <dd className="af-num">
            {n(a.iterations)} {es ? 'temporadas' : 'seasons'}
            {extra?.branchIterations ? `; ${n(extra.branchIterations)} ${es ? 'por escenario' : 'per what-if'}` : ''}
          </dd>
        </div>
        <div>
          <dt>{es ? 'Rango' : 'Range'}</dt>
          <dd className="af-num">
            {es
              ? `${a.rangeBatches} reajustes × ${n(a.rangeRunsPerBatch)} temporadas, percentil 10–90`
              : `${a.rangeBatches} re-fits × ${n(a.rangeRunsPerBatch)} seasons, 10th–90th percentile`}
          </dd>
        </div>
        <div>
          <dt>{es ? 'Modelo de puntuación' : 'Scoring model'}</dt>
          <dd>
            {es
              ? `La puntuación semanal de cada equipo sale de su propio promedio y dispersión, ajustados con ${
                  a.weeksFitted
                    ? `${a.weeksFitted.min}–${a.weeksFitted.max} semanas completas (mediana ${a.weeksFitted.median})`
                    : 'ninguna semana completa'
                } de ${a.seasonsFitted.length ? a.seasonsFitted.join(', ') : 'ninguna temporada'}.`
              : `Each team's weekly score is drawn from its own average and spread, fitted from ${
                  a.weeksFitted
                    ? `${a.weeksFitted.min}–${a.weeksFitted.max} completed weeks (median ${a.weeksFitted.median})`
                    : 'no completed weeks'
                } across ${a.seasonsFitted.length ? a.seasonsFitted.join(', ') : 'no seasons'}.`}
          </dd>
        </div>
        <div>
          <dt>{es ? 'Equipos modelados' : 'Teams modelled'}</dt>
          <dd className="af-num">
            {a.modelledTeams} {es ? 'de' : 'of'} {a.teams}
          </dd>
        </div>
        <div>
          <dt>{es ? 'Calendario' : 'Schedule'}</dt>
          <dd className="af-num">
            {es ? `${a.remainingGames} partidos restantes` : `${a.remainingGames} games left`}
            {a.regularSeasonEndWeek != null
              ? es
                ? `, la temporada regular termina en la semana ${a.regularSeasonEndWeek}`
                : `, regular season ends week ${a.regularSeasonEndWeek}`
              : ''}
          </dd>
        </div>
        <div>
          <dt>{es ? 'Plazas de playoffs' : 'Playoff field'}</dt>
          <dd>
            {a.playoffTeams.value} {es ? 'equipos' : 'teams'}, {source(a.playoffTeams.source)}
          </dd>
        </div>
        <div>
          <dt>{es ? 'Descansos de primera ronda' : 'First-round byes'}</dt>
          <dd>
            {a.byes.value}, {source(a.byes.source)}
          </dd>
        </div>
        <div>
          <dt>{es ? 'Posiciones' : 'Seeding'}</dt>
          <dd>{say(a.tiebreak)}</dd>
        </div>
        {extra?.basisWeek ? (
          <div>
            <dt>{es ? 'Puntos de jugadores' : 'Player points'}</dt>
            <dd>
              {es
                ? `Proyecciones de la semana ${extra.basisWeek.week} con la puntuación de esta liga, usadas para cada semana restante en los escenarios.`
                : `Week ${extra.basisWeek.week} projections under this league's scoring, used for every remaining week in the what-ifs.`}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{es ? 'Última ejecución' : 'Last run'}</dt>
          <dd>
            <time dateTime={a.computedAt}>
              {nowMs == null
                ? new Date(a.computedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
                : es
                  ? ageLabel(a.computedAt, nowMs) === 'unknown'
                    ? 'desconocida'
                    : ageText(ageLabel(a.computedAt, nowMs), 'es')
                  : ageLabel(a.computedAt, nowMs)}
            </time>
            {a.reused ? (es ? ': reutilizada, porque nada de lo que lee ha cambiado desde entonces' : ' — reused, because nothing it reads has changed since') : ''}
          </dd>
        </div>
      </dl>
      {a.missing.length + (extra?.notes?.length ?? 0) > 0 ? (
        <>
          <h3 className="af-label">{es ? 'No modelado o faltante' : 'Not modelled, or missing'}</h3>
          <ul className="af-olk-mini-list">
            {[...a.missing, ...(extra?.notes ?? [])].map((m) => (
              <li key={m}>{say(m)}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}
