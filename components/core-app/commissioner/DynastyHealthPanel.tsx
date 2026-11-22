'use client'

import { CheckCircle2, Circle, Clock3, Lock } from 'lucide-react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { CommissionerHubDynasty } from '@/lib/core-app/commissionerHub'
import type { RolloverStepState } from '@/lib/season-rollover/rolloverWizard'

/**
 * The dynasty half of the Commissioner Hub's health section (Dynasty Era style): each team's future
 * pick balance as bars, and the rollover wizard's steps as a checklist. The flags themselves —
 * pick balance, rookie draft order, taxi squads — are in the flag list above, so this draws only
 * what a list cannot.
 *
 * Real data only. Unmeasured pick balance draws no bars (the flag above says why); no rollover on
 * file draws no checklist. Strings: lib/i18n (commishHub.dynHealth.*, commishHub.rollover.dyn.*).
 */
const K = 'commishHub.dynHealth.'

const STEP_ICON: Record<RolloverStepState, typeof CheckCircle2> = {
  done: CheckCircle2,
  todo: Clock3,
  blocked: Lock,
  optional: Circle,
}

export function DynastyHealthPanel({ dynasty }: { dynasty: CommissionerHubDynasty }) {
  const { t, tInterpolate } = useOptionalLanguage()
  const tx = (key: string, vars?: Record<string, string | number>) => (vars ? tInterpolate(K + key, vars) : t(K + key))
  const { picks, rollover } = dynasty
  if (!picks.measured && !rollover) return null

  const max = picks.measured ? Math.max(1, ...picks.rows.map((r) => r.total)) : 1
  const nextSeason = picks.measured ? picks.seasons[0] : null

  return (
    <div className="af-ch-dyn-grid" data-testid="dynasty-health">
      {picks.measured ? (
        <section id="ch-dynasty-picks" className="af-ch-dyn-card" aria-labelledby="ch-dynasty-picks-h" data-testid="dynasty-pick-balance">
          <h3 id="ch-dynasty-picks-h" className="af-ch-dyn-eyebrow">
            {tx('panel.picksTitle', { n: picks.seasons.length })}
          </h3>
          <p className="af-ch-dyn-caption">
            {tx('panel.picksCaption', { seasons: picks.seasons.join(', '), avg: picks.average })}
          </p>
          <ul className="af-ch-dyn-bars">
            {picks.rows.map((row) => {
              const name = row.isViewer ? tx('panel.you') : row.teamName?.trim() || tx('panel.unnamed')
              const tone = row.isViewer ? 'you' : row.flag === 'none_next' ? 'low' : 'other'
              return (
                <li key={row.rosterId} className="af-ch-dyn-bar-row" data-tone={tone} data-flag={row.flag ?? undefined} data-testid="dynasty-pick-row">
                  <span className="af-ch-dyn-bar-name">{name}</span>
                  <span
                    className="af-ch-dyn-bar-track"
                    role="img"
                    aria-label={tx('panel.bar', { team: name, n: row.total })}
                  >
                    <span className="af-ch-dyn-bar-fill" style={{ width: `${Math.round((row.total / max) * 100)}%` }} />
                  </span>
                  <span className="af-ch-dyn-bar-count af-num">{row.total}</span>
                  {row.flag === 'none_next' && nextSeason != null ? (
                    <span className="af-ch-dyn-bar-tag" data-flag="none_next">{tx('panel.noneNext', { season: nextSeason })}</span>
                  ) : row.flag === 'heavy' ? (
                    <span className="af-ch-dyn-bar-tag" data-flag="heavy">{tx('panel.heavy')}</span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {rollover ? (
        <section className="af-ch-dyn-card" aria-labelledby="ch-dynasty-rollover-h" data-testid="dynasty-rollover-readiness">
          <h3 id="ch-dynasty-rollover-h" className="af-ch-dyn-eyebrow">
            {tx('panel.rolloverTitle', { next: rollover.nextSeason })}
          </h3>
          {!rollover.seasonOver && !rollover.started ? (
            <p className="af-ch-dyn-caption">{tx('panel.rolloverWaiting', { season: rollover.season })}</p>
          ) : rollover.started ? (
            <p className="af-ch-dyn-caption">{tx('panel.rolloverStarted', { next: rollover.nextSeason })}</p>
          ) : null}
          <ul className="af-ch-dyn-checklist">
            {rollover.steps.map((step) => {
              const Icon = STEP_ICON[step.state]
              return (
                <li key={step.key} data-state={step.state} data-testid={`dynasty-rollover-${step.key}`}>
                  <Icon size={18} aria-hidden className="af-ch-dyn-check-icon" />
                  <span>{t(`commishHub.rollover.dyn.step.${step.key}`)}</span>
                  <span className="af-ch-dyn-check-state">{t(`commishHub.rollover.dyn.state.${step.state}`)}</span>
                </li>
              )
            })}
          </ul>
          {rollover.wizardHref ? (
            <a className="af-ch-dyn-link" href={rollover.wizardHref}>
              {tx('order.action')}
            </a>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
