'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import { firstWeekGuideSteps, type FirstWeekGuideRules } from '@/lib/survivor/survivorFirstWeekGuide'

const storageKey = (leagueId: string) => `af:survivor-first-week-guide:${leagueId}`

function readDismissed(leagueId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(leagueId)) === '1'
  } catch {
    return false
  }
}

/**
 * "How Survivor works", on the league home through the first week of play. The first-visit intro
 * covers the basics once; this stays until the player closes it and adds what the intro leaves out:
 * how the vote works, how to get back from Exile, and what the merge, jury and finale mean here.
 */
export function SurvivorFirstWeekGuide({ leagueId, rules }: { leagueId: string; rules: FirstWeekGuideRules }) {
  // Hidden until mounted so a guide the player already closed never flashes on load.
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(!readDismissed(leagueId)), [leagueId])
  if (!open) return null

  const dismiss = () => {
    try {
      window.localStorage.setItem(storageKey(leagueId), '1')
    } catch {
      // Storage blocked: the guide closes for this visit only.
    }
    setOpen(false)
  }

  const id = encodeURIComponent(leagueId)
  return <section className="svh-card svh-pad svh-guide" data-testid="survivor-first-week-guide" aria-labelledby="svh-guide-title">
    <div className="svh-row">
      <span id="svh-guide-title" className="svh-lbl svh-grow">How Survivor works · your first week</span>
      <button type="button" className="svh-guide-close" onClick={dismiss} aria-label="Close the guide" data-testid="survivor-first-week-guide-close"><X size={16} aria-hidden /></button>
    </div>
    <ol className="svh-steps">
      {firstWeekGuideSteps(rules).map(step => <li key={step.id} data-testid={`survivor-guide-${step.id}`}>
        <strong>{step.title}</strong>
        <span>{step.body}</span>
      </li>)}
    </ol>
    <div className="svh-guide-links">
      <Link className="svh-link" href={`/survivor/${id}/rules`}>Full rules</Link>
      <Link className="svh-link" href={`/survivor/${id}/chimmy`}>Ask Chimmy</Link>
      <button type="button" className="svh-link svh-guide-done" onClick={dismiss}>Got it</button>
    </div>
  </section>
}
