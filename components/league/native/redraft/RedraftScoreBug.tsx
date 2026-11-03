'use client'

import type { ScoreBug } from '@/lib/league-media/redraftLeagueHome'
import { isDailyRedraftSport } from '@/lib/league-media/redraftLeagueHome'
import '@/components/league/native/redraft-home.css'

const STATUS_LABEL: Record<ScoreBug['status'], string> = { live: 'Live', final: 'Final', upcoming: 'Upcoming' }

/**
 * Broadcast-style score bug for this week's head-to-head matchup (redraft League home + football
 * Home). Everything comes from `buildScoreBug` over the Matchup tab's own `matchup-center` payload:
 * a stat without data is dropped, never shown as 0 or "—". Opens the Matchup tab.
 */
export function RedraftScoreBug({ bug, sport, onOpen }: { bug: ScoreBug; sport: string; onOpen?: () => void }) {
  const daily = isDailyRedraftSport(sport)
  const stats: { key: string; label: string; value: string }[] = []
  if (bug.status !== 'final' && (bug.you.yetToPlay > 0 || bug.them.yetToPlay > 0)) {
    stats.push({ key: 'left', label: 'Still to play', value: `${bug.you.yetToPlay} vs ${bug.them.yetToPlay}` })
  }
  if (bug.you.projected != null && bug.them.projected != null) {
    stats.push({ key: 'proj', label: 'Projected', value: `${bug.you.projected.toFixed(1)} – ${bug.them.projected.toFixed(1)}` })
  }
  if (bug.topScorer) stats.push({ key: 'top', label: 'Your top scorer', value: `${bug.topScorer.name} · ${bug.topScorer.points.toFixed(1)}` })

  return (
    <section className="rdh-card rdh-bug" aria-label="This week's matchup" data-testid="redraft-score-bug" data-status={bug.status}>
      <div className="rdh-card-head">
        <h2 className="rdh-label">This week · Week {bug.week}</h2>
        <span className="rdh-bug-status" data-status={bug.status}>
          <span aria-hidden className="rdh-bug-dot" />
          {STATUS_LABEL[bug.status]}
        </span>
      </div>
      <div className="rdh-bug-board">
        <div className="rdh-bug-side">
          <span className="rdh-bug-team">{bug.you.name}</span>
          <span className="rdh-bug-meta">You{bug.you.record ? ` · ${bug.you.record}` : ''}</span>
          <strong className="rdh-bug-score" data-testid="redraft-score-bug-you">{bug.you.points.toFixed(1)}</strong>
        </div>
        <div className="rdh-bug-mid">
          {bug.winChance != null ? (
            <>
              <span className="rdh-bug-mid-label">Win chance</span>
              <strong className="rdh-bug-odds" data-testid="redraft-score-bug-odds">{bug.winChance}%</strong>
              <span className="rdh-bug-mid-note">projection estimate</span>
            </>
          ) : (
            <span className="rdh-bug-vs" aria-hidden>vs</span>
          )}
        </div>
        <div className="rdh-bug-side rdh-bug-them">
          <span className="rdh-bug-team">{bug.them.name}</span>
          <span className="rdh-bug-meta">{bug.them.record ?? 'Opponent'}</span>
          <strong className="rdh-bug-score" data-testid="redraft-score-bug-them">{bug.them.points.toFixed(1)}</strong>
        </div>
      </div>
      <p className="rdh-bug-headline" data-testid="redraft-score-bug-headline">
        {bug.headline}
        {/* Daily sports: the week is a scoring period whose lineups lock game by game. */}
        {daily ? <span className="rdh-bug-period"> · Daily lineups this week</span> : null}
      </p>
      {stats.length ? (
        <dl className="rdh-bug-stats">
          {stats.map((s) => (
            <div key={s.key}>
              <dt>{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {onOpen ? (
        <div className="rdh-actions">
          <button type="button" className="nl-button nl-primary" onClick={onOpen} data-testid="redraft-score-bug-open">Open matchup</button>
        </div>
      ) : null}
    </section>
  )
}
