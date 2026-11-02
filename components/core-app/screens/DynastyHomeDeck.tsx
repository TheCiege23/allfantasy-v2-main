'use client'

import Link from 'next/link'
import { Crown, Trophy } from 'lucide-react'
import { useMessages } from '@/components/i18n/useMessages'
import { dynastyHomeDeckMessages } from '@/lib/core-app/messages/dynastyHomeDeck'
import type { DynastyHomeDeck as Deck } from '@/lib/core-app/dynastyLeagueHome'
import '@/components/core-app/af-league-home-dynasty.css'

/**
 * The Dynasty Era deck at the top of /core's league Home. Rendered only when the loader built one
 * (`LeagueHomeData.dynasty`, lib/core-app/dynastyLeagueHome.ts) — a dynasty league. The era band always
 * draws; every card below it is optional and simply absent when its data is. The builder decides that,
 * this file only draws.
 *
 * Colours are the `--dyn-*` tokens the shell stamps (components/core-app/af-core-dynasty.css), read with
 * fallbacks so the deck looks the same outside the shell (a test page).
 */

/** The age gauge runs over this span; the median's marker is clamped into it. */
const GAUGE_MIN = 21
const GAUGE_MAX = 33
const GAUGE_TICKS = [22, 26, 30]
const at = (age: number) => `${(Math.min(GAUGE_MAX, Math.max(GAUGE_MIN, age)) - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN) * 100}%`
/** More taxi slots than this draw as a count only — a row of 20 dots says nothing a number does not. */
const MAX_SLOT_DOTS = 8

export function DynastyHomeDeck({ deck, leagueId }: { deck: Deck; leagueId: string }) {
  const m = useMessages(dynastyHomeDeckMessages)
  const q = `?league=${encodeURIComponent(leagueId)}`
  const { clock, rafters, picks, ages, taxi } = deck
  return (
    <section className="af-lh-dy" aria-label={m.deckLabel} data-testid="dynasty-home-deck">
      <div className="af-lh-dy-hero">
        <div className="af-lh-dy-era">
          <span className="af-lh-dy-crest" aria-hidden>
            <Crown size={26} strokeWidth={1.8} />
          </span>
          <div className="af-lh-dy-era-text">
            <p className="af-lh-dy-eyebrow">{m.dynasty}</p>
            {clock ? (
              <h2 className="af-lh-dy-year" data-testid="dynasty-home-clock">
                {clock.year != null ? (
                  <>
                    {m.year(clock.year)} <span>· {m.season(clock.season)}</span>
                  </>
                ) : (
                  m.season(clock.season)
                )}
              </h2>
            ) : null}
            <p className="af-lh-dy-tagline">{m.tagline}</p>
          </div>
        </div>

        {rafters ? (
          <div className="af-lh-dy-rafters" data-testid="dynasty-home-rafters">
            <span className="af-lh-dy-label">{m.rafters}</span>
            <ol className="af-lh-dy-pennants">
              {rafters.pennants.map((p) => {
                const name = p.mine ? m.you : p.label ?? m.unnamed
                return (
                  <li key={p.season} className="af-lh-dy-pennant" data-mine={p.mine || undefined} aria-label={m.pennantAria(p.season, name)}>
                    <span className="af-lh-dy-pennant-year">{p.season}</span>
                    <span className="af-lh-dy-pennant-name">{name}</span>
                  </li>
                )
              })}
              {rafters.openSeason != null ? (
                <li className="af-lh-dy-pennant" data-open="true" aria-label={m.openAria(rafters.openSeason)}>
                  <span className="af-lh-dy-pennant-year">{rafters.openSeason}</span>
                  <span className="af-lh-dy-pennant-name">{m.open}</span>
                </li>
              ) : null}
            </ol>
            <span className="af-lh-dy-titles" data-mine={rafters.myTitles > 0 || undefined}>
              <Trophy size={14} aria-hidden />
              {rafters.myTitles > 0 ? m.myTitles(rafters.myTitles) : m.noTitlesYet}
            </span>
          </div>
        ) : null}
      </div>

      {picks || ages || taxi ? (
        <div className="af-lh-dy-grid">
          {picks ? (
            <section className="af-lh-dy-card" aria-labelledby="af-lh-dy-capital" data-testid="dynasty-home-capital">
              <header className="af-lh-dy-card-head">
                <h3 id="af-lh-dy-capital">{m.capital}</h3>
                <Link href={`/core/trades${q}`}>{m.tradePicks}</Link>
              </header>
              <p className="af-lh-dy-big">
                <strong>{picks.total}</strong> <span>{m.picksTotal(picks.total)}</span>
                {picks.firstRounders > 0 ? <em>{m.firstRounders(picks.firstRounders)}</em> : null}
              </p>
              <ul className="af-lh-dy-drafts">
                {picks.seasons.map((s) => (
                  <li key={s.season}>
                    <span className="af-lh-dy-draft-year">{s.season}</span>
                    <span className="af-lh-dy-chips">
                      {s.picks.map((p, i) => (
                        <span key={`${p.round}-${i}`} className="af-lh-dy-chip" data-round={p.round === 1 ? '1' : undefined} title={p.via ? m.via(p.via) : undefined}>
                          {p.label}
                          {p.via ? <small>{m.via(p.via)}</small> : null}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
              {picks.partial ? <p className="af-lh-dy-note">{m.partial}</p> : null}
            </section>
          ) : null}

          {ages ? (
            <section className="af-lh-dy-card" aria-labelledby="af-lh-dy-ages" data-testid="dynasty-home-ages">
              <header className="af-lh-dy-card-head">
                <h3 id="af-lh-dy-ages">{m.ageTitle}</h3>
                <Link href={`/core/my-team${q}`}>{m.myTeam}</Link>
              </header>
              <p className="af-lh-dy-big">
                <strong>{ages.medianStarterAge.toFixed(1)}</strong> <span>{m.medianAge}</span>
              </p>
              <div className="af-lh-dy-gauge" aria-hidden>
                <span className="af-lh-dy-gauge-bar" />
                <span className="af-lh-dy-gauge-mark" style={{ left: at(ages.medianStarterAge) }} />
                {GAUGE_TICKS.map((t) => (
                  <span key={t} className="af-lh-dy-gauge-tick" style={{ left: at(t) }}>
                    {t}
                  </span>
                ))}
              </div>
              <dl className="af-lh-dy-stats">
                <div>
                  <dt>{m.youngCore}</dt>
                  <dd data-tone="young">{ages.youngCore}</dd>
                </div>
                <div>
                  <dt>{m.aging}</dt>
                  <dd data-tone={ages.aging > 0 ? 'aging' : undefined}>{ages.aging}</dd>
                </div>
              </dl>
              {ages.known < ages.total ? <p className="af-lh-dy-note">{m.agesOf(ages.known, ages.total)}</p> : null}
            </section>
          ) : null}

          {taxi ? (
            <section className="af-lh-dy-card" aria-labelledby="af-lh-dy-taxi" data-testid="dynasty-home-taxi">
              <header className="af-lh-dy-card-head">
                <h3 id="af-lh-dy-taxi">{m.taxiTitle}</h3>
                <Link href={`/core/my-team${q}`}>{m.myTeam}</Link>
              </header>
              <p className="af-lh-dy-big">
                <strong>{taxi.count}</strong>
                <span>{taxi.slots > 0 ? m.taxiUsed(taxi.count, taxi.slots) : m.taxiCount(taxi.count)}</span>
              </p>
              {taxi.slots > 0 && taxi.slots <= MAX_SLOT_DOTS ? (
                <ol className="af-lh-dy-slots">
                  {Array.from({ length: taxi.slots }, (_, i) => (
                    <li key={i} data-filled={i < taxi.count || undefined} aria-label={i < taxi.count ? m.slotFilled : m.slotOpen} />
                  ))}
                </ol>
              ) : null}
              {taxi.slots > 0 ? <p className="af-lh-dy-note">{taxi.count >= taxi.slots ? m.taxiFull : m.taxiOpen}</p> : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
