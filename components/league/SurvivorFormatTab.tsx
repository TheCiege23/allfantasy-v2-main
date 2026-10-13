'use client'

import { useEffect, useState } from 'react'
import { SurvivorTribesPanel } from '@/app/league/[leagueId]/components/settings/survivor/SurvivorTribesPanel'
import { SurvivorTribalCouncilPanel, type TribalCouncilView } from './survivor/SurvivorTribalCouncilPanel'

type FoundationState = {
  settings?: {
    defaultTeamCount: number
    minTeamCount: number
    maxTeamCount: number
    tribeCount: number
    commissionerParticipationMode: 'non_participating_host' | 'participating_player'
    mergeTriggerType: string
    mergeWeek: number
    mergeActivePlayerCount: number
    idolsEnabled: boolean
    powerupsEnabled: boolean
    exileIslandEnabled: boolean
    exileReturnWeek: number
    exileReturnTokens: number
  }
  access?: {
    isCommissioner?: boolean
    isCommissionerParticipating: boolean
    isNonParticipatingCommissionerHost: boolean
    isParticipant?: boolean
    privacyWarnings: string[]
    decisions?: {
      canPerformAdminAction?: boolean
      canPerformSensitiveHostAction?: boolean
      canSeeHiddenIdolAssignments?: boolean
      canSeeVoteTallyBeforeReveal?: boolean
      canOverrideVoteDeadline?: boolean
    }
  }
  tribes?: Array<{ id: string; name: string }>
  tribalCouncil?: TribalCouncilView
  initialization?: {
    tribesAssigned: boolean
    tribeCount: number
    chatsProvisioned: boolean
    tribeChatCount: number
    idolsSeeded: boolean
    voteShieldCount: number
    introPosted: boolean
    phase2Complete: boolean
  }
  dashboard?: {
    castSize: number
    activePlayers: number
    eliminatedPlayers: number
    exilePlayers: number
    juryPlayers: number
    finalistPlayers: number
    activeTribeCount: number
    mergeTriggered: boolean
  }
  voteWindow?: {
    status: string
    ownVoteSubmitted: boolean
    visibleVoteCount: number | null
    totalVoteCount: number | null
  }
  pendingFoundationWarnings?: string[]
}

type SurvivorFormatTabProps = {
  leagueId: string
  hasAfCommissionerSub?: boolean
  initialIdolExpiryWeek?: number | null
  onSave?: (values: { survivorIdolExpiryWeek: number | null }) => Promise<void> | void
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium uppercase tracking-wide text-neutral-400">{children}</label>
}

export function SurvivorFormatTab({ leagueId }: SurvivorFormatTabProps) {
  const [state, setState] = useState<FoundationState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [exileEnabled, setExileEnabled] = useState(true)
  const [returnWeek, setReturnWeek] = useState('10')
  const [returnTokens, setReturnTokens] = useState('4')
  const [hostMode, setHostMode] = useState<'non_participating_host' | 'participating_player'>('non_participating_host')

  useEffect(() => {
    if (!leagueId) return
    setLoading(true)
    fetch(`/api/leagues/${leagueId}/survivor/state`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Could not load Survivor foundation'))))
      .then((json: FoundationState) => {
        setState(json)
        if (json.settings) {
          setExileEnabled(json.settings.exileIslandEnabled)
          setReturnWeek(String(json.settings.exileReturnWeek))
          setReturnTokens(String(json.settings.exileReturnTokens))
          setHostMode(json.settings.commissionerParticipationMode)
        }
      })
      .catch((err) => setStatus(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [leagueId])

  async function saveFoundation() {
    setSaving(true)
    setStatus(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/survivor/update-settings`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            commissionerParticipationMode: hostMode,
            exileIslandEnabled: exileEnabled,
            exileReturnWeek: Number(returnWeek),
            exileReturnTokens: Number(returnTokens),
          },
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      setStatus('Saved.')
      const fresh = await fetch(`/api/leagues/${leagueId}/survivor/state`, { credentials: 'include' })
      if (fresh.ok) setState((await fresh.json()) as FoundationState)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const warnings = [
    ...(state?.access?.privacyWarnings ?? []),
    ...(state?.pendingFoundationWarnings ?? []),
  ]

  const canAdmin = Boolean(state?.access?.decisions?.canPerformAdminAction)
  const init = state?.initialization

  async function refresh() {
    const fresh = await fetch(`/api/leagues/${leagueId}/survivor/state`, { credentials: 'include' })
    if (fresh.ok) setState((await fresh.json()) as FoundationState)
  }

  async function runPhase2Action(action: string, body: Record<string, unknown> = {}) {
    setSaving(true)
    setStatus(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/survivor/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? json.code ?? `${action} failed`)
      setStatus(`${action}: ok`)
      const fresh = await fetch(`/api/leagues/${leagueId}/survivor/state`, { credentials: 'include' })
      if (fresh.ok) setState((await fresh.json()) as FoundationState)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  function StatusPill({ done, label }: { done: boolean; label: string }) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium ${
          done ? 'bg-emerald-500/15 text-emerald-200' : 'bg-neutral-800 text-neutral-400'
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${done ? 'bg-emerald-400' : 'bg-neutral-500'}`} />
        {label}
      </span>
    )
  }

  return (
    <div className="space-y-5 p-4 text-neutral-100">
      {warnings.length > 0 ? (
        <div className="rounded border border-amber-500/30 bg-amber-950/30 p-3 text-xs leading-relaxed text-amber-100">
          {warnings[0]}
        </div>
      ) : null}

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Survivor Foundation</h3>
          <p className="mt-1 text-xs text-neutral-400">
            Set league rules and commissioner privacy. Tribe choices lock when drafting starts.
          </p>
        </div>

        <SurvivorTribesPanel leagueId={leagueId} canEdit={canAdmin} hasAfCommissionerSub={false} />

        <div>
          <FieldLabel>Commissioner privacy</FieldLabel>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={state?.access?.isParticipant}
              onClick={() => setHostMode('non_participating_host')}
              className={`rounded border px-3 py-2 text-left text-sm ${
                hostMode === 'non_participating_host'
                  ? 'border-sky-400 bg-sky-500/15 text-sky-100'
                  : 'border-neutral-800 bg-neutral-950 text-neutral-300'
              }`}
            >
              Non-playing host
            </button>
            <button
              type="button"
              onClick={() => setHostMode('participating_player')}
              className={`rounded border px-3 py-2 text-left text-sm ${
                hostMode === 'participating_player'
                  ? 'border-amber-400 bg-amber-500/15 text-amber-100'
                  : 'border-neutral-800 bg-neutral-950 text-neutral-300'
              }`}
            >
              Playing commissioner
            </button>
          </div>
        </div>

        <fieldset className="space-y-3 rounded-xl border border-violet-500/25 p-4">
          <legend className="px-2 text-sm text-violet-200">Exile Island</legend>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={exileEnabled} onChange={e => setExileEnabled(e.target.checked)} />Enable Exile for voted-out managers</label>
          <p className="text-xs text-neutral-400">Managers earn tokens on Exile. After the return week is finalized, the system selects one qualifying manager to return. Ties use lifetime tokens, longest stay, then manager ID.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-neutral-300">Return week<input type="number" min={2} max={51} value={returnWeek} onChange={e => setReturnWeek(e.target.value)} className="mt-1 block w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-2 text-sm" /></label>
            <label className="text-xs text-neutral-300">Minimum tokens<input type="number" min={1} max={1000} value={returnTokens} onChange={e => setReturnTokens(e.target.value)} className="mt-1 block w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-2 text-sm" /></label>
          </div>
          <p className="text-xs text-neutral-500">Configure Exile before the draft. The returning manager rebuilds their released roster through waivers.</p>
        </fieldset>

        <button
          type="button"
          disabled={saving || loading}
          onClick={saveFoundation}
          className="rounded bg-orange-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Save foundation'}
        </button>
        {status ? <p className="text-xs text-neutral-400">{status}</p> : null}
      </section>

      <section className="space-y-3 border-t border-neutral-800 pt-4">
        <h3 className="text-sm font-semibold text-white">State Dashboard</h3>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded border border-neutral-800 bg-neutral-950 p-3">
            <div className="text-neutral-500">Cast</div>
            <div className="mt-1 text-lg font-semibold">{state?.dashboard?.castSize ?? '-'}</div>
          </div>
          <div className="rounded border border-neutral-800 bg-neutral-950 p-3">
            <div className="text-neutral-500">Active</div>
            <div className="mt-1 text-lg font-semibold">{state?.dashboard?.activePlayers ?? '-'}</div>
          </div>
          <div className="rounded border border-neutral-800 bg-neutral-950 p-3">
            <div className="text-neutral-500">Tribes</div>
            <div className="mt-1 text-lg font-semibold">{state?.dashboard?.activeTribeCount ?? '-'}</div>
          </div>
          <div className="rounded border border-neutral-800 bg-neutral-950 p-3">
            <div className="text-neutral-500">Vote</div>
            <div className="mt-1 text-sm font-semibold">{state?.voteWindow?.status ?? 'not_started'}</div>
          </div>
        </div>
      </section>

      {canAdmin ? (
        <section className="space-y-3 border-t border-neutral-800 pt-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Phase 2 — Tribes, Chats & Idols</h3>
            <p className="mt-1 text-xs text-neutral-400">
              Assign tribes, open tribe chats, seed hidden Vote Shield idols, and post the host intro. Every step is
              idempotent — re-running will not duplicate. Idol owners stay hidden from participating commissioners.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <StatusPill done={Boolean(init?.tribesAssigned)} label={`Tribes${init?.tribeCount ? ` (${init.tribeCount})` : ''}`} />
            <StatusPill done={Boolean(init?.chatsProvisioned)} label={`Chats${init?.tribeChatCount ? ` (${init.tribeChatCount})` : ''}`} />
            <StatusPill done={Boolean(init?.idolsSeeded)} label={`Idols${init?.voteShieldCount ? ` (${init.voteShieldCount})` : ''}`} />
            <StatusPill done={Boolean(init?.introPosted)} label="Intro" />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving || loading}
              onClick={() => runPhase2Action('initialize-survivor')}
              className="rounded bg-orange-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {init?.phase2Complete ? 'Re-run initialization' : 'Initialize Survivor'}
            </button>
            {state?.access?.decisions?.canPerformSensitiveHostAction ? <button
              type="button"
              disabled={saving || loading}
              onClick={() => runPhase2Action('assign-tribes')}
              className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 disabled:opacity-60"
            >
              Assign tribes
            </button> : null}
            <button
              type="button"
              disabled={saving || loading}
              onClick={() => runPhase2Action('create-tribe-chats')}
              className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 disabled:opacity-60"
            >
              Create chats
            </button>
            {state?.access?.decisions?.canPerformSensitiveHostAction ? <button
              type="button"
              disabled={saving || loading}
              onClick={() => runPhase2Action('seed-idols')}
              className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 disabled:opacity-60"
            >
              Seed idols
            </button> : null}
            <button
              type="button"
              disabled={saving || loading}
              onClick={() => runPhase2Action('post-intro')}
              className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 disabled:opacity-60"
            >
              Post intro
            </button>
          </div>

          {init && state?.access?.decisions?.canSeeHiddenIdolAssignments ? (
            <p className="text-[11px] text-neutral-500">
              Hidden idol inventory is visible to you as a non-playing host. Playing commissioners never see idol owners.
            </p>
          ) : null}
        </section>
      ) : null}

      {state?.tribalCouncil ? (
        <SurvivorTribalCouncilPanel
          leagueId={leagueId}
          council={state.tribalCouncil}
          access={{
            canPerformAdminAction: state.access?.decisions?.canPerformAdminAction,
            isCommissionerParticipating: state.access?.isCommissionerParticipating,
            isParticipant: state.access?.isParticipant,
          }}
          tribes={state.tribes ?? []}
          onRefresh={() => {
            void refresh()
          }}
        />
      ) : null}
    </div>
  )
}

export default SurvivorFormatTab
