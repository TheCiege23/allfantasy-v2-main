'use client'

import { useCallback, useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { commissionerScreensMessages } from '@/lib/core-app/messages/commissionerScreens'
import { coreLang } from '@/lib/core-app/messages/coreLocale'
import { CUSTOM_KINDS, CUSTOM_MAX, LABEL_MAX, type CustomKind } from '@/lib/deadline-autopilot/autopilot'
import type { AutopilotView } from '@/lib/deadline-autopilot/autopilotService'

/**
 * Deadline autopilot card (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3.5), on the Commissioner Hub.
 *
 * Free: the deadline list and "Remind now". Commissioner plan: the automatic 72 h / 24 h / 1 h
 * reminders. The route enforces both; this card only reflects what it was told.
 */

type Row = { id?: string; kind: CustomKind; label: string; local: string }

type M = typeof commissionerScreensMessages.en

const KIND_LABEL: Record<CustomKind, (m: M) => string> = {
  trade: (m) => m.autopilotKindTrade,
  taxi: (m) => m.autopilotKindTaxi,
  franchise_tag: (m) => m.autopilotKindFranchiseTag,
  contract: (m) => m.autopilotKindContract,
  keeper: (m) => m.autopilotKindKeeper,
  other: (m) => m.autopilotKindOther,
}

const ERRORS: Record<string, (m: M) => string> = {
  not_entitled: (m) => m.autopilotErrNotEntitled,
  cooldown: (m) => m.autopilotErrCooldown,
  no_recipients: (m) => m.autopilotErrNoRecipients,
  label_required: (m) => m.autopilotErrLabelRequired,
  invalid_time: (m) => m.autopilotErrInvalidTime,
  too_many: (m) => m.autopilotErrTooMany(CUSTOM_MAX),
}

/** ISO → the value an <input type="datetime-local"> wants, in the viewer's own time zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function DeadlineAutopilot({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const m = useMessages(commissionerScreensMessages)
  const endpoint = `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/deadline-autopilot`

  const [view, setView] = useState<AutopilotView | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const adopt = useCallback((v: AutopilotView) => {
    setView(v)
    setRows(v.custom.map((c) => ({ id: c.id, kind: c.kind, label: c.label, local: toLocalInput(c.at) })))
    setDirty(false)
  }, [])

  useEffect(() => {
    let live = true
    fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!live) return
        if (res.ok && body) adopt(body as AutopilotView)
        else setMessage((body as { error?: string } | null)?.error ?? `HTTP ${res.status}`)
      })
      .catch((e) => live && setMessage(String(e)))
    return () => {
      live = false
    }
  }, [endpoint, adopt])

  const say = (code: string | undefined, status: number) => {
    const known = code ? ERRORS[code] : undefined
    setMessage(known ? known(m) : code ?? m.autopilotCouldNotSave(status))
  }

  async function save(payload: Record<string, unknown>, done: string) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload) })
      const body = await res.json().catch(() => null)
      if (!res.ok) return say((body as { error?: string } | null)?.error, res.status)
      adopt(body as AutopilotView)
      setMessage(done)
    } finally {
      setBusy(false)
    }
  }

  async function remindNow(key: string) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: 'remind_now', key }) })
      const body = (await res.json().catch(() => null)) as { sent?: number; error?: string } | null
      if (!res.ok) return say(body?.error, res.status)
      setMessage(m.autopilotReminderSent(body?.sent ?? 0))
      const fresh = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' })
      if (fresh.ok) adopt((await fresh.json()) as AutopilotView)
    } finally {
      setBusy(false)
    }
  }

  const edit = (i: number, patch: Partial<Row>) => {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setDirty(true)
  }

  if (!view) {
    return <p className="af-ch-muted">{message ?? m.autopilotLoading}</p>
  }

  return (
    <div className="af-ch-recipes" data-testid="deadline-autopilot">
      {!view.sendEnabled && view.enabled ? (
        <p className="af-ch-recipes-banner">
          {m.autopilotSavedNotSending}
        </p>
      ) : null}

      <ul className="af-ch-recipe-list">
        <li data-on={view.enabled && view.entitled}>
          <div className="af-ch-recipe-body">
            <p className="af-ch-recipe-label">{m.autopilotTitle}</p>
            <p className="af-ch-recipe-desc">
              {m.autopilotDesc}
            </p>
            <p className="af-ch-recipe-meta">
              {view.entitled
                ? m.autopilotMetaEntitled
                : m.autopilotMetaUpsell}
            </p>
          </div>
          <label className="af-ch-switch">
            <input
              type="checkbox"
              role="switch"
              checked={view.enabled}
              disabled={busy || (!view.entitled && !view.enabled)}
              aria-label={m.autopilotTitle}
              onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? m.autopilotOn : m.autopilotOff)}
            />
            <span aria-hidden className="af-ch-switch-track">
              <span className="af-ch-switch-thumb" />
            </span>
          </label>
        </li>

        {view.deadlines.length === 0 ? (
          <li>
            <p className="af-ch-recipe-desc">{m.autopilotNoDeadlines}</p>
          </li>
        ) : (
          view.deadlines.map((d) => (
            <li key={d.key}>
              <div className="af-ch-recipe-body">
                <p className="af-ch-recipe-label">{d.kind === 'keeper' && d.targeted ? m.autopilotKeeperDeadline : d.label}</p>
                <p className="af-ch-recipe-meta">
                  {new Date(d.at).toLocaleString(coreLang(language), { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
                  {d.targeted ? m.autopilotStillToSubmit(d.recipients) : m.autopilotManagers(d.recipients)}
                  {d.lastSent ? m.autopilotLastReminder(d.lastSent) : ''}
                </p>
              </div>
              <button type="button" className="af-btn" disabled={busy || !d.manualAllowed || d.recipients === 0} onClick={() => remindNow(d.key)}>
                {m.autopilotRemindNow}
              </button>
            </li>
          ))
        )}
      </ul>

      <h4 className="af-ch-recipe-label" style={{ marginTop: 16 }}>{m.autopilotYourDeadlines}</h4>
      <p className="af-ch-recipe-desc">
        {m.autopilotYourDeadlinesDesc}
      </p>
      <ul className="af-ch-recipe-list">
        {rows.map((r, i) => (
          <li key={r.id ?? `new-${i}`} style={{ gap: 8, flexWrap: 'wrap' }}>
            <select value={r.kind} disabled={busy} aria-label={m.autopilotType} onChange={(e) => edit(i, { kind: e.target.value as CustomKind })}>
              {CUSTOM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k](m)}
                </option>
              ))}
            </select>
            <input value={r.label} maxLength={LABEL_MAX} disabled={busy} aria-label={m.autopilotName} placeholder={m.autopilotNamePlaceholder} onChange={(e) => edit(i, { label: e.target.value })} />
            <input type="datetime-local" value={r.local} disabled={busy} aria-label={m.autopilotDateTime} onChange={(e) => edit(i, { local: e.target.value })} />
            <button type="button" className="af-btn" disabled={busy} onClick={() => { setRows(rows.filter((_, j) => j !== i)); setDirty(true) }}>
              {m.autopilotRemove}
            </button>
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="af-btn"
          disabled={busy || rows.length >= CUSTOM_MAX}
          onClick={() => {
            setRows([...rows, { kind: 'trade', label: m.autopilotKindTrade, local: '' }])
            setDirty(true)
          }}
        >
          {m.autopilotAdd}
        </button>
        <button
          type="button"
          className="af-btn"
          disabled={busy || !dirty}
          onClick={() =>
            save(
              { custom: rows.map((r) => ({ id: r.id, kind: r.kind, label: r.label, at: r.local ? new Date(r.local).toISOString() : '' })) },
              m.autopilotSaved,
            )
          }
        >
          {m.autopilotSaveDeadlines}
        </button>
      </div>
      {message ? (
        <p role="status" className="af-ch-recipe-error">
          {message}
        </p>
      ) : null}
    </div>
  )
}
