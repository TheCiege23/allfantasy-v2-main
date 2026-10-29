'use client'

import { useEffect, useState } from 'react'
import '../survivor-core.css'

/**
 * First-run explainer for creating a Survivor league (survivor-core §6, SurvivorOnboarding): the
 * five steps as a stepper card above the existing setup controls. Dismissal is a per-viewer
 * convenience in localStorage; with storage blocked it simply shows again.
 */
export const SURVIVOR_ONBOARDING_STEPS = [
  { title: 'Format', body: 'Survivor runs on top of a normal fantasy league.' },
  { title: 'Sport and size', body: 'Pick the sport and how many managers play.' },
  { title: 'Tribes', body: 'Tribes are drawn when the draft ends. Shuffle the crests first.' },
  { title: 'Twists', body: 'Hidden idols, Exile Island, a swap and the merge.' },
  { title: 'Invite', body: "Share the link. The draft can't start until the league is full." },
] as const

const KEY = 'af:survivor-how-it-works:dismissed'

export function SurvivorHowItWorks({ storageKey = KEY }: { storageKey?: string }) {
  const [hidden, setHidden] = useState(true)
  useEffect(() => {
    try { setHidden(window.localStorage.getItem(storageKey) === '1') } catch { setHidden(false) }
  }, [storageKey])
  if (hidden) return null
  return <section className="svk svk-card svo" style={{ minHeight: 0 }} aria-labelledby="svo-title" data-testid="survivor-how-it-works">
    <div className="svk-row">
      <h3 id="svo-title" className="svk-grow" style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>How a Survivor league comes together</h3>
      <button type="button" className="svk-btn" style={{ minHeight: 44, padding: '0 14px', fontSize: 13 }} onClick={() => {
        setHidden(true)
        try { window.localStorage.setItem(storageKey, '1') } catch { /* blocked storage: shows again next time */ }
      }}>Got it</button>
    </div>
    <ol className="svo-steps">
      {SURVIVOR_ONBOARDING_STEPS.map((step, i) => <li key={step.title}><i aria-hidden>{i + 1}</i><div><b>{step.title}</b><span>{step.body}</span></div></li>)}
    </ol>
  </section>
}
