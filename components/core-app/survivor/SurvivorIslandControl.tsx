'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { survivorIslandControlMessages } from '@/lib/core-app/messages/survivorIslandControl'
import { islandHealth, islandTodo, type HealthDetail, type IslandControlFacts, type TorchState } from '@/lib/core-app/survivorIslandControl'
import { SurvivorRulebook } from './SurvivorRulebook'
import { SurvivorRulesEditor, SurvivorScenePicker, useIslandSettings } from './SurvivorIslandSettings'

/**
 * Island control: the top of a Survivor league's Commissioner screen. League health as a row of
 * torches, then the weekly to-do (usually "nothing needed": Chimmy runs the island). Reads the
 * Survivor commissioner dashboard, which refuses anyone who does not run the league, so this panel
 * simply renders nothing for them, and nothing while it loads or if the read fails. The full
 * commissioner hub below it is unchanged.
 *
 * Below the rulebook: an inline editor for the rulebook's safe fields and the banner scene picker,
 * both saved through the Survivor settings screen's own endpoint (see SurvivorIslandSettings), so
 * they appear only for someone with settings rights. A save re-reads the dashboard, so the rulebook
 * shows the new rules.
 */
export function SurvivorIslandControl({ leagueId }: { leagueId: string }) {
  const m = useMessages(survivorIslandControlMessages)
  const [facts, setFacts] = useState<IslandControlFacts | null>(null)
  const [reads, setReads] = useState(0)
  const reload = useCallback(() => setReads((n) => n + 1), [])
  const settings = useIslandSettings(leagueId, reload)

  useEffect(() => {
    let live = true
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/commissioner-dashboard`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d && d.ok !== false) setFacts(d) })
      .catch(() => {})
    return () => { live = false }
  }, [leagueId, reads])

  if (!facts) return null
  const torches = islandHealth(facts)
  const todo = islandTodo(facts)
  const actions = todo.filter((t) => t.tone === 'action').length
  const detail = (d: HealthDetail): string => {
    switch (d.key) {
      case 'draftPicks': return m.draftPicks(d.n, d.of)
      case 'seats': return m.seats(d.n, d.of)
      case 'claimed': return m.claimed(d.n)
      case 'setupIssues': return m.setupIssues(d.n)
      case 'channels': return m.channels(d.n)
      default: return m[d.key]
    }
  }

  return (
    <div className="sv-control" data-testid="survivor-island-control">
      <section className="sv-panel" aria-label={m.health}>
        <div className="sv-panel-h">
          <span className="sv-eyebrow">{m.health}</span>
          <span className="sv-note">{m.lit(torches.filter((t) => t.state === 'lit').length, torches.length)}</span>
        </div>
        <div className="sv-health">
          {torches.map((t) => (
            <div key={t.id} className="sv-hc" data-state={t.state}>
              <Torch state={t.state} />
              <strong>{m[t.id]}</strong>
              <small>{detail(t.detail)}</small>
            </div>
          ))}
        </div>
      </section>
      <section className="sv-panel" aria-label={m.needsYou}>
        <div className="sv-panel-h">
          <span className="sv-eyebrow">{m.needsYou}</span>
          <Link className="sv-link" href={`/survivor/${encodeURIComponent(leagueId)}/commissioner`}>{m.fullControls} →</Link>
        </div>
        {todo.length === 0 ? <p className="sv-note sv-clear">{m.allClear}</p> : null}
        <div className="sv-issues">
          {todo.map((t) => (
            <div key={t.id} className="sv-issue" data-tone={t.tone}>
              <i aria-hidden="true" />
              <div>
                <span className="sv-issue-tag">{t.tone === 'action' ? m.needsYou : m.headsUp}</span>
                <strong>{t.title}</strong>
                <small>{t.body}</small>
              </div>
              <Link className={`sv-btn${t.tone === 'action' ? ' sv-btn-primary' : ''}`} href={t.href}>{t.cta}</Link>
            </div>
          ))}
        </div>
        {actions > 0 ? <span className="sv-sr">{m.open(actions)}</span> : null}
      </section>
      <SurvivorRulebook config={facts.config} editHref={`/survivor/${encodeURIComponent(leagueId)}/settings`} />
      {settings.state ? <SurvivorRulesEditor state={settings.state} save={settings.save} settingsHref={`/survivor/${encodeURIComponent(leagueId)}/settings`} /> : null}
      {settings.state ? <SurvivorScenePicker state={settings.state} save={settings.save} /> : null}
    </div>
  )
}

/** A bamboo torch: burning, guttering, or out with a wisp of smoke. */
export function Torch({ state }: { state: TorchState }) {
  return (
    <svg className="sv-torch" viewBox="0 0 30 64" width="30" height="64" aria-hidden="true">
      {state === 'lit' ? (
        <>
          <circle cx="15" cy="14" r="14" fill="#f2862b" opacity=".18" />
          <path className="sv-flame" d="M15 22 C6 18 8 8 15 0 C22 8 24 18 15 22Z" fill="#f2862b" />
          <path className="sv-flame sv-flame-2" d="M15 21 C11 18 12 12 15 7 C18 12 19 18 15 21Z" fill="#ffd47a" />
        </>
      ) : state === 'low' ? (
        <path className="sv-flame" d="M15 22 C11 20 12 15 15 11 C18 15 19 20 15 22Z" fill="#c9852b" />
      ) : (
        <path d="M15 20 q5 -8 -1 -18 q8 8 1 18" stroke="#6b6f7b" strokeWidth="1.5" fill="none" />
      )}
      <path d="M8 24 h14 l-2 -4 h-10Z" fill="#6b4422" />
      <rect x="12.5" y="24" width="5" height="40" fill="#3b2412" />
      <rect x="12" y="36" width="6" height="1.6" fill="#1a0f07" />
      <rect x="12" y="48" width="6" height="1.6" fill="#1a0f07" />
    </svg>
  )
}
