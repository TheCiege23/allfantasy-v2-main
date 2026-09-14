'use client'

import { useState } from 'react'
import {
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationCategoryId,
  type NotificationPreferences,
} from '@/lib/notification-settings/types'
import { rowMuteEdit, type LeagueOverridePatch, type RowMute } from '@/lib/core-app/notificationMutes'

/**
 * The "Mute" control on a Core notification row (user decision, 2026-09-14).
 *
 * 🛑 NOTHING IS WRITTEN UNLESS THE CURRENT SETTINGS WERE READ. The edit is built on the
 * league's stored entry; if that read fails, building on `{}` would replace a league's
 * existing mutes with this one. So a failed read is an error on screen, never a save.
 *
 * Mutes stop FUTURE notifications from that league (in-app, push, email and SMS — the
 * dispatcher and pushGate both read them). Rows already in the list stay; they are a log.
 */

type Props = {
  leagueId: string
  leagueName: string | null
  category: NotificationCategoryId | null
}

type State =
  | { status: 'idle'; open: boolean }
  | { status: 'saving' }
  | { status: 'muted'; sentence: string; undo: LeagueOverridePatch }
  | { status: 'error' }

async function readStoredPreferences(): Promise<NotificationPreferences | null | 'failed'> {
  const res = await fetch('/api/user/profile', { cache: 'no-store' }).catch(() => null)
  if (!res?.ok) return 'failed'
  const data = (await res.json().catch(() => null)) as { notificationPreferences?: unknown } | null
  if (!data) return 'failed'
  const raw = data.notificationPreferences
  return raw && typeof raw === 'object' ? (raw as NotificationPreferences) : null
}

async function savePatch(patch: LeagueOverridePatch): Promise<boolean> {
  const res = await fetch('/api/user/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notificationPreferences: patch }),
  }).catch(() => null)
  return !!res?.ok
}

export function NotificationRowMute({ leagueId, leagueName, category }: Props) {
  const [state, setState] = useState<State>({ status: 'idle', open: false })
  const where = leagueName ?? 'this league'

  async function apply(mute: RowMute, sentence: string) {
    setState({ status: 'saving' })
    const stored = await readStoredPreferences()
    if (stored === 'failed') {
      setState({ status: 'error' })
      return
    }
    const { patch, undo } = rowMuteEdit(stored, leagueId, mute)
    setState((await savePatch(patch)) ? { status: 'muted', sentence, undo } : { status: 'error' })
  }

  async function revert(undo: LeagueOverridePatch) {
    setState({ status: 'saving' })
    setState((await savePatch(undo)) ? { status: 'idle', open: false } : { status: 'error' })
  }

  if (state.status === 'muted') {
    return (
      <span className="af-nt-mute" data-state="muted">
        <span className="af-nt-mute-done" title={state.sentence}>
          Muted
        </span>
        <span className="af-sr-only" role="status">
          {state.sentence}
        </span>
        <button type="button" className="af-nt-mute-undo" onClick={() => revert(state.undo)}>
          Undo
        </button>
      </span>
    )
  }

  if (state.status === 'error') {
    return (
      <span className="af-nt-mute" data-state="error">
        <button type="button" className="af-nt-mute-btn" onClick={() => setState({ status: 'idle', open: true })}>
          Not saved · retry
        </button>
      </span>
    )
  }

  const open = state.status === 'idle' && state.open
  const label = category ? NOTIFICATION_CATEGORY_LABELS[category] : null

  return (
    <span className="af-nt-mute">
      <button
        type="button"
        className="af-nt-mute-btn"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={state.status === 'saving'}
        onClick={() => setState({ status: 'idle', open: !open })}
      >
        {state.status === 'saving' ? 'Saving…' : 'Mute'}
      </button>
      {open ? (
        <span className="af-nt-mute-menu" role="menu" aria-label={`Mute notifications from ${where}`}>
          {category && label ? (
            <button
              type="button"
              role="menuitem"
              className="af-nt-mute-item"
              onClick={() =>
                apply({ kind: 'category', category }, `You won't get ${label.toLowerCase()} from ${where}.`)
              }
            >
              {label} from {where}
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="af-nt-mute-item"
            onClick={() => apply({ kind: 'league' }, `You won't get notifications from ${where}.`)}
          >
            Everything from {where}
          </button>
        </span>
      ) : null}
    </span>
  )
}

export default NotificationRowMute
