'use client'

import Link from 'next/link'
import type { SeasonOutlook as SeasonOutlookData } from '@/lib/core-app/seasonOutlook'
import type { FreshnessMeta } from '@/lib/sports-os/freshness'
import { kickoffDayLabel } from '@/lib/core-app/kickoffLabel'
import { kickoffText } from '@/lib/core-app/kickoffText'
import { band, ordinal, pct, rangeLabel } from '@/lib/core-app/outlookCopy'
import { FreshnessChip } from '@/components/sports-os/FreshnessChip'
import { StatusPill } from '@/components/core-app/outlook/OutlookParts'
import { TopicTip } from '@/components/core-app/TopicTip'
import '@/components/core-app/af-season-outlook.css'
import '@/components/core-app/af-outlook.css'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'

/**
 * 26b — Season Outlook. Playoff, bye and championship odds across every active league.
 *
 * ⚠ THE BASIS IS PRINTED, ALWAYS. `data.basis` is a required field on the loader
 * and it is rendered under the forecast, not tucked in a tooltip. A simulated
 * probability that does not cite what produced it is indistinguishable from a guess.
 *
 * ⚠ "WHAT DECIDES IT" IS A CONDITION, NEVER A STATUS. The loader guarantees this
 * per league; this file only renders the string.
 *
 * ── THE FORECAST LEADS ───────────────────────────────────────────────────────
 * Odds across the portfolio, the one next action, and the three games that swing your
 * season most — then the table. On a phone the table rows become cards (container query
 * on `.af-so`), so nothing needs a sideways scroll to read.
 *
 * ⚠ THE PAGE HANDS THIS A SLIMMED BOARD. Every league's per-team rows stay on the server
 * (`slimOutlookForBoard`); this screen reads only `you`, the league facts and its milestones.
 */

export type SeasonOutlookProps = {
  data: SeasonOutlookData
  freshness?: { meta: FreshnessMeta; initialLabel: string; initialWarn: boolean } | null
}

function Tile({ value, label, tone }: { value: string; label: string; tone?: 'good' | 'warn' | 'accent' }) {
  return (
    <div className="af-so-tile" data-tone={tone ?? 'neutral'}>
      <span className="af-so-tile-v af-num">{value}</span>
      <span className="af-so-tile-l">{label}</span>
    </div>
  )
}

/** Loader explanations carry live counts, so exact dictionary entries cannot cover them. */
export function seasonOutlookSentence(english: string, language: string): string {
  if (language !== 'es') return english
  const fixed: Record<string, string> = {
    'No matchups have been synced for this league.': 'No se han sincronizado enfrentamientos de esta liga.',
    'We cannot identify your team in this league, so nothing here is about you.': 'No podemos identificar tu equipo en esta liga, así que esta explicación no se refiere a ti.',
    'Settled — you are in.': 'Decidido: estás dentro.',
    'Eliminated — no remaining result gets you into the field.': 'Eliminado: ningún resultado pendiente te clasifica.',
    'Settled — the regular season is over and you are out.': 'Decidido: la temporada regular terminó y estás fuera.',
    'The regular season is over; the seeding is already what it is.': 'La temporada regular terminó; las posiciones ya están definidas.',
    'Out in every simulated run.': 'Fuera en todas las simulaciones.',
    'In the field in about 1 run in 100.': 'Clasificas en aproximadamente 1 de cada 100 simulaciones.',
  }
  if (fixed[english]) return fixed[english]
  let m = english.match(/^([\d,–]+) simulations per league, played over each league's own remaining schedule/)
  if (m) return `${m[1]} simulaciones por liga con su calendario restante, plazas de playoffs y descansos. La puntuación semanal se ajusta con las semanas completas de cada equipo según las reglas de su liga. El récord y la posición corresponden a esta temporada. Los rangos muestran la incertidumbre del pronóstico.${english.includes('Some leagues ran fewer than') ? ' Algunas ligas tuvieron menos simulaciones para acelerar la carga; se completarán en una visita posterior.' : ''}`
  m = english.match(/^Only (\d+) of (\d+) teams have three or more completed weeks on file/)
  if (m) return `Solo ${m[1]} de ${m[2]} equipos tienen tres o más semanas completas registradas; no basta para simular.`
  m = english.match(/^The rest of the schedule is not on file — (.+) has sent only the weeks already played \(through week (\d+)\)/)
  if (m) return `Falta el calendario restante: ${m[1]} solo proporcionó las semanas ya jugadas hasta la ${m[2]}. No podemos saber si la temporada terminó.`
  m = english.match(/^On the bubble at (\d+)% with (\d+) to play/)
  if (m) return `En la burbuja con ${m[1]}% y ${m[2]} partidos pendientes. Aquí una decisión de alineación puede importar más.`
  m = english.match(/^(\d+)% to win it\. Playing for seeding now/)
  if (m) return `${m[1]}% de ganar el campeonato. Ahora juegas por una mejor posición.`
  m = english.match(/^(\d+)% to make the field\. Needs help/)
  if (m) return `${m[1]}% de clasificar. Necesitas ayuda además de victorias.`
  m = english.match(/^Clinched\. The last (\d+) are about seeding\.$/)
  if (m) return `Clasificado. Los ${m[1]} partidos restantes definirán tu posición.`
  m = english.match(/^In all but a rounding error\. The last (\d+) are about seeding\.$/)
  if (m) return `Casi asegurado. Los ${m[1]} partidos restantes definirán tu posición.`
  m = english.match(/^You already have (\d+) wins, which gets you in (nine times in ten|more often than not)\.$/)
  if (m) return `Ya tienes ${m[1]} victorias; eso te clasifica ${m[2] === 'nine times in ten' ? 'en nueve de cada diez simulaciones' : 'más de la mitad de las veces'}.`
  m = english.match(/^Get to (\d+) wins — (\d+) of your last (\d+) — and you are in (nine times in ten|more often than not)\.( You will likely need help too\.)?$/)
  if (m) return `Llega a ${m[1]} victorias: necesitas ${m[2]} de los últimos ${m[3]} partidos. Así clasificas ${m[4] === 'nine times in ten' ? 'en nueve de cada diez simulaciones' : 'más de la mitad de las veces'}.${m[5] ? ' Probablemente también necesites ayuda.' : ''}`
  m = english.match(/^No win total gets you in reliably — winning out still needs help from outside the top (\d+)\.$/)
  if (m) return `Ningún total de victorias garantiza clasificar: incluso ganando todo, necesitas ayuda de equipos fuera de los ${m[1]} primeros.`
  m = english.match(/^Win (this one|once in (\d+)) and you are almost certainly in\.$/)
  if (m) return `${m[2] ? `Gana uno de los ${m[2]} restantes` : 'Gana este partido'} y casi seguro clasificarás.`
  m = english.match(/^Win (\d+) of the last (\d+) and you are in more often than not\.$/)
  if (m) return `Gana ${m[1]} de los últimos ${m[2]} partidos y clasificarás más de la mitad de las veces.`
  m = english.match(/^You need (this one|most of the last (\d+)), and help — currently outside the top (\d+)\.$/)
  if (m) return `Necesitas ${m[2] ? `ganar la mayoría de los últimos ${m[2]}` : 'ganar este partido'} y ayuda; ahora estás fuera de los ${m[3]} primeros.`
  return coreUiCopy(english, language)
}

export function SeasonOutlook({ data, freshness = null }: SeasonOutlookProps) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const copy = (english: string) => coreUiCopy(english, language)
  const hasLeagues = data.leagues.length > 0
  const preseasonKickoffLabel =
    data.firstKickoffAt && new Date(data.firstKickoffAt).getTime() > Date.now()
      ? /* Pinned en-US so it hydrates; translated at render — "Oct 4" → «4 oct». */
        kickoffText(kickoffDayLabel(data.firstKickoffAt), language)
      : null

  /* The three results that swing your season most, across every league. */
  const swings = Object.values(data.swingByLeague)
    .sort((a, b) => b.swing - a.swing)
    .slice(0, 3)
  const anyByes = data.leagues.some((l) => l.byeTeams > 0)
  const next = data.priorities[0] ?? null

  return (
    <div className="af-so af-olk">
      <header className="af-so-head">
        <p className="af-so-eyebrow af-label">{copy('Across every league you play')}</p>
        <div className="af-olk-titlerow">
          <h1 className="af-display af-so-title">{copy('Season Outlook')}</h1>
          {/* Beside the title, not in it: the tiles below have no heading of their own to carry it. */}
          {hasLeagues ? <TopicTip topic="outlookTiles" /> : null}
          {freshness ? (
            <FreshnessChip meta={freshness.meta} initialLabel={freshness.initialLabel} initialWarn={freshness.initialWarn} />
          ) : null}
        </div>
        <p className="af-so-sub">
          {copy("Playoff, bye and championship odds, simulated per league against that league's own rules. Open a league for its what-ifs, moves and roster risk.")}
        </p>
      </header>

      {hasLeagues ? (
        <>
          <section className="af-so-tiles" aria-label={copy('Your odds across leagues')}>
            <Tile
              value={String(data.summary.makingPlayoffs)}
              label={es ? `de ${data.leagues.length} con opciones de playoffs` : `of ${data.leagues.length} on track for the playoffs`}
              tone="accent"
            />
            <Tile value={String(data.summary.clinched)} label={copy('already clinched')} tone="good" />
            <Tile value={String(data.summary.onTheBubble)} label={copy('on the bubble')} tone="warn" />
            {anyByes ? <Tile value={String(data.summary.onByePace)} label={copy('on pace for a bye')} /> : null}
            <Tile
              value={data.summary.bestTitle ? `${pct(data.summary.bestTitle.pct)}%` : '—'}
              label={
                data.summary.bestTitle
                  ? es ? `mejor probabilidad de título · ${data.summary.bestTitle.leagueName}` : `best title odds · ${data.summary.bestTitle.leagueName}`
                  : copy('no title odds yet')
              }
            />
          </section>

          <section className="af-olk-hero-grid af-so-lead" aria-label={copy('What to do next')}>
            <div className="af-olk-next">
              <h2 className="af-label">{copy('Next action')}</h2>
              {next ? (
                <>
                  <p className="af-olk-next-t">{next.leagueName}</p>
                  <p className="af-olk-next-d">{seasonOutlookSentence(next.reason, language)}</p>
                  <Link className="af-btn af-olk-next-cta" href={next.href}>
                    {es ? 'Abrir' : 'Open'} {next.leagueName}
                  </Link>
                </>
              ) : (
                <p className="af-olk-next-d">{copy('No league needs a decision right now.')}</p>
              )}
            </div>
            <div className="af-olk-drivebox">
              <h2 className="af-label">
                {copy('The games that swing your season')} <TopicTip topic="swingGame" />
              </h2>
              {swings.length === 0 ? (
                <p className="af-olk-empty">{copy('No single game left moves your odds in a contested league.')}</p>
              ) : (
                <ol className="af-olk-drivers">
                  {swings.map((s) => (
                    <li key={s.leagueId} className="af-olk-driver" data-dir="both">
                      <div className="af-olk-driver-top">
                        <Link className="af-olk-driver-l" href={`/core/season-outlook?league=${encodeURIComponent(s.leagueId)}`}>
                          {s.leagueName} · {copy('week')} {s.week}
                        </Link>
                        <span className="af-olk-driver-v af-num">±{(s.swing / 2).toFixed(0)} pts</span>
                      </div>
                      <span className="af-olk-diverge" aria-hidden>
                        <span className="af-olk-diverge-mid" />
                        <span className="af-olk-diverge-bar" data-side="left" style={{ width: `${Math.min(50, s.swing / 2)}%` }} />
                        <span className="af-olk-diverge-bar" data-side="right" style={{ width: `${Math.min(50, s.swing / 2)}%` }} />
                      </span>
                      <p className="af-olk-driver-d">
                        {s.opponentName ? es ? `Contra ${s.opponentName}: ` : `Against ${s.opponentName}: ` : ''}
                        {es ? `${pct(s.ifWin)}% si ganas; ${pct(s.ifLose)}% si pierdes.` : `${pct(s.ifWin)}% with a win, ${pct(s.ifLose)}% with a loss.`}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>

          {/* The basis. Never optional, never a tooltip. */}
          <p className="af-so-basis">
            {seasonOutlookSentence(data.basis, language)}{' '}
            {data.runs.reused > 0
              ? es ? `Se reutilizaron ${data.runs.reused} de ${data.runs.reused + data.runs.computed} simulaciones porque sus datos no cambiaron.` : `${data.runs.reused} of ${data.runs.reused + data.runs.computed} league runs were reused because nothing they read had changed.`
              : ''}
          </p>

          <section className="af-so-tablewrap">
            <table className="af-so-table">
              <thead>
                <tr>
                  <th scope="col">
                    {copy('League')} <TopicTip topic="strengthOfSchedule" />
                  </th>
                  <th scope="col" className="af-so-num">{copy('Record')}</th>
                  <th scope="col" className="af-so-num">{copy('Seed')}</th>
                  <th scope="col" className="af-so-num">
                    {copy('Playoffs')} <TopicTip topic="outlookPlayoffOdds" />
                  </th>
                  {anyByes ? <th scope="col" className="af-so-num">{copy('Bye')}</th> : null}
                  <th scope="col" className="af-so-num">{copy('Title')}</th>
                  <th scope="col">{copy('What decides it')}</th>
                </tr>
              </thead>
              <tbody>
                {data.leagues.map((l) => {
                  const rest = l.you?.schedule?.remainingRank
                  return (
                    <tr key={l.leagueId}>
                      <th scope="row">
                        <Link
                          href={`/core/season-outlook?league=${encodeURIComponent(l.leagueId)}`}
                          className="af-so-league"
                          data-platform={l.platform}
                        >
                          {l.leagueName}
                        </Link>
                        <span className="af-so-leaguemeta af-num">
                          {l.season} · {es ? `primeros ${l.playoffTeams} de ${l.assumptions.teams}` : `top ${l.playoffTeams} of ${l.assumptions.teams}`}
                          {l.byeTeams > 0 ? es ? `, ${l.byeTeams} descansos` : `, ${l.byeTeams} bye${l.byeTeams === 1 ? '' : 's'}` : ''} ·{' '}
                          {l.weeksRemaining === 0 ? copy('season over') : es ? `${l.weeksRemaining} por jugar` : `${l.weeksRemaining} to play`}
                          {rest != null && l.weeksRemaining > 0 ? es ? ` · ${rest}.º calendario más difícil restante` : ` · ${ordinal(rest)} hardest schedule left` : ''}
                        </span>
                        {l.you?.status ? <StatusPill status={l.you.status} /> : null}
                      </th>
                      {l.you ? (
                        <>
                          <td className="af-so-num" data-label={copy('Record')}>
                            {l.you.wins}–{l.you.losses}
                          </td>
                          <td className="af-so-num" data-label={copy('Seed')}>
                            {l.you.seed}
                          </td>
                          <td className="af-so-num" data-label={copy('Playoffs')}>
                            <span className="af-so-pct" data-band={band(l.you.playoffPct)}>
                              {pct(l.you.playoffPct)}%
                            </span>
                            {l.you.range ? <span className="af-so-range af-num">{rangeLabel(l.you.range.playoff)}</span> : null}
                          </td>
                          {anyByes ? (
                            <td className="af-so-num" data-label={copy('Bye')}>
                              {l.byeTeams > 0 ? `${pct(l.you.byePct)}%` : '—'}
                            </td>
                          ) : null}
                          <td className="af-so-num" data-label={copy('Title')}>
                            {/* Neutral on purpose: a 3% title chance is ordinary, not a warning. */}
                            <span className="af-so-pct" data-band="none">
                              {pct(l.you.titlePct)}%
                            </span>
                            {l.you.range ? <span className="af-so-range af-num">{rangeLabel(l.you.range.title)}</span> : null}
                          </td>
                        </>
                      ) : (
                        <td className="af-so-noteam" colSpan={anyByes ? 5 : 4}>
                          {copy('We cannot tell which team is yours in this league.')}
                        </td>
                      )}
                      <td className="af-so-decides">{seasonOutlookSentence(l.whatDecidesIt, language)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        </>
      ) : preseasonKickoffLabel ? (
        <div className="af-so-empty">
          <p className="af-so-empty-t">{copy('The season has not started yet.')}</p>
          <p className="af-so-empty-b">
            {es ? `Las probabilidades se simulan a partir de las semanas completas de cada equipo. Aún no se ha jugado ninguna esta temporada. Empezarán a aparecer tras el primer partido: ${preseasonKickoffLabel}.` : `Odds are simulated from each team's completed weeks, and none have been played this season. They start filling in as weeks are scored — first kickoff ${preseasonKickoffLabel}.`}
          </p>
        </div>
      ) : (
        <div className="af-so-empty">
          <p className="af-so-empty-t">{copy('Nothing can be simulated yet.')}</p>
          <p className="af-so-empty-b">
            {copy("Odds are computed from synced matchups — each team's completed weeks in its own league's scoring. None of your leagues has enough of that on file, so there is nothing to run. That is a gap in what we have read, not a season with no games.")}
          </p>
          <Link href="/import" className="af-so-cta">
            {copy('Import or re-sync a league')}
          </Link>
        </div>
      )}

      {/* Withheld leagues, listed. A league that silently vanished reads as a league you are not in. */}
      {data.withheld.length > 0 ? (
        <section className="af-so-withheld">
          <h2 className="af-so-withheld-t">
            {es ? `${data.withheld.length} ${data.withheld.length === 1 ? 'liga no aparece' : 'ligas no aparecen'} en esta página` : `${data.withheld.length} ${data.withheld.length === 1 ? 'league is' : 'leagues are'} not on this page`}
          </h2>
          <ul>
            {/* Keyed by position too: two withheld leagues can share a name (one per season). */}
            {data.withheld.map((w, i) => (
              <li key={`${w.leagueName}-${i}`}>
                <b>{w.leagueName}</b> — {seasonOutlookSentence(w.reason, language)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

export default SeasonOutlook
