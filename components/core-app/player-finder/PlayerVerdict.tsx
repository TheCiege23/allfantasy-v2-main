'use client'

import type { LeagueImpact } from '@/lib/core-app/playerImpact'
import { availableImportPlatformsPhrase } from '@/lib/league-import/provider-ui-config'
import { fixesTotal, formatDelta, type PlayerMove } from '@/lib/core-app/playerMoves'
import { moveText, slotText } from '@/lib/core-app/playerMovesCopy'
import { platformsPhraseText } from '@/lib/core-app/shellCopy'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * The "Ask Chimmy" verdict card — computed, not generated.
 *
 * ⚠ NO LLM CALL, DELIBERATELY. The handoff draws this as a written paragraph,
 * which invites generating it on page load. That would bill a Chimmy request on
 * every player view — the exact per-visit cost that was stripped out of the home
 * screen in #433. Everything below is assembled from `impact` and the composed
 * moves, which are already computed for this screen, so the card costs nothing
 * at rest and cannot say something the data does not support. "Ask Chimmy"
 * stays the click-through that actually spends a token.
 *
 * ⚠ THE "+13.0" IS NOW DERIVABLE, AND ONLY FROM MEASURED HALVES. This card used
 * to stop at "where he is sitting", because `replacements` answers "who plays
 * INSTEAD of him" and the inverse was not stored. `impact.startOver` now stores
 * the inverse — the weakest starter he is eligible to replace, priced under that
 * league's scoring — and an IR-slot player's whole projection is the IR fix. The
 * total is the sum of those, or absent when none could be priced. It is never a
 * generic number.
 *
 * ⚠ SLOT TRUTH BEATS PROJECTION — the handoff's rule and this screen's reason to
 * exist. A benched player with a good number is the headline, so the count of
 * leagues where he is misplaced leads.
 *
 * Spanish (2026-10-04): every headline is written in both languages here, from the same counts; the
 * one-league headline names the move through `moveText` (lib/core-app/playerMovesCopy.ts), so the
 * move reads the same on this card as on its own. The provider starts at English on server and
 * client alike, so the first paint agrees.
 */

function fmt(n: number): string {
  return n.toFixed(1)
}

export function PlayerVerdict({
  playerName,
  impact,
  moves,
  scope = 'all',
}: {
  playerName: string
  impact: LeagueImpact[]
  /** The composed moves for this player; the league-scored ones drive the headline. */
  moves: PlayerMove[]
  /**
   * 'league' when the screen is filtered to one league (Guap, 2026-09-02):
   * the headline then names the one move rather than counting leagues.
   */
  scope?: 'all' | 'league'
}) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  if (impact.length === 0) return null

  const benched = impact.filter((i) => !i.isStarting)
  const starting = impact.filter((i) => i.isStarting)
  const fixes = moves.filter((m) => m.tone !== 'good')
  const total = fixesTotal(fixes)
  const n = impact.length
  const leagues = n === 1 ? 'league' : 'leagues'
  const ligas = n === 1 ? 'liga' : 'ligas'

  /*
   * Only leagues where we could actually price him under that league's scoring.
   * A benched league with no `afPoints` is still worth naming — it just cannot
   * carry a number, and inventing one is the failure this screen exists to avoid.
   */
  const pricedBenched = benched
    .map((i) => (i.afPoints.available ? { league: i, points: i.afPoints.data.points } : null))
    .filter((x): x is { league: LeagueImpact; points: number } => x !== null)
    .sort((a, b) => b.points - a.points)
  const best = pricedBenched[0] ?? null

  let headline: string
  if (es) {
    if (scope === 'league') {
      if (fixes.length > 0) {
        headline = `${moveText(fixes[0], 'es').title}${total != null ? `: ${formatDelta(total)} con la puntuación de esta liga` : ''}.`
      } else if (benched.length === 0) {
        headline = 'Aquí es titular. Nada que hacer.'
      } else if (benched.every((b) => b.startOver != null)) {
        headline = 'Aquí está en tu banca, y es lo correcto con la puntuación de esta liga.'
      } else if (best) {
        headline = `Aquí está en tu banca: vale ${fmt(best.points)} con la puntuación de esta liga.`
      } else {
        headline = 'Aquí está en tu banca.'
      }
    } else if (fixes.length > 0) {
      const count = fixes.length === 1 ? 'Una corrección' : `${fixes.length} correcciones`
      headline = `Está mal ubicado en ${fixes.length} de ${n} ${ligas}. ${count}${total != null ? ` por ${formatDelta(total)}` : ''}.`
    } else if (benched.length === 0) {
      headline = `Está en tu alineación en ${starting.length === 1 ? 'la única liga' : `las ${starting.length} ligas`} donde lo tienes.`
    } else if (benched.every((b) => b.startOver != null)) {
      headline = `Está en tu banca en ${benched.length} de ${n} ${ligas}, y es lo correcto con la puntuación de cada liga.`
    } else if (best) {
      headline = `Está en tu banca en ${benched.length} de ${n} ${ligas}: vale ${fmt(best.points)} en ${best.league.leagueName}.`
    } else {
      headline = `Está en tu banca en ${benched.length} de ${n} ${ligas}.`
    }
  } else if (scope === 'league') {
    // One league: say the move, not the count.
    if (fixes.length > 0) {
      headline = `${fixes[0].title}${total != null ? ` — ${formatDelta(total)} under this league's scoring` : ''}.`
    } else if (benched.length === 0) {
      headline = 'He starts here. Nothing to do.'
    } else if (benched.every((b) => b.startOver != null)) {
      headline = "He is on your bench here, and that is the right call under this league's scoring."
    } else if (best) {
      headline = `He is on your bench here — worth ${fmt(best.points)} under this league's scoring.`
    } else {
      headline = 'He is on your bench here.'
    }
  } else if (fixes.length > 0) {
    const count = fixes.length === 1 ? 'One fix' : `${fixes.length} fixes`
    headline = `He is misplaced in ${fixes.length} of ${n} ${leagues}. ${count}${
      total != null ? ` for ${formatDelta(total)}` : ''
    }.`
  } else if (benched.length === 0) {
    headline = `He is in your lineup in all ${starting.length} ${
      starting.length === 1 ? 'league' : 'leagues'
    } you roster him.`
  } else if (benched.every((b) => b.startOver != null)) {
    // Every benched league was priced both ways and none gained — the bench is right.
    headline = `He is on your bench in ${benched.length} of ${n} ${leagues}, and that is the right call under each league's scoring.`
  } else if (best) {
    headline = `He is on your bench in ${benched.length} of ${n} ${leagues} — worth ${fmt(best.points)} in ${best.league.leagueName}.`
  } else {
    headline = `He is on your bench in ${benched.length} of ${n} ${leagues}.`
  }

  /*
   * The phone's "Open in Sleeper / Open in ESPN" pair — one button per platform
   * screen the fixes land on, so a two-league problem is two taps. Desktop has
   * the full move cards for this and hides these.
   */
  const opens: Array<{ href: string; label: string; external: boolean }> = []
  for (const m of fixes) {
    if (!m.link) continue
    if (opens.some((o) => o.href === m.link!.href)) continue
    opens.push({ href: m.link.href, label: es ? `Abrir en ${m.link.platformLabel}` : m.link.label, external: m.link.external })
    if (opens.length === 3) break
  }

  return (
    <section className="af-card af-pf-verdict" aria-label={es ? 'Veredicto de Chimmy' : 'Chimmy verdict'}>
      <header className="af-pf-verdict-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="af-pf-verdict-mark"
          src="/af-robot-king.png"
          alt=""
          width={34}
          height={34}
        />
        <span className="af-pf-verdict-id">
          {/* The handoff's screenshot says CHIMMY INTELLIGENCE; its own open item
              says ship it as ASK CHIMMY to match the rest of the product. */}
          <span className="af-label">{es ? 'Preguntar a Chimmy' : 'Ask Chimmy'}</span>
          <span className="af-pf-verdict-scope af-num">
            {es
              ? scope === 'league'
                ? 'Veredicto · esta liga'
                : `Veredicto · ${n} ${ligas}`
              : scope === 'league'
                ? 'Verdict · this league'
                : `Verdict · ${n} ${n === 1 ? 'league' : 'leagues'}`}
          </span>
        </span>
        {total != null ? (
          <span className="af-pf-verdict-total af-num" data-tone="good">
            {formatDelta(total)}
          </span>
        ) : null}
      </header>

      <p className="af-pf-verdict-headline">{headline}</p>

      {/*
        Per-league detail, because "the same player is a different asset per
        league" is the point of the screen. Each line carries the league's own
        scoring result, never a global number.
      */}
      <ul className="af-pf-verdict-list">
        {impact.map((i) => (
          <li key={i.leagueId} className="af-pf-verdict-row" data-starting={i.isStarting}>
            <span className="af-pf-verdict-league">{i.leagueName}</span>
            <span className="af-pf-verdict-slot af-num">{slotText(i.exactSlot ?? i.slot, language)}</span>
            <span className="af-pf-verdict-pts af-num">
              {i.afPoints.available ? fmt(i.afPoints.data.points) : '—'}
            </span>
          </li>
        ))}
      </ul>

      {opens.length > 0 ? (
        <div className="af-pf-verdict-opens af-pf-m-only">
          {opens.map((o) => (
            <a
              key={o.href}
              className="af-btn af-pf-verdict-open"
              href={o.href}
              {...(o.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              {o.label}
            </a>
          ))}
        </div>
      ) : null}

      {/*
        The read-only promise is stated, not implied — the handoff is explicit
        that this is a promise rather than a footnote.
      */}
      {es ? (
        <p className="af-pf-verdict-readonly">
          AllFantasy es de solo lectura. Cada cambio se hace en {platformsPhraseText(availableImportPlatformsPhrase(), 'es')}: te
          mostramos qué liga y qué pantalla.
        </p>
      ) : (
        <p className="af-pf-verdict-readonly">
          AllFantasy is read-only. Every change happens on {availableImportPlatformsPhrase()} —
          we show you which league and which screen.
        </p>
      )}

      {/*
        The paid click (Guap, 2026-09-02). It lands in the chat, not on the
        landing page, with the question already typed — the chat route reads
        `prompt`, not `q`.
      */}
      <a
        className="af-btn af-pf-verdict-cta"
        href={`/chimmy/chat?prompt=${encodeURIComponent(
          es ? `¿Qué debería hacer con ${playerName} esta semana?` : `What should I do with ${playerName} this week?`,
        )}`}
      >
        {es ? 'Preguntar a Chimmy sobre' : 'Ask Chimmy about'} {playerName.split(' ').slice(-1)[0]}
      </a>
    </section>
  )
}

export default PlayerVerdict
