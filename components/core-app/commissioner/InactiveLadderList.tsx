'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { ladderCounts, type LadderEntry, type LadderStep } from '@/lib/core-app/commissioner/inactiveLadder'
import { inactiveLadderMessages } from '@/lib/core-app/messages/inactiveLadder'
import '@/components/core-app/commissioner/af-inactive-ladder.css'

/**
 * The inactive-manager ladder as a list (lib/core-app/commissioner/inactiveLadder.ts) — drawn on the
 * /core home's "Leagues you run" card and on the Commissioner Hub, from the same overview, so the two
 * cannot disagree.
 *
 * ⚠ IT NEVER SENDS ANYTHING. Each row drafts the commissioner's message and copies it; the person
 * pastes it where their league talks. The text is also on screen behind "Show message", because a
 * clipboard write can be refused (an insecure origin, a browser setting) and a button that silently
 * does nothing is worse than no button.
 */

type Text = (typeof inactiveLadderMessages)['en']

function messageFor(entry: LadderEntry, t: Text): string {
  const ctx = { manager: entry.manager, league: entry.leagueName, days: entry.daysQuiet }
  if (entry.step === 'replace') return t.messageReplace(ctx)
  if (entry.step === 'warn') return t.messageWarn(ctx)
  return t.messageNudge(ctx)
}

function stepLabel(step: LadderStep, t: Text): string {
  return step === 'replace' ? t.stepReplace : step === 'warn' ? t.stepWarn : t.stepNudge
}

/** A selection copy through a throwaway textarea — the fallback when `navigator.clipboard` is refused. */
function legacyCopy(text: string): boolean {
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'absolute'
    area.style.left = '-9999px'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

function LadderRow({ entry }: { entry: LadderEntry }) {
  const t = useMessages(inactiveLadderMessages)
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const message = messageFor(entry, t)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      setState('copied')
      return
    } catch {
      /* The async clipboard can be refused (embedded views, permissions policy); try the old path. */
    }
    setState(legacyCopy(message) ? 'copied' : 'failed')
  }
  return (
    <li className="af-ladder-row" data-step={entry.step}>
      <span className="af-ladder-step">{stepLabel(entry.step, t)}</span>
      <div className="af-ladder-main">
        <p className="af-ladder-who">
          {entry.manager}
          <span> — {entry.leagueName}</span>
        </p>
        <p className="af-ladder-quiet">{t.quiet(entry.daysQuiet)}</p>
        <details className="af-ladder-msg">
          <summary>{t.showMessage}</summary>
          <p>{message}</p>
        </details>
      </div>
      <div className="af-ladder-actions">
        <button type="button" className="af3a-btn" onClick={copy} aria-live="polite">
          {state === 'copied' ? t.copied : state === 'failed' ? t.copyFailed : t.copy}
        </button>
        <Link className="af-ladder-link" href={entry.href}>
          {entry.step === 'replace' ? t.replaceManager : t.openLeague} →
        </Link>
      </div>
    </li>
  )
}

export function InactiveLadderList({
  entries,
  limit,
  showTeach = true,
  offSeason = false,
}: {
  entries: LadderEntry[]
  /**
   * Activity WAS read, but no league read is mid-season, so none was laddered (2026-11-12, found on
   * a real account: 103 managers inactive and no ladder, which read as broken). Says why instead of
   * the "everyone is active" line, which would be false.
   */
  offSeason?: boolean
  /** Rows drawn before "+N more in the Commissioner Hub". Omit to draw every row. */
  limit?: number
  showTeach?: boolean
}) {
  const t = useMessages(inactiveLadderMessages)
  const counts = ladderCounts(entries)
  const shown = limit == null ? entries : entries.slice(0, limit)
  const hidden = entries.length - shown.length
  return (
    <div className="af-ladder">
      <p className="af-ladder-head">
        <b>{t.title}</b>
        {entries.length > 0 ? <span>{t.summary(counts.replace, counts.warn, counts.nudge)}</span> : null}
      </p>
      {entries.length === 0 ? (
        <p className="af-ladder-none">{offSeason ? t.noneOffSeason : t.none}</p>
      ) : (
        <ul className="af-ladder-list">
          {shown.map((entry) => (
            <LadderRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
      {hidden > 0 ? (
        <Link className="af-ladder-more" href="/core/commissioner#af-ladder">
          {t.more(hidden)}
        </Link>
      ) : null}
      {showTeach ? (
        <p className="af-ladder-teach">
          <b aria-hidden="true">↳</b> {t.teach}
        </p>
      ) : null}
    </div>
  )
}

