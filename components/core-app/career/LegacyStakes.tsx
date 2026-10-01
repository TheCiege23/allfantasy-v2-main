'use client'

import type { LegacyStakesData, Milestone } from '@/lib/core-app/careerMilestones'
import { askChimmyAboutCareer } from './CareerAskChimmy'

/**
 * "In play this season" + "Within reach" — Career's forward-looking card.
 *
 * ⚠ EVERY STAKE IS A CONDITIONAL. The rows say what a title WOULD mean; nothing here is in
 * a total, and the footnote says so. See `lib/core-app/careerMilestones.ts`.
 */
export function LegacyStakes({
  data,
  leagueId,
  milestonesOnly = false,
}: {
  data: Pick<LegacyStakesData, 'stakes' | 'milestones' | 'season'>
  leagueId?: string
  /** One league's career has no "which league" question to answer — only its milestones. */
  milestonesOnly?: boolean
}) {
  const stakes = milestonesOnly ? [] : data.stakes
  if (stakes.length === 0 && data.milestones.length === 0) return null

  return (
    <section className="af-crl-card" aria-label="Legacy stakes">
      {stakes.length > 0 ? (
        <>
          <p className="af-crl-head">
            In play{data.season != null ? ` · ${data.season}` : ''}
            <span className="af-crl-sp" />
            <span className="af-crl-tag">IF YOU WIN</span>
          </p>
          <ul className="af-crl-list">
            {stakes.map((s) => (
              <li key={s.key} className="af-crl-row" data-tone={s.tone}>
                <span className="af-crl-glyph" aria-hidden>
                  {s.tone === 'streak' ? '◎' : '◉'}
                </span>
                <div className="af-crl-text">
                  <span className="af-crl-title">
                    {s.title}
                    <span className="af-crl-plat" data-platform={s.platform}>
                      {s.platform}
                    </span>
                  </span>
                  <span className="af-crl-detail">{s.detail}</span>
                </div>
                <AskButton ask={s.ask} label={s.title} leagueId={leagueId} />
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {data.milestones.length > 0 ? (
        <>
          <p className="af-crl-head">Within reach</p>
          <ul className="af-crl-list">
            {data.milestones.map((m) => (
              <MilestoneRow key={m.key} m={m} leagueId={leagueId} />
            ))}
          </ul>
        </>
      ) : null}

      <p className="af-crl-foot">
        {milestonesOnly
          ? 'Counted from games already played in this league.'
          : 'Totals count finished seasons only. Live seasons are shown here, never added to your record until they finish.'}
      </p>
    </section>
  )
}

function MilestoneRow({ m, leagueId }: { m: Milestone; leagueId?: string }) {
  return (
    <li className="af-crl-row">
      <div className="af-crl-text">
        <span className="af-crl-title">{m.title}</span>
        <span className="af-crl-track" aria-hidden>
          <i style={{ width: `${m.progressPct}%` }} />
        </span>
        <span className="af-crl-detail">{m.detail}</span>
      </div>
      <AskButton ask={m.ask} label={m.title} leagueId={leagueId} />
    </li>
  )
}

function AskButton({ ask, label, leagueId }: { ask: string; label: string; leagueId?: string }) {
  return (
    <button
      type="button"
      className="af-crl-askbtn"
      aria-label={`Ask Chimmy about ${label}`}
      title="Ask Chimmy"
      onClick={() => askChimmyAboutCareer(ask, leagueId)}
    >
      ✦
    </button>
  )
}
