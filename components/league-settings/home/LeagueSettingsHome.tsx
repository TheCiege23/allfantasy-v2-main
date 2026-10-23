'use client'

import '@/components/core-app/af-core.css'
import '@/components/league/league-admin.css'
import './league-settings-home.css'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Check, ChevronRight, Copy } from 'lucide-react'
import {
  isLongSettingsValue,
  type SettingsHomeRow,
  type SettingsHomeSection,
  type SettingsSubPageId,
} from '@/lib/league-settings-home/buildLeagueSettingsHome'
import { SettingsSaveScope, confirmDiscardIfDirty, useSaveScopeHandleRef } from './SettingsSaveScope'

export type SettingsSubPageRender = {
  title: string
  content: ReactNode
}

/** Sticky footer for sub-pages whose editor saves explicitly. */
export function SettingsSubPageFooter({ children }: { children: ReactNode }) {
  return <div className="lsh-footer">{children}</div>
}

function SettingsHeader({ title, onBack, backLabel }: { title: string; onBack?: () => void; backLabel: string }) {
  return (
    <header className="lsh-header">
      {onBack ? (
        <button type="button" className="lsh-icon-btn" onClick={onBack} aria-label={backLabel} data-testid="lsh-back">
          <ArrowLeft size={20} aria-hidden />
        </button>
      ) : null}
      <h1>{title}</h1>
    </header>
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(text)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }
  return (
    <button type="button" className="lsh-copy" onClick={copy} aria-label={`Copy ${label}`} data-testid="lsh-copy-invite">
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function Row({ row, onOpen }: { row: SettingsHomeRow; onOpen: (target: SettingsSubPageId) => void }) {
  // Long values (the chop & waiver schedule, the invite link) drop under the label on a phone and
  // wrap; nothing in this list is truncated with an ellipsis.
  const layout = isLongSettingsValue(row.value) ? 'stacked' : 'inline'
  const value = (
    <span className="lsh-value" data-pending={row.pending ? 'true' : undefined} title={row.value}>
      {row.value}
    </span>
  )
  if (row.target) {
    const target = row.target
    return (
      <button type="button" className="lsh-row" data-layout={layout} onClick={() => onOpen(target)} data-testid={`lsh-row-${row.id}`}>
        <span className="lsh-label">{row.label}</span>
        {value}
        <ChevronRight size={18} className="lsh-chevron" aria-hidden />
      </button>
    )
  }
  return (
    <div className="lsh-row" data-layout={layout} data-testid={`lsh-row-${row.id}`} data-readonly="true">
      <span className="lsh-label">{row.label}</span>
      {value}
      {row.copyText ? <CopyButton text={row.copyText} label={row.label} /> : null}
    </div>
  )
}

export type LeagueSettingsHomeProps = {
  leagueName?: string | null
  sections: SettingsHomeSection[]
  canEdit: boolean
  /** Builds the sub-page for a row target. Returning null keeps the list. */
  renderSubPage: (id: SettingsSubPageId) => SettingsSubPageRender | null
  /** Leaves settings (back to the league). Omit to hide the list's back arrow. */
  onExit?: () => void
  /** Fired when a sub-page closes, so the caller can refetch the values it shows. */
  onSubPageClosed?: (id: SettingsSubPageId) => void
  initialSubPage?: SettingsSubPageId | null
  /** Drawn above the sections (the pre-draft setup card); given a way to open a sub-page. */
  header?: (openSubPage: (id: SettingsSubPageId) => void) => ReactNode
}

/**
 * The Sleeper-style League Settings page: one scrollable list grouped into sections; tapping a row
 * opens a focused sub-page with its own back arrow. Presentational — the caller supplies the rows
 * (lib/league-settings-home/buildLeagueSettingsHome) and the editors.
 */
export function LeagueSettingsHome({
  leagueName,
  sections,
  canEdit,
  renderSubPage,
  onExit,
  onSubPageClosed,
  initialSubPage = null,
  header,
}: LeagueSettingsHomeProps) {
  const [open, setOpen] = useState<SettingsSubPageId | null>(initialSubPage)
  const listScroll = useRef(0)
  const saveScope = useSaveScopeHandleRef()

  const openSubPage = useCallback((id: SettingsSubPageId) => {
    if (typeof window !== 'undefined') listScroll.current = window.scrollY
    setOpen(id)
    if (typeof window !== 'undefined') window.scrollTo?.({ top: 0 })
  }, [])

  const closeSubPage = useCallback(() => {
    if (!confirmDiscardIfDirty(saveScope.ref.current)) return
    const closing = open
    setOpen(null)
    if (closing) onSubPageClosed?.(closing)
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      const y = listScroll.current
      window.requestAnimationFrame(() => window.scrollTo?.({ top: y }))
    }
  }, [open, onSubPageClosed, saveScope.ref])

  const sub = open ? renderSubPage(open) : null

  if (open && sub) {
    return (
      <div className="af-core lsh-root" data-testid="league-settings-subpage" data-subpage={open}>
        <SettingsHeader title={sub.title} onBack={closeSubPage} backLabel="Back to league settings" />
        <div className="lsh-column">
          {/* af-league-admin maps the older editors' fixed colours onto the theme (league-admin.css). */}
          <div className="lsh-subpage-body af-league-admin">
            <SettingsSaveScope key={open} onReady={saveScope.onReady}>
              {sub.content}
            </SettingsSaveScope>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="af-core lsh-root" data-testid="league-settings-home">
      <SettingsHeader title="League Settings" onBack={onExit} backLabel="Back to league" />
      <div className="lsh-column">
        {leagueName ? <p className="lsh-subtitle">{leagueName}</p> : null}
        {!canEdit ? (
          <p className="lsh-readonly-note" data-testid="lsh-readonly-note">
            Only the commissioner can change these settings.
          </p>
        ) : null}
        {header?.(openSubPage)}
        {sections.map((section) => (
          <section key={section.id} className="lsh-section" aria-labelledby={`lsh-section-${section.id}`} data-testid={`lsh-section-${section.id}`}>
            <h2 id={`lsh-section-${section.id}`}>{section.title}</h2>
            <ul className="lsh-list">
              {section.rows.map((row) => (
                <li key={row.id}>
                  <Row row={row} onOpen={openSubPage} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
