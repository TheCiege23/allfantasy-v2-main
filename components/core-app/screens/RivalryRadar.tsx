'use client'

import Link from 'next/link'
import type { RivalryCard, RivalryRadar as RivalryRadarData } from '@/lib/core-app/weekBoard'
import { rosterLabel } from '@/lib/core-app/managerName'
import { kickoffDayLabel } from '@/lib/core-app/kickoffLabel'
import '@/components/core-app/af-week.css'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { TopicTip } from '@/components/core-app/TopicTip'

/**
 * 24b — Rivalry Radar.
 *
 * ⚠ A SINGLE MEETING IS NEVER CALLED A RIVALRY. The loader sets
 * `sampleTooSmall` and this screen renders those in their own tier with the
 * sample size stated — "One meeting, one blowout. Not a rivalry yet." The
 * judgement is made once, in the loader, so two surfaces cannot disagree about
 * where the line is.
 *
 * ⚠ EVERY CARD PAIRS HISTORY WITH TODAY. The handoff's rationale is that one
 * without the other is an incomplete story, so a card with a series record but
 * no projection says so explicitly rather than leaving the space blank and
 * letting the reader assume the game is not on.
 *
 * ⚠ "CLOSEST EVER" ALWAYS CITES SEASON, WEEK AND MARGIN. Never summarised into
 * "a nail-biter" — the actual game is the evidence for the claim.
 */

export type RivalryRadarProps = {
  data: RivalryRadarData
  /** Back to the matchup list, which shares this screen key. */
  weekHref: string
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`
}

function opponentLabel(card: RivalryCard): string {
  return rosterLabel([card.opponent.name], card.opponent.rosterId)
}

/**
 * W–L, or W–L–T once a meeting has finished level. Most series have no ties and
 * read exactly as before; a tie is never folded into the losses column. Digits
 * and dashes only, so it reads the same in English and Spanish.
 */
function seriesRecord(series: RivalryCard['series']): string {
  return series.ties > 0
    ? `${series.wins}–${series.losses}–${series.ties}`
    : `${series.wins}–${series.losses}`
}

function Card({ card, tone }: { card: RivalryCard; tone: 'bad' | 'good' | 'neutral' }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const copy = (english: string) => coreUiCopy(english, language)
  const { series, closest, thisWeek } = card
  return (
    <article className="af-rr-card" data-tone={tone}>
      <header className="af-rr-cardhead">
        <div className="af-rr-who">
          <h3 className="af-rr-opp">{opponentLabel(card)}</h3>
          <p className="af-rr-league" data-platform={card.platform}>
            {card.leagueName}
          </p>
        </div>
        <div className="af-rr-record af-num" data-tone={tone}>
          {seriesRecord(series)}
          <span className="af-rr-record-label">{copy('all-time')}</span>
        </div>
      </header>

      {card.sampleTooSmall ? (
        <p className="af-rr-small">
          {series.meetings === 1
            ? copy('One meeting. Not a rivalry yet — one game tells you almost nothing about the next one.')
            : copy('No completed meetings yet. The series starts when they play.')}
        </p>
      ) : (
        <dl className="af-rr-stats">
          <div>
            <dt>{copy('Average margin')}</dt>
            <dd className="af-num" data-sign={card.averageMargin >= 0 ? 'pos' : 'neg'}>
              {card.averageMargin >= 0 ? '+' : ''}
              {card.averageMargin.toFixed(1)}
            </dd>
          </div>
          <div>
            <dt>{copy('Meetings')}</dt>
            <dd className="af-num">{series.meetings}</dd>
          </div>
        </dl>
      )}

      {closest ? (
        <p className="af-rr-closest">
          <b>{copy('Closest ever')}</b> · {closest.season} {copy('week')} {closest.week} —{' '}
          {closest.tied ? (
            // A dead heat has no winner and no margin to print — "you lost by 0.0" was the bug.
            copy('a tie')
          ) : (
            <>
              {copy(closest.won ? 'you won by' : 'you lost by')}{' '}
              <span className="af-num">{Math.abs(closest.margin).toFixed(1)}</span>
            </>
          )}
        </p>
      ) : null}

      {/* The live half. Present as its own row so its absence is visible. */}
      <footer className="af-rr-today">
        {thisWeek == null ? (
          <span className="af-rr-today-none">{copy('Not on your schedule this week.')}</span>
        ) : thisWeek.winProbability == null ? (
          <span className="af-rr-today-none">
            {copy('Playing this week — not enough completed weeks on either side to project it.')}
          </span>
        ) : (
          <>
            <span className="af-rr-today-label">{copy('This week')}</span>
            <span
              className="af-rr-today-prob af-num"
              data-favoured={thisWeek.winProbability >= 0.5}
            >
              {pct(thisWeek.winProbability)}
            </span>
            <span className="af-rr-today-gap af-num">
              {thisWeek.projectedMargin != null
                ? `${thisWeek.projectedMargin >= 0 ? '+' : ''}${thisWeek.projectedMargin.toFixed(1)} ${es ? 'proyectados' : 'projected'}`
                : ''}
            </span>
          </>
        )}
      </footer>

      <Link href={`/core/matchup?league=${encodeURIComponent(card.leagueId)}`} className="af-rr-open">
        {copy('Open the matchup')}
      </Link>
    </article>
  )
}

function Tier({
  title,
  note,
  cards,
  tone,
}: {
  title: string
  note: string
  cards: RivalryCard[]
  tone: 'bad' | 'good' | 'neutral'
}) {
  if (cards.length === 0) return null
  return (
    <section className="af-rr-tier" data-tone={tone}>
      <div className="af-rr-tierhead">
        <h2 className="af-rr-tiertitle">{title}</h2>
        <p className="af-rr-tiernote">{note}</p>
      </div>
      <div className="af-rr-grid">
        {cards.map((c) => (
          <Card key={`${c.leagueId}-${c.opponent.rosterId}`} card={c} tone={tone} />
        ))}
      </div>
    </section>
  )
}

export function RivalryRadar({ data, weekHref }: RivalryRadarProps) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const copy = (english: string) => coreUiCopy(english, language)
  const anything = data.theyOwnYou.length + data.youOwnThem.length + data.even.length > 0
  /*
   * Phase-aware empty state. Before the first stated regular-season kickoff,
   * "import or re-sync" prescribes a fix for something that is not broken —
   * there are no scored weeks anywhere yet. The instant comes from the loader
   * (lib/core-app/seasonPhase.ts); when no source states one, this stays null
   * and the sync copy stands rather than a guessed date.
   */
  const preseasonKickoffLabel =
    data.firstKickoffAt && new Date(data.firstKickoffAt).getTime() > Date.now()
      ? kickoffDayLabel(data.firstKickoffAt)
      : null

  return (
    <div className="af-wk af-rr">
      <header className="af-wk-head">
        <div>
          <p className="af-wk-eyebrow af-label">
            {data.season && data.week ? `${data.season} · ${copy('Week')} ${data.week}` : copy('Rivalry Radar')}
          </p>
          <h1 className="af-display af-wk-title">{copy('Rivalry Radar')}</h1>
          <p className="af-wk-sub">
            {anything ? (
              <>
                {/* Every opponent with a completed meeting is listed, plus this week's — not only this week's. */}
                {es ? 'Cada rival al que te has enfrentado o te enfrentas esta semana, según nuestro historial: ' : "Every opponent you have played or play this week, read through every meeting we have on file — "}
                <span className="af-num">{data.totals.meetings}</span> {es ? data.totals.meetings === 1 ? 'enfrentamiento' : 'enfrentamientos' : data.totals.meetings === 1 ? 'completed matchup' : 'completed matchups'} {es ? 'en' : 'across'}{' '}
                <span className="af-num">{data.totals.seasons}</span>{' '}
                {es ? data.totals.seasons === 1 ? 'temporada' : 'temporadas' : data.totals.seasons === 1 ? 'season' : 'seasons'} {es ? 'y' : 'and'}{' '}
                <span className="af-num">{data.totals.platforms}</span>{' '}
                {es ? data.totals.platforms === 1 ? 'plataforma' : 'plataformas' : data.totals.platforms === 1 ? 'platform' : 'platforms'}.{' '}
                <TopicTip topic="rivalrySeries" />
              </>
            ) : (
              copy('No head-to-head history is on file yet.')
            )}
          </p>
        </div>
        <div className="af-wk-headactions">
          <Link href={weekHref} className="af-btn af-wk-btn af-wk-btn--ghost">
            {copy('All matchups')}
          </Link>
        </div>
      </header>

      {/*
        "The one to watch". The selection rule is stated in the panel rather than
        left implicit — the handoff asked for the exact logic to be pinned down,
        and a reader cannot check a rule they cannot see.
      */}
      {data.oneToWatch ? (
        <aside className="af-rr-watch">
          <p className="af-rr-watch-eyebrow af-label">{copy('The one to watch')}</p>
          <h2 className="af-rr-watch-title">
            {opponentLabel(data.oneToWatch)} · {data.oneToWatch.leagueName}
          </h2>
          <p className="af-rr-watch-body">
            {seriesRecord(data.oneToWatch.series)} {es ? 'en el historial, con una diferencia media de' : 'all-time at an average margin of'} {Math.abs(data.oneToWatch.averageMargin).toFixed(1)}
            {data.oneToWatch.thisWeek?.projectedMargin != null ? (
              <>
                {es ? ', y una diferencia proyectada de ' : ', and projected within '}
                {Math.abs(data.oneToWatch.thisWeek.projectedMargin).toFixed(1)} {es ? 'hoy.' : 'today.'}
              </>
            ) : (
              '.'
            )}
          </p>
          <p className="af-rr-watch-rule">
            {copy('Picked as the smallest combined figure of average historical margin and projected margin today — close then and close now, not one or the other.')}
          </p>
        </aside>
      ) : null}

      <Tier
        tone="bad"
        title={copy('They own you — statement week')}
        note={copy('Series you are behind in. The record is theirs until you change it.')}
        cards={data.theyOwnYou}
      />

      <Tier
        tone="good"
        title={copy('You own this one')}
        note={copy('Series you lead, and are not projected to lose today.')}
        cards={data.youOwnThem}
      />

      <Tier
        tone="neutral"
        title={copy('Too early, or too close to call')}
        note={copy("Level series, single meetings, and series where today's projection disagrees with the record.")}
        cards={data.even}
      />

      {!anything ? (
        preseasonKickoffLabel ? (
          <div className="af-wk-empty">
            <p className="af-wk-empty-t">{copy('The season has not started yet.')}</p>
            <p className="af-wk-empty-b">
              {es ? `Las rivalidades se basan en semanas puntuadas. Los historiales se formarán al avanzar la temporada; el primer partido comienza ${preseasonKickoffLabel}.` : `Rivalries are read from scored weeks, and none have been played this season. Records build as weeks are scored — first kickoff ${preseasonKickoffLabel}.`}
            </p>
          </div>
        ) : (
          <div className="af-wk-empty">
            <p className="af-wk-empty-t">{copy('No head-to-head history yet.')}</p>
            <p className="af-wk-empty-b">
              {copy('This view is computed from synced matchups across every season we hold. Nothing has been read for your leagues yet, so there are no series to compare — that is a gap in what we have, not a sign you have never played anybody.')}
            </p>
            <Link href="/import" className="af-btn af-wk-btn">
              {copy('Import or re-sync a league')}
            </Link>
          </div>
        )
      ) : null}
    </div>
  )
}

export default RivalryRadar
