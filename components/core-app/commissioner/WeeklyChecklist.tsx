'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { ChecklistItem, ChecklistStatus } from '@/lib/commissioner/weeklyChecklist'
import { commissionerScreensMessages } from '@/lib/core-app/messages/commissionerScreens'
import { coreLang } from '@/lib/core-app/messages/coreLocale'
import { messagesFor } from '@/lib/i18n/messages'

type View = { applies: false } | { applies: true; week: number; items: ChecklistItem[] }

const MARK: Record<ChecklistStatus, string> = { done: '✓', todo: '!', heads_up: '→' }

/**
 * This week's commissioner checklist (lib/commissioner/weeklyChecklist), at the top of the
 * Commissioner Hub. Redraft leagues only: for any other league the route answers `applies: false`
 * and this renders nothing, so the hub is unchanged there.
 */
export function WeeklyChecklist({ leagueId, language = 'en' }: { leagueId: string; language?: string }) {
  const m = messagesFor(commissionerScreensMessages, language)
  const pick = coreLang(language)
  const [view, setView] = useState<View | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/weekly-checklist`, { cache: 'no-store' })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as View | null
        if (!live) return
        if (!res.ok || !data) setFailed(true)
        else setView(data)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [leagueId])

  if (failed || (view && !view.applies)) return null
  const items = view?.applies ? view.items : []
  const todo = items.filter((i) => i.status === 'todo').length

  return (
    <section id="ch-week" className="af-card af-ch-section af-ch-week" aria-labelledby="ch-week-h" data-testid="weekly-checklist">
      <header className="af-ch-section-head">
        <h2 id="ch-week-h" className="af-label">
          {view?.applies ? m.checklistTitleWeek(view.week) : m.checklistTitle}
        </h2>
        {view?.applies ? (
          <span className="af-ch-section-note">
            {todo ? m.checklistToDo(todo) : m.checklistAllCaughtUp}
          </span>
        ) : null}
      </header>
      {!view ? (
        <p className="af-ch-week-loading" role="status">{m.checklistLoading}</p>
      ) : (
        <ul className="af-ch-week-list">
          {items.map((item) => (
            <li key={item.id} className="af-ch-week-item" data-status={item.status} data-testid="weekly-checklist-item">
              <span className="af-ch-week-mark" aria-hidden>{MARK[item.status]}</span>
              <span className="af-ch-week-text">
                <Link href={item.href} className="af-ch-week-title">{item.title[pick]}</Link>
                <span className="af-ch-week-detail">{item.detail[pick]}</span>
              </span>
              <span className="af-ch-week-sr">
                {item.status === 'done' ? m.checklistDone : item.status === 'todo' ? m.checklistNeedsYou : m.checklistHeadsUp}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
