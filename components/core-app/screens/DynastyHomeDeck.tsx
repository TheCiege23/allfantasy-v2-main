'use client'

import Link from 'next/link'
import { Crown, Trophy } from 'lucide-react'
import { useMessages } from '@/components/i18n/useMessages'
import { dynastyHomeDeckMessages } from '@/lib/core-app/messages/dynastyHomeDeck'
import type {
  DynastyHomeDeck as Deck,
  DynastyOffseason as Offseason,
  DynastyOffseasonMilestone as Milestone,
} from '@/lib/core-app/dynastyLeagueHome'
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

type Messages = typeof dynastyHomeDeckMessages.en

/**
 * A stored date as members read it. Pinned to US Eastern — the zone AllFantasy announces draft times
 * in (describeRookieDraftStart) — so the server render and the browser agree on the day.
 */
function formatDay(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }).format(new Date(iso))
}

function milestoneTitle(ms: Milestone, m: Messages): string {
  if (ms.key === 'rollover') return m.msRollover(ms.season)
  if (ms.key === 'keeper_deadline') return m.msKeeper
  if (ms.key === 'rookie_draft') return m.msRookieDraft(ms.season)
  return m.msKickoff(ms.season)
}

function milestoneWhen(ms: Milestone, m: Messages): string | null {
  if (ms.state === 'done') return m.done
  if (ms.state === 'live') return m.live
  if (ms.daysAway == null) return null
  return ms.daysAway === 0 ? m.today : ms.daysAway === 1 ? m.tomorrow : m.inDays(ms.daysAway)
}

/** The era band's heading and the line under it, between seasons. */
function OffseasonEra({ off, clock, m }: { off: Offseason; clock: Deck['clock']; m: Messages }) {
  const complete = off.phase === 'season_complete'
  const year = clock?.year ?? null
  const season = clock?.season ?? (complete ? off.completedSeason : off.nextSeason)
  const champ = off.champion
  return (
    <>
      <h2 className="af-lh-dy-year" data-testid="dynasty-home-clock">
        {year != null ? (
          <>
            {complete ? m.yearComplete(year) : m.yearBegins(year)} <span className="af-lh-dy-year-season">{m.season(season)}</span>
          </>
        ) : complete ? (
          m.seasonComplete(season)
        ) : (
          m.seasonBegins(season)
        )}
      </h2>
      {champ ? (
        <p className="af-lh-dy-champ" data-mine={champ.mine || undefined} data-testid="dynasty-home-champion">
          <Trophy size={18} aria-hidden />
          <span>
            {!complete ? <small>{m.reigning}</small> : null}
            {champ.mine ? m.youWon(champ.season) : m.championWon(champ.label ?? m.unnamed, champ.season)}
          </span>
        </p>
      ) : (
        <p className="af-lh-dy-tagline">{complete ? m.championPending(off.completedSeason) : m.offseasonTagline(off.nextSeason)}</p>
      )}
    </>
  )
}

/** The Offseason timeline: each stored milestone in order; one without a stored date says so. */
function OffseasonTimeline({ off, q, m }: { off: Offseason; q: string; m: Messages }) {
  return (
    <section className="af-lh-dy-off" aria-labelledby="af-lh-dy-off" data-testid="dynasty-home-offseason">
      <header className="af-lh-dy-card-head">
        <h3 id="af-lh-dy-off">{m.timeline}</h3>
        <Link href={`/core/draft-hq${q}`}>{m.draftHq}</Link>
      </header>
      <ol className="af-lh-dy-ms" aria-label={m.timelineLabel(off.nextSeason)}>
        {off.milestones.map((ms) => {
          const when = milestoneWhen(ms, m)
          return (
            <li
              key={ms.key}
              className="af-lh-dy-ms-step"
              data-key={ms.key}
              data-state={ms.state}
              data-undated={ms.at ? undefined : 'true'}
              data-testid="dynasty-home-milestone"
            >
              <span className="af-lh-dy-ms-dot" aria-hidden />
              <span className="af-lh-dy-ms-title">{milestoneTitle(ms, m)}</span>
              {ms.at ? (
                <time className="af-lh-dy-ms-date" dateTime={ms.at}>
                  {formatDay(ms.at, m.locale)}
                </time>
              ) : ms.state === 'upcoming' ? (
                <span className="af-lh-dy-ms-date">{m.noDate}</span>
              ) : null}
              {when ? <span className="af-lh-dy-ms-when">{when}</span> : null}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export function DynastyHomeDeck({ deck, leagueId }: { deck: Deck; leagueId: string }) {
  const m = useMessages(dynastyHomeDeckMessages)
  const q = `?league=${encodeURIComponent(leagueId)}`
  const { clock, rafters, picks, ages, taxi, offseason: off } = deck
  const nextPicks = off && picks ? (picks.seasons.find((s) => s.season === off.nextDraftSeason) ?? null) : null
  return (
    <section className="af-lh-dy" aria-label={m.deckLabel} data-testid="dynasty-home-deck" data-phase={off ? 'offseason' : undefined}>
      <div className="af-lh-dy-hero">
        <div className="af-lh-dy-era">
          <span className="af-lh-dy-crest" aria-hidden>
            <Crown size={26} strokeWidth={1.8} />
          </span>
          <div className="af-lh-dy-era-text">
            {off ? (
              <p className="af-lh-dy-eyebrow">
                {m.dynasty} <span className="af-lh-dy-phase">{m.offseason}</span>
              </p>
            ) : (
              <p className="af-lh-dy-eyebrow">{m.dynasty}</p>
            )}
            {off ? (
              <OffseasonEra off={off} clock={clock} m={m} />
            ) : clock ? (
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
            {off ? null : <p className="af-lh-dy-tagline">{m.tagline}</p>}
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

      {off ? <OffseasonTimeline off={off} q={q} m={m} /> : null}

      {picks || ages || taxi ? (
        <div className="af-lh-dy-grid">
          {picks ? (
            <section className="af-lh-dy-card" aria-labelledby="af-lh-dy-capital" data-testid="dynasty-home-capital">
              <header className="af-lh-dy-card-head">
                <h3 id="af-lh-dy-capital">{m.capital}</h3>
                <Link href={`/core/trades${q}`}>{m.tradePicks}</Link>
              </header>
              {nextPicks && off ? (
                <p className="af-lh-dy-big" data-testid="dynasty-home-next-draft">
                  <strong>{nextPicks.picks.length}</strong> <span>{m.inNextDraft(nextPicks.picks.length, off.nextDraftSeason)}</span>
                  <em>{m.heldInAll(picks.total)}</em>
                </p>
              ) : (
                <p className="af-lh-dy-big">
                  <strong>{picks.total}</strong> <span>{m.picksTotal(picks.total)}</span>
                  {picks.firstRounders > 0 ? <em>{m.firstRounders(picks.firstRounders)}</em> : null}
                </p>
              )}
              <ul className="af-lh-dy-drafts">
                {picks.seasons.map((s) => (
                  <li key={s.season} data-next={off && s.season === off.nextDraftSeason ? 'true' : undefined}>
                    <span className="af-lh-dy-draft-year">
                      {s.season}
                      {off && s.season === off.nextDraftSeason ? <small>{m.nextDraft}</small> : null}
                    </span>
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
              {off && !nextPicks ? <p className="af-lh-dy-note">{m.noNextDraftPicks(off.nextDraftSeason)}</p> : null}
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
              {/* The count once: "4 of 4 slots used — full", not "4", "4 of 4 slots used" and "Taxi squad is full." (2026-11-14). */}
              <p className="af-lh-dy-big">
                <strong>{taxi.slots > 0 ? m.taxiOf(taxi.count, taxi.slots) : taxi.count}</strong>
                <span>
                  {taxi.slots > 0
                    ? taxi.count >= taxi.slots ? m.taxiSlotsFull : m.taxiSlotsOpen(taxi.slots - taxi.count)
                    : m.taxiStashed(taxi.count)}
                </span>
              </p>
              {taxi.slots > 0 && taxi.slots <= MAX_SLOT_DOTS ? (
                <ol className="af-lh-dy-slots">
                  {Array.from({ length: taxi.slots }, (_, i) => (
                    <li key={i} data-filled={i < taxi.count || undefined} aria-label={i < taxi.count ? m.slotFilled : m.slotOpen} />
                  ))}
                </ol>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
