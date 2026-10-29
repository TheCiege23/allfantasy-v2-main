'use client'

import { useCallback, useEffect, useState } from 'react'
import { LOCK_GROUPS, LOCK_GROUP_LABELS, VOTE_DAY_OPTIONS, DEFAULT_VOTE_DAYS, type LockGroup, type UnlockVote } from '@/lib/league/settingsLock'
import type { LockView } from '@/lib/league/settingsLockService'

const url = (leagueId: string) => `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/settings-lock`

type View = LockView & { canEdit: boolean }

function when(iso: string): string {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : iso
}

function voteLine(v: UnlockVote): string {
  const label = LOCK_GROUP_LABELS[v.group].label
  if (v.status === 'voting') return `${label}: vote open until ${when(v.closesAt)}`
  const tally = v.yes != null && v.no != null ? ` (${v.yes} yes, ${v.no} no)` : ''
  return `${label}: ${v.status === 'passed' ? 'unlocked by vote' : 'stayed locked'}${tally}`
}

/**
 * Settings lock (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §2.1, Free): lock areas of the league's rules
 * for the season. Once the season is under way a locked area changes only after a league vote, held
 * as a yes/no poll in league chat. Rules live server-side (lib/league/settingsLock).
 */
export function SettingsLockPanel({ leagueId }: { leagueId: string }) {
  const [view, setView] = useState<View | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [voteFor, setVoteFor] = useState<LockGroup | null>(null)
  const [days, setDays] = useState<number>(DEFAULT_VOTE_DAYS)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(url(leagueId), { credentials: 'include', cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as View & { error?: string }
      if (!res.ok) {
        setLoadError(data.error || 'Could not load the settings lock.')
        return
      }
      setView(data)
    } catch {
      setLoadError('Could not reach the server. Try again.')
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const send = async (method: 'PUT' | 'POST', body: Record<string, unknown>, success: string) => {
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const res = await fetch(url(leagueId), {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(data.error || 'That didn’t save. Try again.')
        return false
      }
      setOk(success)
      await load()
      return true
    } catch {
      setError('Could not reach the server. Try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <p className="lsh-error" role="alert">{loadError}</p>
  if (!view) return <p className="lsh-help" role="status">Loading the settings lock…</p>

  const locked = view.groups.filter((g) => g.locked).map((g) => g.group)
  const openVote = (g: LockGroup) => view.votes.find((v) => v.group === g && v.status === 'voting')

  const toggle = (g: LockGroup, on: boolean) => {
    const next = on ? [...locked, g] : locked.filter((x) => x !== g)
    void send('PUT', { groups: next }, on ? `${LOCK_GROUP_LABELS[g].label} locked for the season.` : `${LOCK_GROUP_LABELS[g].label} unlocked.`)
  }

  return (
    <div className="space-y-4" data-testid="settings-lock">
      <div className="lsh-field-card">
        <p className="lsh-help">
          Lock any area of your rules for the {view.season ?? 'current'} season. Nobody can change a locked area — commissioners included —
          {view.seasonUnderway
            ? ' and with the season under way it only unlocks if the league votes for it, in league chat. A yes vote opens it for 72 hours.'
            : ' and once your draft starts it only unlocks if the league votes for it. Until then you can unlock it yourself.'}
        </p>
      </div>

      <ul className="space-y-2">
        {LOCK_GROUPS.map((g) => {
          const row = view.groups.find((x) => x.group === g)!
          const vote = openVote(g)
          const removable = !view.seasonUnderway
          return (
            <li key={g} className="lsh-field-card" data-testid="settings-lock-row">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="lsh-field-label">{LOCK_GROUP_LABELS[g].label}</span>
                  <span className="lsh-help block">{LOCK_GROUP_LABELS[g].help}</span>
                </span>
                {view.canEdit ? (
                  <input
                    type="checkbox"
                    className="h-6 w-6 shrink-0"
                    checked={row.locked}
                    disabled={busy || (row.locked && !removable)}
                    onChange={(e) => toggle(g, e.target.checked)}
                    aria-label={`Lock ${LOCK_GROUP_LABELS[g].label.toLowerCase()} for the season`}
                  />
                ) : (
                  <span className="lsh-help shrink-0">{row.locked ? 'Locked' : 'Open'}</span>
                )}
              </div>
              {row.locked && row.unlockedUntil && (
                <p className="lsh-help" role="status">Unlocked by league vote until {when(row.unlockedUntil)}.</p>
              )}
              {row.locked && !row.unlockedUntil && vote && <p className="lsh-help">League vote open until {when(vote.closesAt)} — vote in league chat.</p>}
              {view.canEdit && row.locked && !removable && !row.unlockedUntil && !vote && (
                <button type="button" className="lsh-secondary mt-2" disabled={busy} onClick={() => { setVoteFor(g); setError(null); setOk(null) }}>
                  Ask the league to unlock
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {voteFor && (
        <div className="lsh-field-card" data-testid="settings-lock-vote-form">
          <p className="lsh-field-label">Unlock {LOCK_GROUP_LABELS[voteFor].label.toLowerCase()}?</p>
          <label className="lsh-help" htmlFor="settings-lock-days">Voting stays open for</label>
          <select id="settings-lock-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {VOTE_DAY_OPTIONS.map((d) => <option key={d} value={d}>{d} {d === 1 ? 'day' : 'days'}</option>)}
          </select>
          <label className="lsh-help" htmlFor="settings-lock-reason">Why (shows in league chat, optional)</label>
          <input id="settings-lock-reason" type="text" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2 pt-2">
            <button type="button" className="lsh-primary" disabled={busy}
              onClick={async () => {
                const done = await send('POST', { group: voteFor, days, reason }, 'Vote posted to league chat. A majority of votes cast unlocks it.')
                if (done) { setVoteFor(null); setReason('') }
              }}>
              {busy ? 'Posting…' : 'Post the vote'}
            </button>
            <button type="button" className="lsh-secondary" disabled={busy} onClick={() => setVoteFor(null)}>Cancel</button>
          </div>
        </div>
      )}

      {view.votes.length > 0 && (
        <div className="lsh-field-card">
          <p className="lsh-field-label">Votes this season</p>
          <ul className="space-y-1">
            {view.votes.map((v) => <li key={v.id} className="text-[13px]" data-testid="settings-lock-vote">{voteLine(v)}</li>)}
          </ul>
        </div>
      )}

      {error && <p className="lsh-error" role="alert">{error}</p>}
      {ok && <p className="lsh-ok" role="status">{ok}</p>}
    </div>
  )
}
