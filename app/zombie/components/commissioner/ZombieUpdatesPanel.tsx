'use client'

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { SettingsSection, SettingsRow, Select, Input } from '@/app/league/[leagueId]/tabs/settings/components'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function ZombieUpdatesPanel({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const d = !canEdit
  const [day, setDay] = useState('1')
  const [hour, setHour] = useState('9')
  const [autoPost, setAutoPost] = useState(true)
  const [approval, setApproval] = useState(false)
  const [incProj, setIncProj] = useState(true)
  const [incMoney, setIncMoney] = useState(true)
  const [incInv, setIncInv] = useState(true)
  const [incUni, setIncUni] = useState(true)
  const [incDanger, setIncDanger] = useState(true)
  const [preview, setPreview] = useState('')
  const [week, setWeek] = useState('1')
  const [status, setStatus] = useState('')
  const [pendingCount, setPendingCount] = useState(0)
  const [tab, setTab] = useState<'settings' | 'preview' | 'history'>('settings')

  useEffect(() => {
    fetch(`/api/zombie/league?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { league?: Record<string, unknown> } | null) => {
        const l = d?.league
        if (!l) return
        if (typeof l.weeklyUpdateDay === 'number') setDay(String(l.weeklyUpdateDay))
        if (typeof l.weeklyUpdateHour === 'number') setHour(String(l.weeklyUpdateHour))
        if (typeof l.weeklyUpdateAutoPost === 'boolean') setAutoPost(l.weeklyUpdateAutoPost)
        if (typeof l.weeklyUpdateApproval === 'boolean') setApproval(l.weeklyUpdateApproval)
        if (typeof l.updateIncludeProjections === 'boolean') setIncProj(l.updateIncludeProjections)
        if (typeof l.updateIncludeMoney === 'boolean') setIncMoney(l.updateIncludeMoney)
        if (typeof l.updateIncludeInventory === 'boolean') setIncInv(l.updateIncludeInventory)
        if (typeof l.updateIncludeUniverse === 'boolean') setIncUni(l.updateIncludeUniverse)
        if (typeof l.updateIncludeDanger === 'boolean') setIncDanger(l.updateIncludeDanger)
        if (typeof l.currentWeek === 'number') setWeek(String(Math.max(1, l.currentWeek)))
      })
      .catch(() => null)
  }, [leagueId])

  async function save() {
    setStatus('Saving...')
    const r = await fetch('/api/zombie/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        leagueId,
        weeklyUpdateDay: parseInt(day, 10),
        weeklyUpdateHour: parseInt(hour, 10),
        weeklyUpdateAutoPost: autoPost,
        weeklyUpdateApproval: approval,
        updateIncludeProjections: incProj,
        updateIncludeMoney: incMoney,
        updateIncludeInventory: incInv,
        updateIncludeUniverse: incUni,
        updateIncludeDanger: incDanger,
      }),
    })
    setStatus(r.ok ? 'Saved' : 'Save failed')
    setTimeout(() => setStatus(''), 3000)
  }

  async function loadPreview() {
    setTab('preview')
    const w = parseInt(week, 10)
    setPreview('Loading...')
    const r = await fetch(
      `/api/zombie/weekly-update?leagueId=${encodeURIComponent(leagueId)}&week=${w}`,
      { credentials: 'include' },
    )
    if (!r.ok) {
      setPreview('Could not load preview (commissioner only).')
      return
    }
    const j = (await r.json()) as { draft?: Record<string, string> }
    const dr = j.draft
    if (!dr) {
      setPreview('No draft available for this week.')
      return
    }
    setPreview(
      [
        dr.header,
        dr.sectionWhisperer,
        dr.sectionZombies,
        dr.sectionSurvivors,
        dr.sectionMoney,
        dr.sectionBashingsMaulings,
        dr.sectionNewInfections,
        dr.sectionRevivals,
        dr.sectionInventory,
        dr.sectionDangerMatchups,
        dr.sectionUniverseMovement,
        dr.footer,
      ]
        .filter(Boolean)
        .join('\n\n'),
    )
  }

  async function approveAndPost() {
    const w = parseInt(week, 10)
    setStatus('Posting...')
    const r = await fetch('/api/zombie/weekly-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ leagueId, week: w }),
    })
    setStatus(r.ok ? 'Posted to league chat' : 'Post failed')
    setTimeout(() => setStatus(''), 3000)
  }

  const tabs: { id: 'settings' | 'preview' | 'history'; label: string }[] = [
    { id: 'settings', label: 'Schedule' },
    { id: 'preview', label: 'Preview & Post' },
    { id: 'history', label: 'Past Updates' },
  ]

  return (
    <div className="text-[13px] text-white/85">
      {/* Sub-tabs */}
      <div className="flex border-b border-white/10">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={clsx(
              'px-4 py-2.5 text-[12px] font-semibold transition-colors',
              tab === t.id
                ? 'border-b-2 border-sky-400 text-sky-200'
                : 'text-white/50 hover:text-white/70',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-6 py-5">
        {tab === 'settings' && (
          <div className="space-y-5">
            <SettingsSection id="zm-upd-sched" title="Weekly update schedule">
              <SettingsRow
                label="Update day"
                control={
                  <Select value={day} onChange={setDay} disabled={d}>
                    {DAY_NAMES.map((name, i) => (
                      <option key={i} value={String(i)}>{name}</option>
                    ))}
                  </Select>
                }
              />
              <SettingsRow
                label="Update hour (UTC)"
                control={
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={hour}
                    onChange={(e) => setHour(e.target.value)}
                    disabled={d}
                    className="w-24"
                  />
                }
              />
              <SettingsRow
                label="Auto-post after resolution"
                control={
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={autoPost}
                      onChange={(e) => setAutoPost(e.target.checked)}
                      disabled={d}
                      className="peer sr-only"
                    />
                    <div className="peer h-5 w-9 rounded-full bg-white/10 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white/60 after:transition-all peer-checked:bg-sky-500/50 peer-checked:after:translate-x-full peer-checked:after:bg-sky-200" />
                  </label>
                }
              />
              <SettingsRow
                label="Require commissioner approval"
                control={
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={approval}
                      onChange={(e) => setApproval(e.target.checked)}
                      disabled={d}
                      className="peer sr-only"
                    />
                    <div className="peer h-5 w-9 rounded-full bg-white/10 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white/60 after:transition-all peer-checked:bg-sky-500/50 peer-checked:after:translate-x-full peer-checked:after:bg-sky-200" />
                  </label>
                }
              />
              {approval && (
                <p className="pl-3 text-[11px] text-amber-300/80">
                  When enabled, updates will be held as drafts until you approve them in the Preview tab.
                </p>
              )}
            </SettingsSection>

            <SettingsSection id="zm-upd-content" title="Update content sections">
              <SettingsRow
                label="Universe movement projections"
                control={<input type="checkbox" checked={incProj} onChange={(e) => setIncProj(e.target.checked)} disabled={d} />}
              />
              <SettingsRow
                label="Money / points report"
                control={<input type="checkbox" checked={incMoney} onChange={(e) => setIncMoney(e.target.checked)} disabled={d} />}
              />
              <SettingsRow
                label="Inventory snapshot"
                control={<input type="checkbox" checked={incInv} onChange={(e) => setIncInv(e.target.checked)} disabled={d} />}
              />
              <SettingsRow
                label="Universe standings"
                control={<input type="checkbox" checked={incUni} onChange={(e) => setIncUni(e.target.checked)} disabled={d} />}
              />
              <SettingsRow
                label="Danger matchups (next week)"
                control={<input type="checkbox" checked={incDanger} onChange={(e) => setIncDanger(e.target.checked)} disabled={d} />}
              />
            </SettingsSection>

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={d}
                onClick={() => void save()}
                className="rounded-lg bg-sky-500/25 px-5 py-2 text-[12px] font-semibold text-sky-100 transition hover:bg-sky-500/35 disabled:opacity-40"
                data-testid="zombie-updates-save"
              >
                Save settings
              </button>
              {status && (
                <span className={clsx('text-[11px]', status.includes('fail') ? 'text-red-400' : 'text-white/50')}>
                  {status}
                </span>
              )}
            </div>
          </div>
        )}

        {tab === 'preview' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-white/60">Week</label>
                <Input
                  type="number"
                  value={week}
                  onChange={(e) => setWeek(e.target.value)}
                  disabled={d}
                  className="w-20"
                />
              </div>
              <button
                type="button"
                disabled={d}
                onClick={() => void loadPreview()}
                className="rounded-lg border border-white/15 px-4 py-2 text-[12px] font-medium text-white/80 transition hover:bg-white/[0.04] disabled:opacity-40"
              >
                Generate preview
              </button>
              <button
                type="button"
                disabled={d || !preview || preview === 'Loading...'}
                onClick={() => void approveAndPost()}
                className="rounded-lg bg-[var(--zombie-green)]/20 px-4 py-2 text-[12px] font-semibold text-[var(--zombie-green)] transition hover:bg-[var(--zombie-green)]/30 disabled:opacity-40"
              >
                Approve & post to chat
              </button>
            </div>

            {status && (
              <p className={clsx('text-[11px]', status.includes('fail') ? 'text-red-400' : 'text-white/50')}>
                {status}
              </p>
            )}

            {preview ? (
              <div className="rounded-xl border border-white/10 bg-black/40">
                <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2">
                  <p className="text-[11px] font-semibold text-white/50">Weekly Update Preview — Week {week}</p>
                </div>
                <pre className="max-h-[400px] overflow-auto p-4 text-[11px] text-white/75 whitespace-pre-wrap">
                  {preview}
                </pre>
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-black/20 p-8 text-center">
                <p className="text-[12px] text-white/40">
                  Click "Generate preview" to see the weekly update draft for the selected week.
                </p>
              </div>
            )}
          </div>
        )}

        {tab === 'history' && (
          <UpdateHistory leagueId={leagueId} />
        )}
      </div>
    </div>
  )
}

function UpdateHistory({ leagueId }: { leagueId: string }) {
  const [updates, setUpdates] = useState<Array<{
    id: string
    title: string
    content: string
    week: number | null
    isPosted: boolean
    createdAt: string
  }>>([])

  useEffect(() => {
    fetch(`/api/zombie/event-feed?leagueId=${encodeURIComponent(leagueId)}&type=weekly_update`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { announcements?: Array<{ id: string; title: string; content: string; week: number | null; isPosted: boolean; createdAt: string }> } | null) => {
        if (d?.announcements) setUpdates(d.announcements)
      })
      .catch(() => null)
  }, [leagueId])

  if (updates.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/20 p-8 text-center">
        <p className="text-[12px] text-white/40">
          No weekly updates have been posted yet.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {updates.map((u) => (
        <details
          key={u.id}
          className="group rounded-xl border border-white/10 bg-[var(--zombie-panel)]"
        >
          <summary className="flex cursor-pointer items-center justify-between px-4 py-3">
            <div>
              <p className="text-[12px] font-semibold text-white/80">{u.title}</p>
              <p className="text-[11px] text-white/40">
                {u.isPosted ? 'Posted' : 'Draft'} · {new Date(u.createdAt).toLocaleDateString()}
              </p>
            </div>
            <span className="text-[11px] text-white/30 group-open:rotate-180 transition">▼</span>
          </summary>
          <pre className="max-h-[240px] overflow-auto border-t border-white/[0.06] px-4 py-3 text-[11px] text-white/60 whitespace-pre-wrap">
            {u.content}
          </pre>
        </details>
      ))}
    </div>
  )
}
