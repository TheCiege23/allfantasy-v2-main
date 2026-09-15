'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import '@/components/core-app/core-welcome-tour.css'

const STORAGE_KEY = 'af-core-welcome-v1'

type Step = {
  kicker: string
  title: string
  body: string
  action?: { label: string; href: string }
}

export function CoreWelcomeTour({ leagueCount }: { leagueCount: number }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(STORAGE_KEY) !== 'done')
    } catch {
      // Private browsing can deny storage. Showing the guide once in this mount
      // is still more useful than withholding it completely.
      setOpen(true)
    }
  }, [])

  const steps: Step[] = [
    {
      kicker: '1 · Connect',
      title: leagueCount > 0 ? `${leagueCount} ${leagueCount === 1 ? 'league is' : 'leagues are'} connected` : 'Bring your leagues together',
      body: leagueCount > 0
        ? 'Use the Leagues rail to move between them. Core keeps an all-leagues view until you choose one.'
        : 'Import from Sleeper, ESPN, Yahoo, Fantrax, MFL or another supported source. AllFantasy reads the league and leaves the original platform unchanged.',
      action: leagueCount > 0 ? undefined : { label: 'Import a league', href: '/import' },
    },
    {
      kicker: '2 · Choose scope',
      title: 'All leagues or one league',
      body: 'Core shows your full portfolio. Choose a league and every tab keeps that league selected, including trades, rankings, standings and projections.',
    },
    {
      kicker: '3 · Decide',
      title: 'Use Chimmy with the right evidence',
      body: 'Ask from a league to use its scoring, roster, schedule and imported transactions. Ask from Core to compare exposure and priorities across every connected league.',
    },
    {
      kicker: '4 · Operate',
      title: 'Run the week from one place',
      body: 'Sync changes, review lineup and waiver issues, open trade receipts, and use Commissioner OS when you run the league.',
      action: { label: 'Open the league hub', href: '/core/hubs' },
    },
  ]

  if (!open) return null
  const current = steps[step]

  function finish() {
    try { window.localStorage.setItem(STORAGE_KEY, 'done') } catch {}
    setOpen(false)
  }

  return (
    <aside className="af-welcome" role="dialog" aria-modal="false" aria-labelledby="af-welcome-title">
      <div className="af-welcome-progress" aria-label={`Step ${step + 1} of ${steps.length}`}>
        {steps.map((_, index) => <i key={index} data-active={index <= step} />)}
      </div>
      <button type="button" className="af-welcome-close" aria-label="Dismiss welcome guide" onClick={finish}>×</button>
      <span className="af-welcome-kicker">{current.kicker}</span>
      <h2 id="af-welcome-title">{current.title}</h2>
      <p>{current.body}</p>
      <div className="af-welcome-actions">
        {current.action ? <Link href={current.action.href} onClick={finish}>{current.action.label}</Link> : null}
        {step > 0 ? <button type="button" onClick={() => setStep((value) => value - 1)}>Back</button> : null}
        {step < steps.length - 1 ? (
          <button type="button" className="af-welcome-next" onClick={() => setStep((value) => value + 1)}>Next</button>
        ) : (
          <button type="button" className="af-welcome-next" onClick={finish}>Start using Core</button>
        )}
      </div>
    </aside>
  )
}
