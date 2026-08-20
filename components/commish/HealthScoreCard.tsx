'use client'

/**
 * 11b — the league health score card, its flagged signals and its interventions.
 *
 * ⚠ THE SCORE NEVER RENDERS WITHOUT ITS CONFIDENCE AND SAMPLE SIZE. Handoff
 * build rule 1, and the reason the props below make `confidencePct`,
 * `teamCount` and `currentWeek` part of the same object as the score rather
 * than optional extras: this is a computed signal, not a platform fact like a
 * win-loss record, and a bare `58` reads as the second thing.
 *
 * ⚠ A STALE LEAGUE SHOWS NO SCORE AT ALL. Not a greyed-out number, not last
 * week's — `tone="none"` and an em dash. Same rule 11a applies to a failed sync:
 * "we don't know" and "it's bad" are different claims and only one of them is
 * true. `dataConfidence: 'low'` from the snapshot builder is what triggers it,
 * which is the same signal that means "we have never successfully synced this
 * league".
 *
 * ⚠ THE FLAGGED LIST INCLUDES THE GOOD NEWS WHEN THERE IS ANY. Build rule 2.
 * `strengths` are rendered in the same list as `problems`, in the same shape,
 * with a `good` icon — a commissioner who only ever sees a list of failures
 * learns to close the page.
 */

export type HealthTone = 'good' | 'warn' | 'bad' | 'none'

export type HealthScoreCardProps = {
  score: number | null
  status: string
  trend: string
  engagement: number | null
  fairness: number | null
  sustainability: number | null
  confidencePct: number | null
  teamCount: number | null
  currentWeek: number | null
  totalWeeks: number | null
  /** Reason the score is withheld. Rendered verbatim in place of the number. */
  unavailableReason?: string | null
}

export type FlaggedSignal = { tone: HealthTone; text: string }

export type Intervention = {
  text: string
  ctaLabel: string
  href?: string
  onClick?: () => void
  primary?: boolean
}

function toneForScore(n: number | null): HealthTone {
  if (n == null || !Number.isFinite(n)) return 'none'
  if (n >= 75) return 'good'
  if (n >= 50) return 'warn'
  return 'bad'
}

function trendDirection(trend: string): 'up' | 'down' | 'flat' {
  const t = trend.trim().toLowerCase()
  if (t.includes('improv') || t.includes('up') || t.includes('rising')) return 'up'
  if (t.includes('declin') || t.includes('down') || t.includes('falling')) return 'down'
  return 'flat'
}

function SubScore({ name, value }: { name: string; value: number | null }) {
  const tone = toneForScore(value)
  return (
    <div className="af-cm-subscore">
      <span className="af-cm-subscore-name">{name}</span>
      <span className="af-cm-subscore-track">
        {/*
          The bar is drawn only from a real number. A zero-width fill for a null
          score would read as "scored zero", which is the opposite of "not scored".
        */}
        {value != null ? (
          <span
            className="af-cm-subscore-fill"
            data-tone={tone}
            style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
          />
        ) : null}
      </span>
      <span className="af-cm-subscore-val af-num">{value != null ? Math.round(value) : '—'}</span>
    </div>
  )
}

export function HealthScoreCard(props: HealthScoreCardProps) {
  const {
    score,
    status,
    trend,
    engagement,
    fairness,
    sustainability,
    confidencePct,
    teamCount,
    currentWeek,
    totalWeeks,
    unavailableReason,
  } = props

  const available = score != null && Number.isFinite(score) && !unavailableReason
  const tone = available ? toneForScore(score) : 'none'
  const dir = trendDirection(trend)

  /*
   * Built by clause so a missing piece drops out instead of rendering
   * "Confidence undefined% · null teams". Every fragment here is a real read
   * from the snapshot; none of them is defaulted to a plausible number.
   */
  const footnote = (() => {
    const parts: string[] = []
    if (confidencePct != null && Number.isFinite(confidencePct)) parts.push(`Confidence ${Math.round(confidencePct)}%`)
    const sample: string[] = []
    if (teamCount != null && teamCount > 0) sample.push(`${teamCount} team${teamCount === 1 ? '' : 's'}`)
    if (currentWeek != null && currentWeek > 0) {
      sample.push(totalWeeks != null && totalWeeks > 0 ? `week ${currentWeek} of ${totalWeeks}` : `week ${currentWeek}`)
    }
    if (sample.length > 0) parts.push(sample.join(', '))
    return parts.length > 0 ? `${parts.join(' · ')}.` : null
  })()

  return (
    <div className="af-cm-score" data-tone={tone} data-testid="health-score-card">
      <div className="af-cm-tile-label">
        League health
        <button
          type="button"
          className="af-cm-help"
          title="A 0–100 composite of engagement, fairness and sustainability, computed from your league's own activity. It is a signal, not a platform statistic — read it alongside the confidence figure."
          aria-label="How the health score is computed"
        >
          ?
        </button>
      </div>

      {available ? (
        <>
          <div className="af-cm-score-big">
            <span className="af-cm-score-num">{Math.round(score)}</span>
            <span className="af-cm-score-den af-num">/ 100</span>
          </div>
          <div className="af-cm-score-tags">
            <span className="af-cm-status af-num" data-tone={tone}>
              {status.replace(/_/g, ' ')}
            </span>
            <span className="af-cm-trendword af-num" data-dir={dir}>
              {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■'} {trend.replace(/_/g, ' ')}
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="af-cm-score-big">
            <span className="af-cm-score-num">—</span>
          </div>
          <div className="af-cm-score-tags">
            <span className="af-cm-status af-num" data-tone="none">
              No score
            </span>
          </div>
          <p className="af-cm-confidence" style={{ marginTop: 12 }}>
            {unavailableReason ??
              'This league has not synced successfully, so no score is shown rather than a guessed one.'}
          </p>
        </>
      )}

      {available ? (
        <>
          <div className="af-cm-subscores">
            <SubScore name="Engagement" value={engagement} />
            <SubScore name="Fairness" value={fairness} />
            <SubScore name="Sustainability" value={sustainability} />
          </div>
          {/* Not optional chrome. See the header note. */}
          {footnote ? <p className="af-cm-confidence">{footnote}</p> : null}
        </>
      ) : null}
    </div>
  )
}

export function FlaggedSignals({
  signals,
  interventions,
}: {
  signals: FlaggedSignal[]
  interventions: Intervention[]
}) {
  return (
    <div className="af-card" style={{ padding: 18 }} data-testid="health-flagged">
      <div className="af-label" style={{ marginBottom: 14 }}>
        What the engine flagged
      </div>

      {signals.length === 0 ? (
        <p className="af-cm-sub">Nothing flagged this week.</p>
      ) : (
        <ul className="af-cm-flags">
          {signals.map((s, i) => (
            <li key={i} className="af-cm-flag">
              <span className="af-cm-flag-icon" data-tone={s.tone === 'none' ? undefined : s.tone} aria-hidden>
                {s.tone === 'good' ? '✓' : s.tone === 'bad' ? '!' : s.tone === 'warn' ? '!' : '◷'}
              </span>
              <span>{s.text}</span>
            </li>
          ))}
        </ul>
      )}

      {interventions.length > 0 ? (
        <div className="af-cm-interventions">
          <div className="af-label">Recommended interventions</div>
          {/*
            ⚠ ONE RECOMMENDATION, ONE BUTTON THAT PERFORMS IT. Build rule 3. A
            recommendation with no CTA is a to-do list, which is the thing this
            screen replaces — so an intervention with neither `href` nor
            `onClick` is not rendered at all rather than rendered inert.
          */}
          {interventions
            .filter((it) => it.href || it.onClick)
            .map((it, i) => (
              <div key={i} className="af-cm-intervention">
                <span className="af-cm-intervention-text">{it.text}</span>
                {it.href ? (
                  <a className={`af-btn ${it.primary ? '' : 'af-btn--ghost'}`} href={it.href}>
                    {it.ctaLabel}
                  </a>
                ) : (
                  <button type="button" className={`af-btn ${it.primary ? '' : 'af-btn--ghost'}`} onClick={it.onClick}>
                    {it.ctaLabel}
                  </button>
                )}
              </div>
            ))}
        </div>
      ) : null}
    </div>
  )
}

export default HealthScoreCard
