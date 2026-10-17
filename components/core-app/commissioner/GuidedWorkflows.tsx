'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { HubLink, Workflow } from '@/lib/core-app/commissioner/areas'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { hubCopy } from '@/lib/core-app/commissionerHubCopy'

/**
 * Step-by-step guides (brief item 4): replace a manager, change a rule,
 * schedule a draft, resolve a dispute.
 *
 * The steps and every link in them are resolved on the server, including
 * whether this league's platform is where the change really happens. The only
 * client state is which guide is open and which step is showing — nothing here
 * decides what a commissioner may do.
 */

function StepLink({ link, language }: { link: HubLink; language: string }) {
  const label = hubCopy(link.label, language)
  if (link.external) {
    return (
      <a className="af-btn af-ch-step-link" href={link.href} target="_blank" rel="noopener noreferrer">
        {label} ↗
      </a>
    )
  }
  if (link.href.startsWith('#')) {
    return (
      <a className="af-btn af-ch-step-link" href={link.href}>
        {label}
      </a>
    )
  }
  return (
    <Link className="af-btn af-ch-step-link" href={link.href}>
      {label}
    </Link>
  )
}

export function GuidedWorkflows({ workflows }: { workflows: Workflow[] }) {
  const { language } = useOptionalLanguage()
  const t = (english: string | null | undefined) => hubCopy(english, language)
  const [openKey, setOpenKey] = useState<Workflow['key']>(workflows[0]?.key ?? 'replace-manager')
  const [stepByKey, setStepByKey] = useState<Record<string, number>>({})

  /*
   * Task cards and health flags link to `#workflow-<key>`. The anchor scrolls to
   * the tab; this opens it, so "Replace a manager" lands on that guide rather
   * than on whichever one was open.
   */
  useEffect(() => {
    const open = () => {
      const m = /^#workflow-(.+)$/.exec(window.location.hash)
      const hit = m ? workflows.find((w) => w.key === m[1]) : undefined
      if (hit) setOpenKey(hit.key)
    }
    open()
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [workflows])

  const wf = workflows.find((w) => w.key === openKey) ?? workflows[0]
  if (!wf) return null
  const step = Math.min(stepByKey[wf.key] ?? 0, wf.steps.length - 1)
  const setStep = (n: number) => setStepByKey((prev) => ({ ...prev, [wf.key]: n }))
  const current = wf.steps[step]

  return (
    <div className="af-ch-guides">
      <div className="af-ch-guide-tabs" role="tablist" aria-label={t('Guides')}>
        {workflows.map((w) => (
          <button
            key={w.key}
            id={`workflow-${w.key}`}
            type="button"
            role="tab"
            aria-selected={w.key === wf.key}
            aria-controls="ch-guide-panel"
            className="af-ch-guide-tab"
            onClick={() => setOpenKey(w.key)}
          >
            {t(w.title)}
          </button>
        ))}
      </div>

      <div id="ch-guide-panel" role="tabpanel" aria-labelledby={`workflow-${wf.key}`} className="af-ch-guide">
        <p className="af-ch-guide-summary">{t(wf.summary)}</p>
        {wf.authorityNote ? <p className="af-ch-guide-authority">{t(wf.authorityNote)}</p> : null}

        <ol className="af-ch-guide-steps" aria-label={`${t(wf.title)} · ${t('steps')}`}>
          {wf.steps.map((s, i) => (
            <li key={s.title} data-state={i < step ? 'done' : i === step ? 'current' : 'todo'}>
              <button
                type="button"
                className="af-ch-guide-step"
                aria-current={i === step ? 'step' : undefined}
                onClick={() => setStep(i)}
              >
                <span className="af-ch-guide-num af-num" aria-hidden>
                  {i < step ? '✓' : i + 1}
                </span>
                <span>{t(s.title)}</span>
              </button>
            </li>
          ))}
        </ol>

        <div className="af-ch-guide-detail" aria-live="polite">
          <p className="af-label">
            {t(`Step ${step + 1} of ${wf.steps.length}`)}
          </p>
          <p className="af-ch-guide-title">{t(current.title)}</p>
          <p className="af-ch-guide-body">{t(current.body)}</p>
          <div className="af-ch-guide-actions">
            {current.link ? <StepLink link={current.link} language={language} /> : null}
            <span className="af-ch-guide-spacer" />
            <button type="button" className="af-btn af-ch-guide-nav" disabled={step === 0} onClick={() => setStep(step - 1)}>
              {t('Back')}
            </button>
            {step < wf.steps.length - 1 ? (
              <button type="button" className="af-btn af-ch-guide-nav" data-primary="true" onClick={() => setStep(step + 1)}>
                {t('Next step')}
              </button>
            ) : (
              <button type="button" className="af-btn af-ch-guide-nav" onClick={() => setStep(0)}>
                {t('Start over')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
