'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import type {
  LegacyFeederLeagueRow,
  SerializedMiniCommissionerAssignment,
  SerializedPendingLeagueSettingRequest,
} from '@/lib/tournament/tournamentPageData'

type Props = {
  tournamentId: string
  isCommissioner: boolean
  viewerUserId: string | null
  legacyFeederLeagues: LegacyFeederLeagueRow[] | undefined
  legacyMiniCommissioners: SerializedMiniCommissionerAssignment[] | undefined
  legacyPendingLeagueSettingRequests: SerializedPendingLeagueSettingRequest[] | undefined
  viewerMiniCommissionerLeagueIds: string[] | undefined
}

export function MiniCommissionerHub({
  tournamentId,
  isCommissioner,
  viewerUserId,
  legacyFeederLeagues,
  legacyMiniCommissioners,
  legacyPendingLeagueSettingRequests,
  viewerMiniCommissionerLeagueIds,
}: Props) {
  const { t, tInterpolate } = useLanguage()
  const router = useRouter()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [draftUserId, setDraftUserId] = useState<Record<string, string>>({})
  const [proposalLeagueId, setProposalLeagueId] = useState<string | null>(null)
  const [proposalJson, setProposalJson] = useState('{}')

  const refresh = useCallback(() => {
    router.refresh()
  }, [router])

  const byLeague = useMemo(() => {
    const m = new Map<string, SerializedMiniCommissionerAssignment>()
    for (const a of legacyMiniCommissioners ?? []) {
      m.set(a.leagueId, a)
    }
    return m
  }, [legacyMiniCommissioners])

  const assign = async (leagueId: string) => {
    const assigneeUserId = draftUserId[leagueId]?.trim()
    if (!assigneeUserId) {
      toast.error(t('tournament.miniComm.error.userId'))
      return
    }
    setBusyKey(`assign-${leagueId}`)
    try {
      const res = await fetch(`/api/tournament/${tournamentId}/mini-commissioners`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, assigneeUserId }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(data.error ?? t('tournament.miniComm.error.assign'))
        return
      }
      toast.success(t('tournament.miniComm.success.updated'))
      setDraftUserId((prev) => ({ ...prev, [leagueId]: '' }))
      refresh()
    } finally {
      setBusyKey(null)
    }
  }

  const removeAssignment = async (leagueId: string) => {
    setBusyKey(`rm-${leagueId}`)
    try {
      const res = await fetch(
        `/api/tournament/${tournamentId}/mini-commissioners?leagueId=${encodeURIComponent(leagueId)}`,
        { method: 'DELETE' },
      )
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(data.error ?? t('tournament.miniComm.error.remove'))
        return
      }
      toast.success(t('tournament.miniComm.success.removed'))
      refresh()
    } finally {
      setBusyKey(null)
    }
  }

  const resolveRequest = async (requestId: string, action: 'approve' | 'reject') => {
    setBusyKey(`req-${requestId}`)
    try {
      const res = await fetch(
        `/api/tournament/${tournamentId}/league-settings-request/${requestId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      )
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(data.error ?? t('tournament.miniComm.error.requestUpdate'))
        return
      }
      toast.success(
        action === 'approve' ? t('tournament.miniComm.success.approved') : t('tournament.miniComm.success.rejected'),
      )
      refresh()
    } finally {
      setBusyKey(null)
    }
  }

  const submitProposal = async (leagueId: string) => {
    let proposedPatch: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(proposalJson)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        toast.error(t('tournament.miniComm.error.patchObject'))
        return
      }
      proposedPatch = parsed as Record<string, unknown>
    } catch {
      toast.error(t('tournament.miniComm.error.invalidJson'))
      return
    }
    setBusyKey(`prop-${leagueId}`)
    try {
      const res = await fetch(`/api/tournament/${tournamentId}/league-settings-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, proposedPatch }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(data.error ?? t('tournament.miniComm.error.submit'))
        return
      }
      toast.success(t('tournament.miniComm.success.sent'))
      setProposalJson('{}')
      refresh()
    } finally {
      setBusyKey(null)
    }
  }

  const showMainComm =
    isCommissioner &&
    ((legacyFeederLeagues && legacyFeederLeagues.length > 0) ||
      (legacyPendingLeagueSettingRequests && legacyPendingLeagueSettingRequests.length > 0))
  const miniLeagueIds = viewerMiniCommissionerLeagueIds ?? []
  const showMini =
    Boolean(viewerUserId) &&
    !isCommissioner &&
    miniLeagueIds.length > 0 &&
    legacyFeederLeagues &&
    legacyFeederLeagues.length > 0

  if (!showMainComm && !showMini) return null

  return (
    <div className="space-y-4">
      {showMainComm ? (
        <div className="rounded-2xl border border-white/[0.1] bg-[#080e18] p-4">
          <h2 className="text-[13px] font-bold uppercase tracking-wide text-cyan-100/90">
            {t('tournament.miniComm.main.title')}
          </h2>
          <p className="mt-1 text-[11px] leading-snug text-white/45">{t('tournament.miniComm.main.body')}</p>

          {legacyPendingLeagueSettingRequests && legacyPendingLeagueSettingRequests.length > 0 ? (
            <div className="mt-4 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/90">
                {t('tournament.miniComm.pendingTitle')}
              </p>
              <ul className="space-y-2">
                {legacyPendingLeagueSettingRequests.map((req) => (
                  <li
                    key={req.id}
                    className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[12px]"
                  >
                    <p className="font-medium text-white">{req.leagueName}</p>
                    <p className="text-[11px] text-white/55">
                      {tInterpolate('tournament.miniComm.fromLine', {
                        name: req.requesterDisplayName,
                        when: new Date(req.createdAt).toLocaleString(),
                      })}
                    </p>
                    {req.proposedPatchKeys.length > 0 ? (
                      <p className="mt-1 text-[11px] text-white/40">
                        {tInterpolate('tournament.miniComm.keysLabel', {
                          keys: req.proposedPatchKeys.join(', '),
                        })}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() => void resolveRequest(req.id, 'approve')}
                        className="rounded-lg bg-cyan-500/25 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/35 disabled:opacity-50"
                        data-testid={`mini-comm-approve-${req.id}`}
                      >
                        {t('tournament.miniComm.approve')}
                      </button>
                      <button
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() => void resolveRequest(req.id, 'reject')}
                        className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-white/70 hover:bg-white/5 disabled:opacity-50"
                        data-testid={`mini-comm-reject-${req.id}`}
                      >
                        {t('tournament.miniComm.reject')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <ul className="mt-4 space-y-3">
            {(legacyFeederLeagues ?? []).map((row) => {
              const cur = byLeague.get(row.leagueId)
              return (
                <li
                  key={row.tournamentLeagueId}
                  className="rounded-xl border border-white/[0.08] bg-black/30 px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-[13px] font-semibold text-white">{row.name}</p>
                      <p className="text-[11px] text-white/40">{row.conferenceName}</p>
                    </div>
                    {cur ? (
                      <div className="text-right text-[11px] text-white/70">
                        <span className="text-white/45">{t('tournament.miniComm.deputyLabel')}</span>
                        {cur.displayName}
                        <span className="ml-1 font-mono text-[11px] text-white/35">({cur.userId.slice(0, 8)}…)</span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-white/40">{t('tournament.miniComm.unassigned')}</span>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <label className="flex min-w-[200px] flex-1 flex-col gap-1">
                      <span className="text-[11px] uppercase text-white/40">{t('tournament.miniComm.userIdLabel')}</span>
                      <input
                        value={draftUserId[row.leagueId] ?? ''}
                        onChange={(e) =>
                          setDraftUserId((prev) => ({ ...prev, [row.leagueId]: e.target.value }))
                        }
                        className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-[11px] text-white"
                        placeholder={t('tournament.miniComm.placeholderUserId')}
                        data-testid={`mini-comm-user-input-${row.leagueId}`}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={busyKey !== null}
                      onClick={() => void assign(row.leagueId)}
                      className="rounded-lg bg-cyan-500/20 px-3 py-2 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
                      data-testid={`mini-comm-assign-${row.leagueId}`}
                    >
                      {t('tournament.miniComm.assignUpdate')}
                    </button>
                    {cur ? (
                      <button
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() => void removeAssignment(row.leagueId)}
                        className="rounded-lg border border-red-500/30 px-3 py-2 text-[11px] font-semibold text-red-200/90 hover:bg-red-500/10 disabled:opacity-50"
                        data-testid={`mini-comm-remove-${row.leagueId}`}
                      >
                        {t('tournament.miniComm.remove')}
                      </button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {showMini ? (
        <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-[#081226] to-[#0c1020] p-4">
          <h2 className="text-[13px] font-bold uppercase tracking-wide text-cyan-100/95">
            {t('tournament.miniComm.deputyLeague.title')}
          </h2>
          <p className="mt-1 text-[11px] text-white/50">{t('tournament.miniComm.deputyLeague.body')}</p>
          <ul className="mt-3 space-y-3">
            {legacyFeederLeagues
              .filter((l) => miniLeagueIds.includes(l.leagueId))
              .map((row) => (
                <li key={row.tournamentLeagueId} className="rounded-xl border border-white/[0.08] bg-black/25 px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[14px] font-semibold text-white">{row.name}</p>
                    <Link
                      href={`/league/${row.leagueId}`}
                      className="text-[11px] font-semibold text-cyan-300 hover:underline"
                    >
                      {t('tournament.miniComm.openLeague')}
                    </Link>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setProposalLeagueId((id) => (id === row.leagueId ? null : row.leagueId))
                    }}
                    className="mt-2 text-[11px] font-semibold text-cyan-200/90 hover:underline"
                    data-testid={`mini-comm-toggle-proposal-${row.leagueId}`}
                  >
                    {proposalLeagueId === row.leagueId
                      ? t('tournament.miniComm.hideProposal')
                      : t('tournament.miniComm.proposeChange')}
                  </button>
                  {proposalLeagueId === row.leagueId ? (
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={proposalJson}
                        onChange={(e) => setProposalJson(e.target.value)}
                        rows={5}
                        className="w-full rounded-lg border border-white/10 bg-black/50 p-2 font-mono text-[11px] text-white"
                        spellCheck={false}
                        data-testid={`mini-comm-proposal-json-${row.leagueId}`}
                      />
                      <button
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() => void submitProposal(row.leagueId)}
                        className="rounded-lg bg-cyan-500/25 px-3 py-2 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/35 disabled:opacity-50"
                        data-testid={`mini-comm-submit-proposal-${row.leagueId}`}
                      >
                        {t('tournament.miniComm.submitApproval')}
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
