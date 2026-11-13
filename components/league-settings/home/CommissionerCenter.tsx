'use client'

import '@/components/core-app/af-core.css'
import '@/components/league/league-admin.css'
import './league-settings-home.css'
import './commissioner-center.css'
// Redraft-only rules, all scoped under the workspace's data-format=redraft stamp (A5).
import './redraft-settings.css'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Check, ChevronLeft, Copy } from 'lucide-react'
import type { SettingsHomeSection, SettingsSubPageId } from '@/lib/league-settings-home/buildLeagueSettingsHome'
import type { SettingsSubPageRender } from './LeagueSettingsHome'
import { SettingsSaveScope, confirmDiscardIfDirty, useSaveScopeHandleRef } from './SettingsSaveScope'
import type { RedraftSettingsView } from '@/lib/league-media/redraftSettings'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * Commissioner center (native league handoff, Commissioner.png; restyled to the redraft Settings
 * board 2026-11-01), the League Settings page for a commissioner: a section nav on the left
 * (League / Rules / Season ops), each item with a one-line summary — or, in a narrow container, a
 * category picker — the chosen section's EXISTING editor on the right, then the commissioner tools
 * that already exist and the managers card. Pirate leagues get Pirate rules pinned above the nav.
 *
 * ⚠ NOT A SECOND SETTINGS PAGE. Sections, values and editors all come from the caller — the same
 * `buildLeagueSettingsHome` rows and `renderSubPage` editors the phone list opens — so every save still
 * goes through the route each editor already called. Only rows the viewer may edit appear in the nav
 * (a row with a `target`), which is the builder's existing permission rule.
 *
 * The handoff's page-level "Discard / Save changes" pair is not drawn: each editor saves itself today
 * (autosaving tabs, or its own Save button), and a page-level save that did nothing would be a lie.
 * Nor is the board's "Your plan" pill: this page knows whether a commissioner plan is active, not
 * which one, and a pill that guessed the tier would be wrong for every Supreme commissioner.
 *
 * Copy: `lsh.cc.*` in lib/i18n/translations.ts, en and es.
 */

/** `key` names the copy: `lsh.cc.nav.<key>` is the label and `lsh.cc.sub.<key>` the one-line summary under it. */
type NavItem = { id: SettingsSubPageId; key: string }

const NAV_GROUPS: ReadonlyArray<{ key: 'league' | 'rules' | 'ops'; items: ReadonlyArray<NavItem> }> = [
  {
    key: 'league',
    items: [
      { id: 'general', key: 'general' },
      { id: 'format', key: 'format' },
      // Waivers belong with the league's format, not the draft (owner's call, 2026-11-01).
      { id: 'waivers', key: 'waivers' },
      { id: 'members', key: 'members' },
      { id: 'team-settings', key: 'teamSettings' },
      { id: 'previous-leagues', key: 'previousLeagues' },
      { id: 'co-commissioners', key: 'coCommissioners' },
      { id: 'divisions', key: 'divisions' },
    ],
  },
  {
    key: 'rules',
    items: [
      { id: 'scoring', key: 'scoring' },
      { id: 'roster', key: 'roster' },
      { id: 'draft', key: 'draft' },
      { id: 'trades', key: 'trades' },
      { id: 'playoffs', key: 'playoffs' },
      { id: 'guillotine-first-chop', key: 'firstChop' },
      { id: 'guillotine-chop-rules', key: 'chopRules' },
      { id: 'guillotine-rules', key: 'guillotineRules' },
      // Listed here for the category picker; the sidebar pins it above the groups instead.
      { id: 'pirate-rules', key: 'pirateRules' },
    ],
  },
  {
    key: 'ops',
    items: [
      { id: 'commissioner-tools', key: 'commissionerTools' },
      { id: 'dues', key: 'dues' },
      { id: 'settings-lock', key: 'settingsLock' },
      { id: 'score-adjustments', key: 'scoreAdjustments' },
      { id: 'survivor-tribes', key: 'survivorTribes' },
      { id: 'ai', key: 'ai' },
    ],
  },
]

/** The commissioner powers this repo already has, and where each one lives. Copy: `lsh.cc.tool.<key>` (+`Detail`). */
const TOOLS: ReadonlyArray<{ id: string; key: string; target: SettingsSubPageId; inSeasonOnly?: boolean }> = [
  { id: 'edit-lineups', key: 'editLineups', target: 'commissioner-tools', inSeasonOnly: true },
  { id: 'roster-locks', key: 'rosterLocks', target: 'commissioner-tools' },
  { id: 'schedule', key: 'schedule', target: 'commissioner-tools' },
  { id: 'settings-lock', key: 'settingsLock', target: 'settings-lock' },
  { id: 'score-adjust', key: 'scoreAdjust', target: 'score-adjustments', inSeasonOnly: true },
  { id: 'co-commish', key: 'coCommish', target: 'co-commissioners' },
  { id: 'dues', key: 'dues', target: 'dues' },
]

/** The section's one-line summary key, from the same copy the nav uses. */
function navSubKey(id: SettingsSubPageId): string | null {
  for (const group of NAV_GROUPS) for (const item of group.items) if (item.id === id) return `lsh.cc.sub.${item.key}`
  return null
}

/** Ids the viewer can open: every row target the builder handed back. */
function editableSubPages(sections: readonly SettingsHomeSection[]): Set<SettingsSubPageId> {
  const out = new Set<SettingsSubPageId>()
  for (const section of sections) for (const row of section.rows) if (row.target) out.add(row.target)
  return out
}

function CopyInvite({ url }: { url: string }) {
  const { t } = useOptionalLanguage()
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
      {copied ? t('lsh.cc.managers.copied') : t('lsh.cc.managers.copy')}
    </button>
  )
}

export function CommissionerCenter({
  leagueId,
  leagueName,
  sections,
  renderSubPage,
  onExit,
  initialSubPage,
  inSeason,
  managers,
  onSubPageClosed,
  header,
  redraft = null,
}: {
  leagueId?: string
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
  /** Drawn above the sections (the pre-draft setup card); given a way to open a section. */
  header?: (openSection: (id: SettingsSubPageId) => void) => ReactNode
  /** Native redraft leagues only (lib/league-media/redraftSettings.ts); null renders the default layout. */
  redraft?: RedraftSettingsView | null
}) {
  const { t, tInterpolate } = useOptionalLanguage()
  const allowed = editableSubPages(sections)
  const groups = NAV_GROUPS.map(group => ({ ...group, items: group.items.filter(item => allowed.has(item.id)) })).filter(group => group.items.length)
  const fallback: SettingsSubPageId = allowed.has('general') ? 'general' : groups[0]?.items[0]?.id ?? 'general'
  const [open, setOpen] = useState<SettingsSubPageId>(initialSubPage && allowed.has(initialSubPage) ? initialSubPage : fallback)
  const pane = useRef<HTMLDivElement | null>(null)
  const saveScope = useSaveScopeHandleRef()
  const select = (id: SettingsSubPageId) => {
    if (id !== open && !confirmDiscardIfDirty(saveScope.ref.current)) return
    if (id !== open) onSubPageClosed?.(open)
    setOpen(id)
    pane.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }
  const sub = renderSubPage(open)
  const pct = managers.total > 0 ? Math.min(100, Math.round((managers.joined / managers.total) * 100)) : 0
  const league = leagueName?.trim() || t('lsh.cc.yourLeague')
  const openGroup = groups.find(g => g.items.some(i => i.id === open))
  const paneSubKey = navSubKey(open)

  return (
    <div className="af-core lsh-root cc-root" data-testid="commissioner-center" data-rd-settings={redraft ? 'true' : undefined} data-rd-sport={redraft?.sport}>
      <header className="cc-head">
        {onExit ? (
          <button type="button" className="cc-back" onClick={() => { if (confirmDiscardIfDirty(saveScope.ref.current)) onExit() }} data-testid="cc-back">
            <ChevronLeft size={16} aria-hidden /> {t('lsh.cc.back')}
          </button>
        ) : null}
        <p className="cc-eyebrow" data-testid="cc-eyebrow">{tInterpolate('lsh.cc.eyebrow', { league })}</p>
        <h1>{t('lsh.cc.title')}</h1>
        <p>{tInterpolate('lsh.cc.intro', { league })}</p>
      </header>

      <div className="cc-mobile-categories">
        {allowed.has('pirate-rules') ? (
          <button type="button" className="cc-primary cc-pirate-shortcut" onClick={() => select('pirate-rules')} aria-current={open === 'pirate-rules' ? 'page' : undefined}>
            {t('lsh.cc.nav.pirateRules')} <span>{t('lsh.cc.sub.pirateRules')}</span>
          </button>
        ) : null}
        <label htmlFor="cc-category">{t('lsh.cc.category')}</label>
        <select id="cc-category" value={open} onChange={event => select(event.target.value as SettingsSubPageId)}>
          {groups.map(group => <optgroup key={group.key} label={t(`lsh.cc.group.${group.key}`)}>
            {group.items.map(item => <option key={item.id} value={item.id}>{t(`lsh.cc.nav.${item.key}`)}</option>)}
          </optgroup>)}
        </select>
      </div>

      <div className="cc-grid">
        <nav className="cc-nav" aria-label={t('lsh.cc.navAria')}>
          {allowed.has('pirate-rules') ? (
            <section className="cc-pirate-nav">
              <h2>{t('lsh.cc.group.pirate')}</h2>
              <button type="button" onClick={() => select('pirate-rules')} aria-current={open === 'pirate-rules' ? 'page' : undefined} data-testid="cc-nav-pirate-rules">
                <span className="cc-nav-text">
                  <span className="cc-nav-label">{t('lsh.cc.nav.pirateRules')}</span>
                  <span className="cc-nav-sub">{t('lsh.cc.sub.pirateRules')}</span>
                </span>
              </button>
            </section>
          ) : null}
          {groups.map(group => (
            <section key={group.key}>
              <h2>{t(`lsh.cc.group.${group.key}`)}</h2>
              {group.items.filter(item => item.id !== 'pirate-rules').map(item => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={open === item.id ? 'page' : undefined}
                  onClick={() => select(item.id)}
                  data-testid={`cc-nav-${item.id}`}
                  data-rd-stage={redraft?.subPages[item.id]?.stage}
                >
                  <span className="cc-nav-text">
                    <span className="cc-nav-label">{t(`lsh.cc.nav.${item.key}`)}</span>
                    <span className="cc-nav-sub">{t(`lsh.cc.sub.${item.key}`)}</span>
                  </span>
                </button>
              ))}
            </section>
          ))}
        </nav>

        <div className="cc-pane" ref={pane}>
          <section className="cc-card" aria-labelledby="cc-pane-title" data-testid="cc-pane" data-subpage={open}>
            <p className="cc-label">
              {openGroup ? t(`lsh.cc.group.${openGroup.key}`) : t('lsh.cc.paneFallback')}
              {redraft?.subPages[open] ? <span className="cc-rd-when" data-testid="cc-rd-when"> · {redraft.subPages[open]?.when}</span> : null}
            </p>
            <h2 id="cc-pane-title">{sub?.title ?? t('lsh.cc.paneFallback')}</h2>
            {paneSubKey ? <p className="cc-pane-sub" data-testid="cc-pane-sub">{t(paneSubKey)}</p> : null}
            <div className="cc-pane-body af-league-admin">
              {sub ? (
                <SettingsSaveScope key={open} onReady={saveScope.onReady}>
                  {sub.content}
                </SettingsSaveScope>
              ) : (
                <p className="lsh-help">{t('lsh.cc.unavailable')}</p>
              )}
            </div>
          </section>
        </div>
      </div>

      {header ? <details className="cc-setup-guide"><summary>{t('lsh.cc.setupChecklist')}</summary>{header(select)}</details> : null}

      {leagueId ? <Link className="cc-activity-link" href={`/core/commissioner?league=${encodeURIComponent(leagueId)}&workspace=activity`}>{t('lsh.cc.activityLink')}</Link> : null}

      <div className="cc-foot">
        <details className="cc-card cc-tools">
          <summary id="cc-tools-title">{t('lsh.cc.tools.title')}</summary>
          <ul>
            {TOOLS.filter(tool => allowed.has(tool.target)).map(tool => {
              const ready = !tool.inSeasonOnly || inSeason
              return (
                <li key={tool.id}>
                  <button type="button" onClick={() => select(tool.target)} data-testid={`cc-tool-${tool.id}`}>
                    <span>
                      <strong>{t(`lsh.cc.tool.${tool.key}`)}</strong>
                      <small>{t(`lsh.cc.tool.${tool.key}Detail`)}</small>
                    </span>
                    <em data-ready={ready ? 'true' : undefined}>{ready ? t('lsh.cc.tools.ready') : t('lsh.cc.tools.inSeason')}</em>
                  </button>
                </li>
              )
            })}
          </ul>
        </details>

        <section className="cc-card cc-managers" aria-labelledby="cc-managers-title">
          <p className="cc-label" id="cc-managers-title">{t('lsh.cc.managers.title')}</p>
          <p className="cc-count"><strong>{managers.joined}</strong> {tInterpolate('lsh.cc.managers.joined', { total: managers.total })}</p>
          <div className="cc-bar" role="progressbar" aria-valuemin={0} aria-valuemax={managers.total} aria-valuenow={managers.joined} aria-label={t('lsh.cc.managers.aria')}>
            <span style={{ width: `${pct}%` }} />
          </div>
          {managers.inviteUrl ? <CopyInvite url={managers.inviteUrl} /> : <p className="lsh-help">{t('lsh.cc.managers.noInvite')}</p>}
        </section>
      </div>
    </div>
  )
}
