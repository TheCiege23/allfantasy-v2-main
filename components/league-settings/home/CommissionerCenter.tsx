'use client'

import '@/components/core-app/af-core.css'
import './league-settings-home.css'
import './commissioner-center.css'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, Copy } from 'lucide-react'
import type { SettingsHomeSection, SettingsSubPageId } from '@/lib/league-settings-home/buildLeagueSettingsHome'
import type { SettingsSubPageRender } from './LeagueSettingsHome'

/**
 * Commissioner center (native league handoff, Commissioner.png), the desktop layout of the League
 * Settings page for a commissioner: a section nav on the left (League / Rules / Season ops), the
 * chosen section's EXISTING editor on the right, then the commissioner tools that already exist and
 * the managers card.
 *
 * ⚠ NOT A SECOND SETTINGS PAGE. Sections, values and editors all come from the caller — the same
 * `buildLeagueSettingsHome` rows and `renderSubPage` editors the phone list opens — so every save still
 * goes through the route each editor already called. Only rows the viewer may edit appear in the nav
 * (a row with a `target`), which is the builder's existing permission rule.
 *
 * The handoff's page-level "Discard / Save changes" pair is not drawn: each editor saves itself today
 * (autosaving tabs, or its own Save button), and a page-level save that did nothing would be a lie.
 */

type NavItem = { id: SettingsSubPageId; label: string }

const NAV_GROUPS: ReadonlyArray<{ title: string; items: ReadonlyArray<NavItem> }> = [
  {
    title: 'League',
    items: [
      { id: 'general', label: 'General' },
      { id: 'format', label: 'League format' },
      { id: 'members', label: 'Managers & invites' },
      { id: 'co-commissioners', label: 'Co-commissioners' },
      { id: 'divisions', label: 'Divisions' },
    ],
  },
  {
    title: 'Rules',
    items: [
      { id: 'scoring', label: 'Scoring' },
      { id: 'roster', label: 'Roster slots' },
      { id: 'draft', label: 'Draft' },
      { id: 'waivers', label: 'Waivers & free agents' },
      { id: 'trades', label: 'Trades' },
      { id: 'playoffs', label: 'Playoffs' },
      { id: 'guillotine-first-chop', label: 'First chop week' },
      { id: 'guillotine-chop-rules', label: 'Chop rules' },
    ],
  },
  {
    title: 'Season ops',
    items: [
      { id: 'commissioner-tools', label: 'Lineups, locks & schedule' },
      { id: 'survivor-tribes', label: 'Survivor tribes' },
      { id: 'ai', label: 'League AI' },
    ],
  },
]

/** The commissioner powers this repo already has, and where each one lives. */
const TOOLS: ReadonlyArray<{ id: string; label: string; detail: string; target: SettingsSubPageId; inSeasonOnly?: boolean }> = [
  { id: 'edit-lineups', label: 'Edit any lineup', detail: 'Set or fix a manager’s starters.', target: 'commissioner-tools', inSeasonOnly: true },
  { id: 'roster-locks', label: 'Lock or unlock rosters', detail: 'Freeze adds, drops and trades for a team.', target: 'commissioner-tools' },
  { id: 'schedule', label: 'Edit the schedule', detail: 'Change who plays whom, week by week.', target: 'commissioner-tools' },
  { id: 'co-commish', label: 'Co-commissioners', detail: 'Share the work with a trusted manager.', target: 'co-commissioners' },
  { id: 'dues', label: 'Dues & league history', detail: 'Track buy-ins and past seasons.', target: 'commissioner-tools' },
]

/** Ids the viewer can open: every row target the builder handed back. */
export function editableSubPages(sections: readonly SettingsHomeSection[]): Set<SettingsSubPageId> {
  const out = new Set<SettingsSubPageId>()
  for (const section of sections) for (const row of section.rows) if (row.target) out.add(row.target)
  return out
}

function CopyInvite({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return (
    <button
      type="button"
      className="cc-primary cc-wide"
      data-testid="cc-copy-invite"
      onClick={async () => {
        try {
          await navigator.clipboard?.writeText(url)
          setCopied(true)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => setCopied(false), 1800)
        } catch {
          setCopied(false)
        }
      }}
    >
      {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
      {copied ? 'Invite link copied' : 'Copy invite link'}
    </button>
  )
}

export function CommissionerCenter({
  leagueName,
  sections,
  renderSubPage,
  onExit,
  initialSubPage,
  inSeason,
  managers,
  onSubPageClosed,
}: {
  leagueName?: string | null
  sections: SettingsHomeSection[]
  renderSubPage: (id: SettingsSubPageId) => SettingsSubPageRender | null
  onExit?: () => void
  initialSubPage?: SettingsSubPageId | null
  /** The league is past its draft: in-season tools read READY, otherwise IN SEASON. */
  inSeason: boolean
  managers: { joined: number; total: number; inviteUrl: string | null }
  /** Fired when the open section changes, so the caller can refetch the values it shows. */
  onSubPageClosed?: (id: SettingsSubPageId) => void
}) {
  const allowed = editableSubPages(sections)
  const groups = NAV_GROUPS.map(group => ({ ...group, items: group.items.filter(item => allowed.has(item.id)) })).filter(group => group.items.length)
  const fallback: SettingsSubPageId = allowed.has(inSeason ? 'general' : 'draft') ? (inSeason ? 'general' : 'draft') : groups[0]?.items[0]?.id ?? 'general'
  const [open, setOpen] = useState<SettingsSubPageId>(initialSubPage && allowed.has(initialSubPage) ? initialSubPage : fallback)
  const pane = useRef<HTMLDivElement | null>(null)
  const select = (id: SettingsSubPageId) => {
    if (id !== open) onSubPageClosed?.(open)
    setOpen(id)
    pane.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }
  const sub = renderSubPage(open)
  const pct = managers.total > 0 ? Math.min(100, Math.round((managers.joined / managers.total) * 100)) : 0

  return (
    <div className="af-core lsh-root cc-root" data-testid="commissioner-center">
      <header className="cc-head">
        {onExit ? (
          <button type="button" className="cc-back" onClick={onExit} data-testid="cc-back">
            <ChevronLeft size={16} aria-hidden /> Back to league home
          </button>
        ) : null}
        <h1>Commissioner center</h1>
        <p>Every rule for {leagueName?.trim() || 'your league'} lives here. Each section saves on its own.</p>
      </header>

      <div className="cc-grid">
        <nav className="cc-nav" aria-label="Commissioner sections">
          {groups.map(group => (
            <section key={group.title}>
              <h2>{group.title}</h2>
              {group.items.map(item => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={open === item.id ? 'page' : undefined}
                  onClick={() => select(item.id)}
                  data-testid={`cc-nav-${item.id}`}
                >
                  {item.label}
                </button>
              ))}
            </section>
          ))}
        </nav>

        <div className="cc-pane" ref={pane}>
          <section className="cc-card" aria-labelledby="cc-pane-title" data-testid="cc-pane" data-subpage={open}>
            <p className="cc-label">{groups.find(g => g.items.some(i => i.id === open))?.title ?? 'Settings'}</p>
            <h2 id="cc-pane-title">{sub?.title ?? 'Settings'}</h2>
            <div className="cc-pane-body">{sub?.content ?? <p className="lsh-help">This section is not available for this league.</p>}</div>
          </section>
        </div>
      </div>

      <section className="cc-card cc-tools" aria-labelledby="cc-tools-title">
        <p className="cc-label" id="cc-tools-title">Commissioner tools</p>
        <ul>
          {TOOLS.filter(tool => allowed.has(tool.target)).map(tool => {
            const ready = !tool.inSeasonOnly || inSeason
            return (
              <li key={tool.id}>
                <button type="button" onClick={() => select(tool.target)} data-testid={`cc-tool-${tool.id}`}>
                  <span>
                    <strong>{tool.label}</strong>
                    <small>{tool.detail}</small>
                  </span>
                  <em data-ready={ready ? 'true' : undefined}>{ready ? 'Ready' : 'In season'}</em>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="cc-card cc-managers" aria-labelledby="cc-managers-title">
        <p className="cc-label" id="cc-managers-title">Managers</p>
        <p className="cc-count"><strong>{managers.joined}</strong> / {managers.total} joined</p>
        <div className="cc-bar" role="progressbar" aria-valuemin={0} aria-valuemax={managers.total} aria-valuenow={managers.joined} aria-label="Managers joined">
          <span style={{ width: `${pct}%` }} />
        </div>
        {managers.inviteUrl ? <CopyInvite url={managers.inviteUrl} /> : <p className="lsh-help">No invite link yet — open Managers & invites to create one.</p>}
      </section>
    </div>
  )
}
