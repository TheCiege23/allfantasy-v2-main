'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, CircleAlert, Clock } from 'lucide-react'
import type { SurvivorCommissionerDashboardResult } from '@/lib/survivor/buildSurvivorCommissionerDashboard'
import { survivorCommissionerChecklist, withoutSeatIssues, type SurvivorChecklistItem } from '@/lib/survivor/survivorCommissionerChecklist'
import { SurvivorCommissionerTodoCard } from './SurvivorCommissionerTodoCard'

type Dashboard = Extract<SurvivorCommissionerDashboardResult, { ok: true }>

const ICON = { done: CheckCircle2, todo: CircleAlert, waiting: Clock }

/**
 * The commissioner's Survivor checklist on the league home: before the draft, the things that must be
 * true for the season to run itself; once it is running, this week's to-do list when something needs
 * them. Reads the commissioner dashboard the hub already uses, so the two never disagree.
 */
export function SurvivorCommissionerChecklist({ leagueId, draftScheduled, inSeason }: { leagueId: string; draftScheduled: boolean; inSeason: boolean }) {
  const [data, setData] = useState<Dashboard | null>(null)
  useEffect(() => {
    let live = true
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/commissioner-dashboard`, { cache: 'no-store', credentials: 'include' })
      .then(res => (res.ok ? res.json() : null))
      .then((body: Dashboard | null) => { if (live && body?.ok) setData(body) })
      .catch(() => {})
    return () => { live = false }
  }, [leagueId])
  if (!data) return null

  if (inSeason) {
    // In season the hub's to-do list is the checklist; only show it here when it asks for something.
    return data.todo.actionCount > 0 ? <div className="svh-card svh-pad" data-testid="survivor-home-commissioner-todo"><SurvivorCommissionerTodoCard todo={data.todo} /></div> : null
  }

  const items = survivorCommissionerChecklist({
    leagueSize: data.league.leagueSize,
    claimedManagers: data.operations.claimedManagers,
    draftScheduled,
    draftStatus: data.operations.draft?.status ?? null,
    tribesDrawn: data.tribes.filter(tribe => tribe.members.length > 0).length,
    exileEnabled: Boolean(data.config?.exileReturnEnabled),
    exileLinked: data.shell.exileLeagueLinked,
    idolCount: data.config?.idolCount ?? 0,
    setupIssues: withoutSeatIssues(data.operations.readinessIssues),
  })
  const left = items.filter(item => item.state === 'todo').length
  return <section className="svh-card svh-pad svh-checklist" data-testid="survivor-commissioner-checklist" aria-labelledby="svh-checklist-title">
    <div className="svh-row">
      <span id="svh-checklist-title" className="svh-lbl svh-grow">Survivor checklist · commissioner</span>
      <span className="svh-faint svh-sm" data-testid="survivor-checklist-status">{left === 0 ? 'Ready to run itself' : `${left} to do`}</span>
    </div>
    <ul>{items.map((item: SurvivorChecklistItem) => {
      const Icon = ICON[item.state]
      return <li key={item.id} data-state={item.state} data-testid={`survivor-checklist-${item.id}`}>
        <Icon size={16} aria-hidden />
        <div><strong>{item.label}</strong><span className="svh-sub svh-sm">{item.detail}</span></div>
      </li>
    })}</ul>
    <Link className="svh-link" href={`/survivor/${encodeURIComponent(leagueId)}/commissioner`}>Open the commissioner hub</Link>
  </section>
}
