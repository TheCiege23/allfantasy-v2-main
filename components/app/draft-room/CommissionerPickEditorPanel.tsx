/**
 * Commissioner Pick Editor (Slice 2 frontend).
 *
 * Lets a commissioner correct any pick on a paused draft via
 * POST /draft/commissioner/pick-edit (remove / replace / assign / change owner
 * without renumbering; empty rows use the Slice 1B empty-pick model).
 *
 * Caller is responsible for:
 *   - hiding this panel for non-commissioners
 *   - merging the returned snapshot back into draft state via onSnapshotUpdated
 */

'use client'

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react'

import {
  CommissionerPickEditClientError,
  commissionerPickEditClient,
  type CommissionerPickEditClientParams,
} from '@/lib/live-draft-engine/commissioner/clientCommissionerPickEdit'
import type { CommissionerPickEditAction } from '@/lib/live-draft-engine/commissioner/commissionerPickEditService'
import { isDraftPickRowEmptyFromSnapshot } from '@/lib/live-draft-engine/draftPickEmpty'
import type { DraftSessionSnapshot, SlotOrderEntry, DraftPickSnapshot } from '@/lib/live-draft-engine/types'

export interface CommissionerPickEditorPlayerOption {
  id: string
  name: string
  position: string
  team?: string | null
  byeWeek?: number | null
  imageUrl?: string | null
}

export interface CommissionerPickEditorPanelProps {
  leagueId: string
  session: DraftSessionSnapshot | null
  /** Players selectable for replace/assign. Caller filters to undrafted entries. */
  players: CommissionerPickEditorPlayerOption[]
  onSnapshotUpdated: (next: DraftSessionSnapshot) => void
  className?: string
  /**
   * When set to a new number (e.g. via board-cell edit affordance), prefills the
   * overall pick input. The commissioner can still type over it; only a *new*
   * value (different from the last consumed one) re-applies the prefill.
   */
  selectedOverall?: number | null
  /** Called once after a `selectedOverall` value has been applied to the form. */
  onSelectedOverallConsumed?: () => void
}

const ACTION_LABEL: Record<CommissionerPickEditAction, string> = {
  REMOVE_PLAYER_FROM_PICK: 'Remove player',
  REPLACE_PLAYER_ON_PICK: 'Replace player',
  ASSIGN_PLAYER_TO_PICK: 'Assign player',
  CHANGE_PICK_OWNER: 'Change pick owner',
}

const ACTIONS: CommissionerPickEditAction[] = [
  'REMOVE_PLAYER_FROM_PICK',
  'REPLACE_PLAYER_ON_PICK',
  'ASSIGN_PLAYER_TO_PICK',
  'CHANGE_PICK_OWNER',
]

interface FormState {
  action: CommissionerPickEditAction
  overall: string
  playerId: string
  /** G.2 — typed query for the embedded player search (Replace / Assign actions). */
  playerSearch: string
  rosterId: string
  reason: string
  force: boolean
}

const INITIAL_FORM: FormState = {
  action: 'REMOVE_PLAYER_FROM_PICK',
  overall: '',
  playerId: '',
  playerSearch: '',
  rosterId: '',
  reason: '',
  force: false,
}

function pickByOverall(picks: DraftPickSnapshot[] | undefined, overall: number): DraftPickSnapshot | undefined {
  return picks?.find((p) => p.overall === overall)
}

function isPickEmpty(pick: DraftPickSnapshot | undefined): boolean {
  if (!pick) return true
  return isDraftPickRowEmptyFromSnapshot({
    playerName: pick.playerName,
    position: pick.position,
    pickMetadata: (pick as { pickMetadata?: unknown }).pickMetadata,
    pickEditorEmpty: pick.pickEditorEmpty,
  })
}

export function CommissionerPickEditorPanel(props: CommissionerPickEditorPanelProps) {
  const { leagueId, session, players, onSnapshotUpdated, className, selectedOverall, onSelectedOverallConsumed } = props
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<{ message: string; lastParams: CommissionerPickEditClientParams } | null>(null)
  /** Slice 2 — separate state for the self-benefit confirm prompt so the
   * roster-eligibility warning UI can keep its existing "Force anyway" CTA
   * without competing with the self-benefit confirm CTA. */
  const [selfBenefit, setSelfBenefit] = useState<{ message: string; lastParams: CommissionerPickEditClientParams } | null>(null)
  const lastConsumedOverallRef = useRef<number | null>(null)

  // Apply prefill from parent (e.g. board-cell edit click). Only re-applies on a
  // genuinely new value so the commissioner can override locally without being
  // clobbered on every re-render.
  useEffect(() => {
    if (selectedOverall == null || !Number.isFinite(selectedOverall)) return
    if (lastConsumedOverallRef.current === selectedOverall) return
    lastConsumedOverallRef.current = selectedOverall
    setForm((prev) => ({ ...prev, overall: String(Math.floor(selectedOverall)) }))
    setError(null)
    setWarning(null)
    setSuccess(null)
    onSelectedOverallConsumed?.()
  }, [selectedOverall, onSelectedOverallConsumed])

  const slotOrder: SlotOrderEntry[] = useMemo(() => session?.slotOrder ?? [], [session?.slotOrder])
  const picks = session?.picks
  const isPaused = session?.status === 'paused'
  const isAuction = session?.draftType === 'auction'
  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p] as const)), [players])

  /** G.2 — embedded player search. Filters by name / position / team (case-insensitive,
   * whitespace-tolerant). Limited to the first 80 results so the list is scrollable
   * without dropping the React tree on a 500-row pool. */
  const filteredPlayers = useMemo(() => {
    const q = form.playerSearch.trim().toLowerCase()
    if (!q) return players.slice(0, 80)
    return players
      .filter((p) => {
        if (p.name?.toLowerCase().includes(q)) return true
        if (p.position?.toLowerCase().includes(q)) return true
        if (typeof p.team === 'string' && p.team.toLowerCase().includes(q)) return true
        return false
      })
      .slice(0, 80)
  }, [players, form.playerSearch])


  const updateForm = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setError(null)
    setSuccess(null)
    setWarning(null)
  }, [])

  const resetForm = useCallback(() => {
    setForm(INITIAL_FORM)
    setError(null)
    setWarning(null)
  }, [])

  // ── Locked states ──────────────────────────────────────────────────────────
  if (isAuction) {
    return (
      <div
        className={`rounded-lg border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100 ${className ?? ''}`}
        data-testid="commish-edit-locked-auction"
      >
        Commissioner pick editing is not available for auction drafts.
      </div>
    )
  }
  if (!session || !isPaused) {
    return (
      <div
        className={`rounded-lg border border-white/15 bg-black/30 p-4 text-sm text-white/70 ${className ?? ''}`}
        data-testid="commish-edit-locked-paused"
      >
        Pause the draft to edit picks.
      </div>
    )
  }

  // ── Submit handler ─────────────────────────────────────────────────────────
  async function submit(forceOverride?: boolean) {
    setError(null)
    setWarning(null)
    setSuccess(null)

    const overallParsed = Number(form.overall)
    if (!Number.isFinite(overallParsed) || overallParsed < 1) {
      setError('Enter a valid overall pick number.')
      return
    }
    const overall = Math.floor(overallParsed)

    let params: CommissionerPickEditClientParams = {
      leagueId,
      action: form.action,
      overallPickNumber: overall,
      reason: form.reason.trim() ? form.reason.trim() : null,
      force: forceOverride ?? form.force,
    }

    if (form.action === 'REPLACE_PLAYER_ON_PICK' || form.action === 'ASSIGN_PLAYER_TO_PICK') {
      const sel = playerById.get(form.playerId)
      if (!sel) {
        setError('Pick a player from the list.')
        return
      }
      params = {
        ...params,
        playerId: sel.id,
        playerName: sel.name,
        position: sel.position,
        team: sel.team ?? null,
        byeWeek: sel.byeWeek ?? null,
        playerImageUrl: sel.imageUrl ?? null,
      }
    }

    if (form.action === 'CHANGE_PICK_OWNER') {
      if (!form.rosterId) {
        setError('Pick a roster.')
        return
      }
      params = { ...params, newRosterId: form.rosterId }
    } else if (form.action === 'ASSIGN_PLAYER_TO_PICK' && form.rosterId) {
      params = { ...params, newRosterId: form.rosterId }
    }

    setSubmitting(true)
    try {
      const snapshot = await commissionerPickEditClient(params)
      onSnapshotUpdated(snapshot)
      setSuccess('Pick updated. Draft remains paused.')
      setWarning(null)
      setSelfBenefit(null)
    } catch (err) {
      if (err instanceof CommissionerPickEditClientError) {
        if (err.code === 'ROSTER_ELIGIBILITY') {
          const msg = err.warnings?.[0]?.message ?? err.message
          setWarning({ message: msg, lastParams: params })
        } else if (err.code === 'SELF_BENEFIT_CONFIRM_REQUIRED') {
          // Slice 2 — server detected the actor's roster is the affected one.
          // Show an inline prompt: typed reason required + confirm checkbox.
          // Clicking "Confirm and apply" re-submits with confirmSelfBenefit=true.
          setSelfBenefit({ message: err.message, lastParams: params })
        } else {
          setError(err.message)
        }
      } else {
        setError((err as Error).message ?? 'Request failed')
      }
    } finally {
      setSubmitting(false)
    }
  }

  /** Slice 2 — re-submit the staged params with confirmSelfBenefit=true. */
  async function submitWithSelfBenefitConfirm() {
    if (!selfBenefit) return
    const trimmedReason = form.reason.trim()
    if (!trimmedReason) {
      setError('A reason is required when editing your own roster pick.')
      return
    }
    setSubmitting(true)
    try {
      const snapshot = await commissionerPickEditClient({
        ...selfBenefit.lastParams,
        reason: trimmedReason,
        confirmSelfBenefit: true,
      })
      onSnapshotUpdated(snapshot)
      setSuccess('Pick updated. Draft remains paused. (Logged as self-benefit edit.)')
      setSelfBenefit(null)
      setWarning(null)
    } catch (err) {
      if (err instanceof CommissionerPickEditClientError) {
        setError(err.message)
      } else {
        setError((err as Error).message ?? 'Request failed')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const needsPlayer = form.action === 'REPLACE_PLAYER_ON_PICK' || form.action === 'ASSIGN_PLAYER_TO_PICK'
  const needsRoster = form.action === 'CHANGE_PICK_OWNER'
  const showOptionalAssignRoster = form.action === 'ASSIGN_PLAYER_TO_PICK'

  // ── Inline hints (advisory only — backend is source of truth) ─────────────
  const overallNum = Number(form.overall)
  const overallParsed = Number.isFinite(overallNum) ? Math.floor(overallNum) : null
  const targetPick = overallParsed ? pickByOverall(picks, overallParsed) : undefined
  const totalPicks = (session.rounds ?? 0) * (session.teamCount ?? 0)
  let guardrailHint: string | null = null
  if (overallParsed) {
    if (overallParsed > totalPicks) {
      guardrailHint = `Pick #${overallParsed} is outside this draft (max #${totalPicks}).`
    } else if (form.action === 'REMOVE_PLAYER_FROM_PICK' && isPickEmpty(targetPick)) {
      guardrailHint = 'Pick is already empty — nothing to remove.'
    } else if (form.action === 'REPLACE_PLAYER_ON_PICK' && isPickEmpty(targetPick)) {
      guardrailHint = 'Pick is empty — use Assign instead.'
    } else if (form.action === 'ASSIGN_PLAYER_TO_PICK' && targetPick && !isPickEmpty(targetPick)) {
      guardrailHint = 'Pick already has a player — use Replace instead.'
    }
  }

  return (
    <div
      className={`flex h-full min-h-0 flex-col gap-3 overflow-auto rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-white/85 ${className ?? ''}`}
      data-testid="commish-edit-panel"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-200/90">
          Commissioner Pick Editor
        </h3>
        <button
          type="button"
          onClick={resetForm}
          className="rounded border border-white/15 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-white/65 hover:bg-white/10"
        >
          Reset
        </button>
      </header>

      <p className="text-[11px] text-white/55">
        Edits are audited and the draft stays paused. Use the Force checkbox only after a roster eligibility warning.
      </p>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/60">Action</label>
        <select
          data-testid="commish-edit-action"
          value={form.action}
          onChange={(e) => updateForm('action', e.target.value as CommissionerPickEditAction)}
          className="rounded border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
        >
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABEL[a]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/60">
          Overall pick #
        </label>
        <input
          data-testid="commish-edit-overall"
          type="number"
          min={1}
          inputMode="numeric"
          value={form.overall}
          onChange={(e) => updateForm('overall', e.target.value)}
          className="rounded border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
        />
        {targetPick ? (
          <p className="text-[11px] text-white/55">
            Currently: <span className="font-semibold text-white/85">{targetPick.playerName}</span> ({targetPick.position}) → {targetPick.displayName ?? targetPick.rosterId}
          </p>
        ) : overallParsed ? (
          <p className="text-[11px] text-white/55">Pick #{overallParsed} is empty.</p>
        ) : null}
        {guardrailHint ? (
          <p className="text-[11px] text-amber-300/90" data-testid="commish-edit-guardrail">
            {guardrailHint}
          </p>
        ) : null}
      </div>

      {needsPlayer ? (
        <div className="flex flex-col gap-1.5" data-testid="commish-edit-player-search-wrapper">
          <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/60">Player</label>
          {/* G.2 — embedded search. The commissioner picks a replacement here
              instead of leaving the modal to use the player-pool Draft button
              (which routes through submitPick and rejects "not on the clock"
              for past picks). The search input below filters the dropdown's
              option list so the user can find a player by name, position, or
              team without leaving the modal. */}
          <p className="text-[11px] leading-snug text-white/45">
            Use this search to pick the replacement player. The pool Draft button is for live drafting only.
          </p>
          <input
            type="text"
            data-testid="commish-edit-player-search"
            value={form.playerSearch}
            onChange={(e) => updateForm('playerSearch', e.target.value)}
            placeholder="Search by name, position, or team"
            className="rounded border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white placeholder:text-white/35 focus:outline-none focus:ring-1 focus:ring-cyan-400/40"
            autoComplete="off"
            spellCheck={false}
          />
          <select
            data-testid="commish-edit-player"
            value={form.playerId}
            onChange={(e) => updateForm('playerId', e.target.value)}
            className="rounded border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
            size={Math.min(8, Math.max(3, filteredPlayers.length + 1))}
          >
            <option value="">— Select a player —</option>
            {filteredPlayers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name + ' (' + p.position + (p.team ? ' - ' + p.team : '') + ')'}
              </option>
            ))}
          </select>
          <p
            data-testid="commish-edit-player-result-count"
            className="text-[11px] text-white/45"
          >
            {filteredPlayers.length === 0
              ? 'No matches.'
              : filteredPlayers.length + ' shown'}
          </p>
        </div>
      ) : null}

      {needsRoster || showOptionalAssignRoster ? (
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/60">
            {showOptionalAssignRoster && !needsRoster ? 'Override owner (optional)' : 'Roster / Team'}
          </label>
          <select
            data-testid="commish-edit-roster"
            value={form.rosterId}
            onChange={(e) => updateForm('rosterId', e.target.value)}
            className="rounded border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
          >
            <option value="">
              {showOptionalAssignRoster && !needsRoster ? '— Use slot / traded owner —' : '— Select a team —'}
            </option>
            {slotOrder.map((s) => (
              <option key={s.rosterId} value={s.rosterId}>
                Slot {s.slot} · {s.displayName}
              </option>
            ))}
          </select>
          {showOptionalAssignRoster && !needsRoster ? (
            <p className="text-[11px] text-white/45">Leave blank to assign using the board slot’s resolved owner.</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/60">Reason (optional)</label>
        <textarea
          data-testid="commish-edit-reason"
          value={form.reason}
          onChange={(e) => updateForm('reason', e.target.value)}
          rows={2}
          className="rounded border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
          placeholder="Audit log: explain why this edit is being made"
        />
      </div>

      {needsPlayer ? (
        <label className="flex items-center gap-2 text-[11px] text-white/70">
          <input
            data-testid="commish-edit-force"
            type="checkbox"
            checked={form.force}
            onChange={(e) => updateForm('force', e.target.checked)}
          />
          Force override roster eligibility warnings
        </label>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="commish-edit-submit"
          disabled={submitting}
          onClick={() => submit()}
          className="rounded border border-cyan-400/40 bg-cyan-500/15 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-50 hover:bg-cyan-500/25 disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Apply edit'}
        </button>
      </div>

      {warning ? (
        <div
          data-testid="commish-edit-warning"
          className="rounded border border-amber-400/35 bg-amber-500/10 p-2 text-[12px] text-amber-100"
        >
          <p className="font-semibold">Roster eligibility warning</p>
          <p className="mt-1">{warning.message}</p>
          <button
            type="button"
            data-testid="commish-edit-force-anyway"
            onClick={() => submit(true)}
            disabled={submitting}
            className="mt-2 rounded border border-amber-300/45 bg-amber-500/20 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-50 hover:bg-amber-500/30 disabled:opacity-50"
          >
            Force anyway
          </button>
        </div>
      ) : null}

      {selfBenefit ? (
        <div
          role="alertdialog"
          data-testid="commish-edit-self-benefit"
          className="rounded border border-violet-400/35 bg-violet-500/10 p-2 text-[12px] text-violet-100"
        >
          <p className="font-semibold">Self-benefit edit detected</p>
          <p className="mt-1">{selfBenefit.message}</p>
          <p className="mt-1 text-[11px] text-white/70">
            This edit will be logged with <code>selfBenefit=true</code> in the league audit log. Type a
            clear reason in the Reason field, then click Confirm.
          </p>
          <button
            type="button"
            data-testid="commish-edit-self-benefit-confirm"
            onClick={() => submitWithSelfBenefitConfirm()}
            disabled={submitting || !form.reason.trim()}
            className="mt-2 rounded border border-violet-300/45 bg-violet-500/20 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-50 hover:bg-violet-500/30 disabled:opacity-50"
          >
            Confirm and apply
          </button>
          <button
            type="button"
            data-testid="commish-edit-self-benefit-cancel"
            onClick={() => setSelfBenefit(null)}
            disabled={submitting}
            className="ml-2 mt-2 rounded border border-white/15 bg-black/30 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/75 hover:bg-white/10 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          data-testid="commish-edit-error"
          className="rounded border border-rose-400/35 bg-rose-500/10 p-2 text-[12px] text-rose-100"
        >
          {error}
        </div>
      ) : null}

      {success ? (
        <div
          role="status"
          data-testid="commish-edit-success"
          className="rounded border border-emerald-400/35 bg-emerald-500/10 p-2 text-[12px] text-emerald-100"
        >
          {success}
        </div>
      ) : null}
    </div>
  )
}

export default CommissionerPickEditorPanel
