'use client'

import Link from 'next/link'
import { availableImportPlatformsPhrase } from '@/lib/league-import/provider-ui-config'
import { useEffect, useState } from 'react'
import { useHomePromptTurn } from '@/components/core-app/HomePromptSlot'
import { useMessages } from '@/components/i18n/useMessages'
import { coreWelcomeTourMessages } from '@/lib/core-app/messages/coreWelcomeTour'
import '@/components/core-app/core-welcome-tour.css'

const STORAGE_KEY = 'af-core-welcome-v1'

/*
 * ⚠ THE LAST STEP USED TO SEND EVERY NEW USER TO /core/hubs — the multi-format commissioner hubs
 * (Zombie, Guillotine, C2C…), a screen most managers never need. It now goes where the step's own
 * copy points: the lineup check when there are leagues, the import when there are none. Step 1 told
 * people to "Open Leagues", a label nothing on screen carries; it names the league switcher instead,
 * and the finish button no longer says "Core", which is our name for the app, not theirs.
 *
 * Shown on the home screen only (AfCoreShell) — opening it over a lineup or a trade interrupted the
 * very task it was introducing.
 */

type Step = {
  kicker: string
  title: string
  body: string
  action?: { label: string; href: string }
}

export function CoreWelcomeTour({ leagueCount }: { leagueCount: number }) {
  const m = useMessages(coreWelcomeTourMessages)
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
      kicker: m.connectKicker,
      title: leagueCount > 0 ? m.connectTitleReady(leagueCount) : m.connectTitleEmpty,
      body: leagueCount > 0
        ? m.connectBodyReady
        : m.connectBodyEmpty(availableImportPlatformsPhrase()),
      action: leagueCount > 0 ? undefined : { label: m.connectAction, href: '/import' },
    },
    {
      kicker: m.chooseKicker,
      title: m.chooseTitle,
      body: m.chooseBody,
    },
    {
      kicker: m.askKicker,
      title: m.askTitle,
      body: m.askBody,
    },
    {
      kicker: m.playKicker,
      title: m.playTitle,
      body: m.playBody,
      action: leagueCount > 0
        ? { label: m.playActionReady, href: '/core/my-team' }
        : { label: m.connectAction, href: '/import' },
    },
  ]

  // One optional prompt at a time on the /core home (HomePromptSlot).
  const turn = useHomePromptTurn('welcome-tour', open)
  if (!turn) return null
  const current = steps[step]

  function finish() {
    try { window.localStorage.setItem(STORAGE_KEY, 'done') } catch {}
    setOpen(false)
  }

  return (
    <section className="af-welcome" aria-labelledby="af-welcome-title">
      <div
        className="af-welcome-progress"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={step + 1}
        aria-label={m.progress(step + 1, steps.length)}
      >
        {steps.map((_, index) => <i key={index} data-active={index <= step} />)}
      </div>
      <button type="button" className="af-welcome-close" aria-label={m.dismiss} onClick={finish}>×</button>
      <span className="af-welcome-kicker">{current.kicker}</span>
      <h2 id="af-welcome-title">{current.title}</h2>
      <p>{current.body}</p>
      <div className="af-welcome-actions">
        {current.action ? <Link href={current.action.href} onClick={finish}>{current.action.label}</Link> : null}
        {step > 0 ? <button type="button" onClick={() => setStep((value) => value - 1)}>{m.back}</button> : null}
        {step < steps.length - 1 ? (
          <button type="button" className="af-welcome-next" onClick={() => setStep((value) => value + 1)}>{m.next}</button>
        ) : (
          <button type="button" className="af-welcome-next" onClick={finish}>{m.start}</button>
        )}
      </div>
    </section>
  )
}
