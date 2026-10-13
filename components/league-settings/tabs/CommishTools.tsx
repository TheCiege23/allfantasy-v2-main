'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { HubCard } from './hubFields'

type WaiverTeam = { rosterId: string; name: string; faabRemaining: number | null; waiverPriority: number | null }

/**
 * Edit Waiver: FAAB left and claim priority for every team. Commish or co-commish.
 * Edits are held locally and saved together, because priorities must stay a 1..N permutation —
 * swapping two teams is two edits that are only valid as a pair.
 */
export function EditWaiversCard({ leagueId }: { leagueId: string }) {
  const { t } = useLanguage()
  const [teams, setTeams] = useState<WaiverTeam[] | null>(null)
  const [budget, setBudget] = useState<number | null>(null)
  const [draft, setDraft] = useState<Record<string, { faab: string; priority: string }>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/commish-waivers`

  const apply = useCallback((data: { teams: WaiverTeam[]; faabBudget: number | null }) => {
    setTeams(data.teams)
    setBudget(data.faabBudget)
    setDraft(
      Object.fromEntries(
        data.teams.map((tm) => [tm.rosterId, { faab: String(tm.faabRemaining ?? ''), priority: String(tm.waiverPriority ?? '') }]),
      ),
    )
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(url, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => !cancelled && apply(d))
      .catch(() => !cancelled && setError(t('lsHub.ct.loadFailed')))
    return () => {
      cancelled = true
    }
  }, [url, apply, t])

  const changed = (teams ?? []).filter((tm) => {
    const d = draft[tm.rosterId]
    return d && (d.faab !== String(tm.faabRemaining ?? '') || d.priority !== String(tm.waiverPriority ?? ''))
  })

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const updates = changed.map((tm) => {
        const d = draft[tm.rosterId]!
        return {
          rosterId: tm.rosterId,
          ...(d.faab !== String(tm.faabRemaining ?? '') ? { faabRemaining: Number(d.faab) } : {}),
          ...(d.priority !== String(tm.waiverPriority ?? '') ? { waiverPriority: Number(d.priority) } : {}),
        }
      })
      const res = await fetch(url, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : t('lsHub.sp.saveFailed'))
        return
      }
      apply(data)
      toast.success(t('lsHub.ct.saved'))
    } catch {
      setError(t('lsHub.sp.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const input =
    'w-16 rounded-lg border border-white/[0.12] bg-black/30 px-2 py-1.5 text-center text-[13px] text-white outline-none focus:border-cyan-400/40'

  return (
    <HubCard title={t('lsHub.ct.waivers')} testId="commish-edit-waivers">
      <p className="text-[12px] text-white/50">{t('lsHub.ct.waiversHint')}</p>
      {teams == null ? (
        error ? <p className="text-[12px] text-red-300/85">{error}</p> : <div className="h-24 animate-pulse rounded-xl bg-white/[0.05]" />
      ) : (
        <>
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-2 text-[12px]">
            <span className="text-[11px] font-bold uppercase tracking-wide text-white/40">{t('lsHub.ct.team')}</span>
            <span className="w-16 text-center text-[11px] font-bold uppercase tracking-wide text-white/40">{t('lsHub.ct.priority')}</span>
            <span className="w-16 text-center text-[11px] font-bold uppercase tracking-wide text-white/40">FAAB</span>
            {teams.map((tm) => (
              <div key={tm.rosterId} className="contents">
                <span className="truncate text-[13px] text-white/85">{tm.name}</span>
                <input
                  inputMode="numeric"
                  aria-label={`${tm.name} ${t('lsHub.ct.priority')}`}
                  className={input}
                  value={draft[tm.rosterId]?.priority ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [tm.rosterId]: { ...d[tm.rosterId]!, priority: e.target.value.replace(/\D/g, '') } }))}
                />
                <input
                  inputMode="numeric"
                  aria-label={`${tm.name} FAAB`}
                  className={input}
                  value={draft[tm.rosterId]?.faab ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [tm.rosterId]: { ...d[tm.rosterId]!, faab: e.target.value.replace(/\D/g, '') } }))}
                />
              </div>
            ))}
          </div>
          {budget != null ? <p className="text-[11px] text-white/40">{t('lsHub.ct.budget').replace('{{n}}', String(budget))}</p> : null}
          {error ? <p className="text-[12px] text-amber-200/85" role="alert">{error}</p> : null}
          <button
            type="button"
            disabled={saving || changed.length === 0}
            onClick={() => void save()}
            className="rounded-lg bg-cyan-500/90 px-4 py-2 text-[12px] font-extrabold text-[#04131a] disabled:opacity-40"
            data-testid="commish-edit-waivers-save"
          >
            {saving ? t('lsHub.saving') : t('lsHub.ct.save')}
          </button>
        </>
      )}
    </HubCard>
  )
}

/** Hand the head-commish role to another manager. Head commish only (the route enforces it). */
export function TransferCommishCard({ leagueId }: { leagueId: string }) {
  const { t } = useLanguage()
  const router = useRouter()
  const [candidates, setCandidates] = useState<Array<{ userId: string; name: string }> | null>(null)
  const [pick, setPick] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const url = `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/transfer`

  useEffect(() => {
    let cancelled = false
    fetch(url, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { candidates: [] }))
      .then((d: { candidates?: Array<{ userId: string; name: string }> }) => !cancelled && setCandidates(d.candidates ?? []))
      .catch(() => !cancelled && setCandidates([]))
    return () => {
      cancelled = true
    }
  }, [url])

  const transfer = async () => {
    setBusy(true)
    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newCommissionerUserId: pick, confirm: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof data.error === 'string' ? data.error : t('lsHub.ct.transferFailed'))
        return
      }
      toast.success(t('lsHub.ct.transferred'))
      router.refresh()
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  const name = candidates?.find((c) => c.userId === pick)?.name ?? ''
  return (
    <HubCard title={t('lsHub.ct.transfer')} testId="commish-transfer">
      <p className="text-[12px] text-white/50">{t('lsHub.ct.transferHint')}</p>
      {candidates == null ? (
        <div className="h-10 animate-pulse rounded-xl bg-white/[0.05]" />
      ) : candidates.length === 0 ? (
        <p className="text-[12px] text-white/50">{t('lsHub.ct.noCandidates')}</p>
      ) : (
        <>
          <select
            value={pick}
            onChange={(e) => {
              setPick(e.target.value)
              setConfirming(false)
            }}
            className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2.5 text-sm text-white"
            data-testid="commish-transfer-select"
          >
            <option value="" className="bg-[#0d1117]">{t('lsHub.ct.choose')}</option>
            {candidates.map((c) => (
              <option key={c.userId} value={c.userId} className="bg-[#0d1117]">
                {c.name}
              </option>
            ))}
          </select>
          {confirming ? (
            <div className="rounded-xl border border-amber-300/25 bg-amber-950/25 p-3">
              <p className="text-[12px] text-amber-100/90">{t('lsHub.ct.transferConfirm').replace('{{name}}', name)}</p>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy} onClick={() => void transfer()} className="rounded-lg bg-amber-400/90 px-3.5 py-2 text-[12px] font-extrabold text-[#1a1204] disabled:opacity-50">
                  {t('lsHub.ct.transferButton')}
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded-lg px-3.5 py-2 text-[12px] font-semibold text-white/60">
                  {t('lsHub.sp.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={!pick}
              onClick={() => setConfirming(true)}
              className="rounded-lg border border-white/15 bg-white/[0.06] px-4 py-2 text-[12px] font-bold text-white/90 disabled:opacity-40"
            >
              {t('lsHub.ct.transferButton')}
            </button>
          )}
        </>
      )}
    </HubCard>
  )
}

/** Reset League: clears claims, transactions, standings and the draft session; keeps rosters and members. */
export function ResetLeagueCard({ leagueId, leagueName }: { leagueId: string; leagueName: string }) {
  const { t } = useLanguage()
  const [mode, setMode] = useState<'soft' | 'full'>('soft')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = typed.trim() === leagueName.trim()

  const reset = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/reset`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(typeof data.error === 'string' ? data.error : t('lsHub.ct.resetFailed'))
        return
      }
      toast.success(t('lsHub.ct.resetDone'))
      setTyped('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-orange-400/25 bg-orange-950/15 p-4" data-testid="commish-reset-league">
      <h3 className="text-[13px] font-bold uppercase tracking-wide text-orange-200">{t('lsHub.ct.reset')}</h3>
      <p className="mt-1.5 text-[12px] leading-relaxed text-white/60">{t('lsHub.ct.resetHint')}</p>
      <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('lsHub.ct.reset')}>
        {(['soft', 'full'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-full border px-3 py-1.5 text-[12px] font-semibold ${
              mode === m ? 'border-orange-300/60 bg-orange-500/15 text-orange-100' : 'border-white/[0.10] text-white/60'
            }`}
          >
            {t(m === 'soft' ? 'lsHub.ct.resetSoft' : 'lsHub.ct.resetFull')}
          </button>
        ))}
      </div>
      <label className="mt-3 block">
        <span className="mb-1 block text-[11px] text-white/50">{t('lsHub.ct.resetType').replace('{{name}}', leagueName)}</span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2 text-sm text-white"
          data-testid="commish-reset-confirm-input"
        />
      </label>
      <button
        type="button"
        disabled={!ready || busy}
        onClick={() => void reset()}
        className="mt-3 rounded-lg border border-orange-400/40 bg-orange-500/15 px-4 py-2 text-[12px] font-extrabold text-orange-100 disabled:opacity-40"
        data-testid="commish-reset-button"
      >
        {busy ? t('lsHub.saving') : t('lsHub.ct.resetButton')}
      </button>
    </section>
  )
}
