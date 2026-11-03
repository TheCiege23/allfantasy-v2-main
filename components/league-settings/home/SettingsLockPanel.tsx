'use client'

import { useCallback, useEffect, useState } from 'react'
import { LOCK_GROUPS, VOTE_DAY_OPTIONS, DEFAULT_VOTE_DAYS, type LockGroup, type UnlockVote } from '@/lib/league/settingsLock'
import type { LockView } from '@/lib/league/settingsLockService'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { LOCK_AREA_COPY, lockCopy, lockErrorCopy, lockLang, type LockLang } from '@/lib/i18n/settings-lock-copy'

const url = (leagueId: string) => `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/settings-lock`

type View = LockView & { canEdit: boolean }

function when(iso: string, lang: LockLang): string {
  const d = new Date(iso)
  return Number.isFinite(d.getTime())
    ? d.toLocaleString(lang === 'es' ? 'es' : undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : iso
}

const area = (g: LockGroup, lang: LockLang) => LOCK_AREA_COPY[g][lang]

function voteLine(v: UnlockVote, lang: LockLang): string {
  const label = area(v.group, lang).label
  if (v.status === 'voting') return lockCopy(lang, 'voteOpen', { area: label, when: when(v.closesAt, lang) })
  const tally = v.yes != null && v.no != null ? lockCopy(lang, 'tally', { yes: v.yes, no: v.no }) : ''
  return lockCopy(lang, v.status === 'passed' ? 'votePassed' : 'voteFailed', { area: label }) + tally
}

/**
 * Settings lock (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §2.1, Free): lock areas of the league's rules
 * for the season. Once the season is under way a locked area changes only after a league vote, held
 * as a yes/no poll in league chat. Rules live server-side (lib/league/settingsLock).
 */
export function SettingsLockPanel({ leagueId }: { leagueId: string }) {
  const lang = lockLang(useOptionalLanguage().language)
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
        setLoadError(lockCopy(lang, 'loadFailed'))
        return
      }
      setView(data)
    } catch {
      setLoadError(lockCopy(lang, 'offline'))
    }
  }, [leagueId, lang])

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
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
      if (!res.ok) {
        // A refusal the route names by code reads in the viewer's language; any other keeps the server's words.
        setError(lockErrorCopy(lang, data.code) ?? (lang === 'es' ? lockCopy(lang, 'saveFailed') : data.error || lockCopy(lang, 'saveFailed')))
        return false
      }
      setOk(success)
      await load()
      return true
    } catch {
      setError(lockCopy(lang, 'offline'))
      return false
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <p className="lsh-error" role="alert">{loadError}</p>
  if (!view) return <p className="lsh-help" role="status">{lockCopy(lang, 'loading')}</p>

  const locked = view.groups.filter((g) => g.locked).map((g) => g.group)
  const openVote = (g: LockGroup) => view.votes.find((v) => v.group === g && v.status === 'voting')

  const toggle = (g: LockGroup, on: boolean) => {
    const next = on ? [...locked, g] : locked.filter((x) => x !== g)
    void send('PUT', { groups: next }, lockCopy(lang, on ? 'lockedDone' : 'unlockedDone', { area: area(g, lang).label }))
  }

  return (
    <div className="space-y-4" data-testid="settings-lock">
      <div className="lsh-field-card">
        <p className="lsh-help">
          {lockCopy(lang, 'intro', { season: view.season ?? lockCopy(lang, 'currentSeason') })}
          {lockCopy(lang, view.seasonUnderway ? 'introUnderway' : 'introBefore')}
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
                  <span className="lsh-field-label">{area(g, lang).label}</span>
                  <span className="lsh-help block">{area(g, lang).help}</span>
                </span>
                {view.canEdit ? (
                  <input
                    type="checkbox"
                    className="h-6 w-6 shrink-0"
                    checked={row.locked}
                    disabled={busy || (row.locked && !removable)}
                    onChange={(e) => toggle(g, e.target.checked)}
                    aria-label={lockCopy(lang, 'lockAria', { area: area(g, lang).label.toLowerCase() })}
                  />
                ) : (
                  <span className="lsh-help shrink-0">{lockCopy(lang, row.locked ? 'locked' : 'open')}</span>
                )}
              </div>
              {row.locked && row.unlockedUntil && (
                <p className="lsh-help" role="status">{lockCopy(lang, 'unlockedUntil', { when: when(row.unlockedUntil, lang) })}</p>
              )}
              {row.locked && !row.unlockedUntil && vote && <p className="lsh-help">{lockCopy(lang, 'voteOpenRow', { when: when(vote.closesAt, lang) })}</p>}
              {view.canEdit && row.locked && !removable && !row.unlockedUntil && !vote && (
                <button type="button" className="lsh-secondary mt-2" disabled={busy} onClick={() => { setVoteFor(g); setError(null); setOk(null) }}>
                  {lockCopy(lang, 'askUnlock')}
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {voteFor && (
        <div className="lsh-field-card" data-testid="settings-lock-vote-form">
          <p className="lsh-field-label">{lockCopy(lang, 'unlockQuestion', { area: area(voteFor, lang).label.toLowerCase() })}</p>
          <label className="lsh-help" htmlFor="settings-lock-days">{lockCopy(lang, 'voteDays')}</label>
          <select id="settings-lock-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {VOTE_DAY_OPTIONS.map((d) => <option key={d} value={d}>{lockCopy(lang, d === 1 ? 'day' : 'days', { n: d })}</option>)}
          </select>
          <label className="lsh-help" htmlFor="settings-lock-reason">{lockCopy(lang, 'reason')}</label>
          <input id="settings-lock-reason" type="text" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2 pt-2">
            <button type="button" className="lsh-primary" disabled={busy}
              onClick={async () => {
                const done = await send('POST', { group: voteFor, days, reason }, lockCopy(lang, 'votePosted'))
                if (done) { setVoteFor(null); setReason('') }
              }}>
              {lockCopy(lang, busy ? 'posting' : 'postVote')}
            </button>
            <button type="button" className="lsh-secondary" disabled={busy} onClick={() => setVoteFor(null)}>{lockCopy(lang, 'cancel')}</button>
          </div>
        </div>
      )}

      {view.votes.length > 0 && (
        <div className="lsh-field-card">
          <p className="lsh-field-label">{lockCopy(lang, 'votesThisSeason')}</p>
          <ul className="space-y-1">
            {view.votes.map((v) => <li key={v.id} className="text-[13px]" data-testid="settings-lock-vote">{voteLine(v, lang)}</li>)}
          </ul>
        </div>
      )}

      {error && <p className="lsh-error" role="alert">{error}</p>}
      {ok && <p className="lsh-ok" role="status">{ok}</p>}
    </div>
  )
}
