'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Shield, Megaphone, UserPlus, RotateCcw, Settings2, Pause, Play, Undo2, Bot, CheckCircle2, XCircle, Crown } from 'lucide-react'
import CommissionerBroadcastForm from '@/components/chat/CommissionerBroadcastForm'
import { LeagueRecruitmentTools } from '@/components/app/recruitment'
import { CommissionerMonetizationOverview } from '@/components/app/commissioner/CommissionerMonetizationOverview'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { useEntitlement } from '@/hooks/useEntitlement'
import { buildFeatureUpgradePath } from '@/lib/subscription/feature-access'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'

type DraftSessionStatus = 'pre_draft' | 'in_progress' | 'paused' | 'completed'

type SlotOrderEntry = {
  slot: number
  rosterId: string
  displayName: string
}

type DraftSessionState = {
  status: DraftSessionStatus
  slotOrder?: SlotOrderEntry[]
  picks?: unknown[]
} | null

type ManagerRow = {
  rosterId: string
  userId: string
  username?: string | null
  displayName: string
}

type OrphanAdoptionRequestRow = {
  id: string
  rosterId: string
  userId: string
  requesterName: string
  message: string | null
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
  aiEvaluationSummary: string | null
}

export default function CommissionerControlsPanel({ leagueId }: { leagueId?: string }) {
  const [draftSession, setDraftSession] = useState<DraftSessionState>(null)
  const [managers, setManagers] = useState<ManagerRow[]>([])
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [selectedRosterId, setSelectedRosterId] = useState('')
  const [replacementUserId, setReplacementUserId] = useState('')
  const [orphanAdoptionRequests, setOrphanAdoptionRequests] = useState<OrphanAdoptionRequestRow[]>([])
  const [showOverrideForm, setShowOverrideForm] = useState(false)
  const [overridePick, setOverridePick] = useState({ playerName: '', position: '', rosterId: '' })
  const [confirmResetDraft, setConfirmResetDraft] = useState(false)
  const { hasAccess } = useEntitlement()

  const loadData = useCallback(async () => {
    if (!leagueId) return
    try {
      const [managersRes, draftSessionRes, orphanRequestsRes] = await Promise.all([
        fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/managers`, { cache: 'no-store' }),
        fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/session`, { cache: 'no-store' }),
        fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/orphan-adoptions?status=pending`, { cache: 'no-store' }),
      ])
      if (managersRes.ok) {
        const managersData = await managersRes.json().catch(() => ({}))
        const nextManagers = Array.isArray(managersData?.managers)
          ? (managersData.managers as ManagerRow[])
          : []
        setManagers(nextManagers)
      } else {
        setManagers([])
      }
      if (draftSessionRes.ok) {
        const draftData = await draftSessionRes.json().catch(() => ({}))
        setDraftSession((draftData?.session ?? null) as DraftSessionState)
      } else {
        setDraftSession(null)
      }
      if (orphanRequestsRes.ok) {
        const requestData = await orphanRequestsRes.json().catch(() => ({}))
        const nextRequests = Array.isArray(requestData?.requests)
          ? (requestData.requests as OrphanAdoptionRequestRow[])
          : []
        setOrphanAdoptionRequests(nextRequests)
      } else {
        setOrphanAdoptionRequests([])
      }
    } catch {
      setManagers([])
      setDraftSession(null)
      setOrphanAdoptionRequests([])
    }
  }, [leagueId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (!selectedRosterId && managers.length > 0) {
      setSelectedRosterId(managers[0]!.rosterId)
    }
  }, [managers, selectedRosterId])

  const selectedManager = useMemo(
    () => managers.find((manager) => manager.rosterId === selectedRosterId) ?? null,
    [managers, selectedRosterId]
  )
  const premiumActionHref = useCallback(
    (featureId: SubscriptionFeatureId, unlockedHref: string) =>
      hasAccess(featureId) ? unlockedHref : buildFeatureUpgradePath(featureId),
    [hasAccess]
  )

  if (!leagueId) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Commissioner Controls</h3>
        <p className="mt-2 text-xs text-white/65">Select a league to access commissioner controls.</p>
      </section>
    )
  }

  const baseUrl = `/league/${leagueId}`
  const draftControlsUrl = `/api/leagues/${encodeURIComponent(leagueId)}/draft/controls`
  const freeSettingsTabs = [
    { tab: 'General', label: 'General' },
    { tab: 'Member Settings', label: 'Members' },
    { tab: 'Draft Settings', label: 'Draft' },
  ]
  const premiumSettingsTabs: Array<{ tab: string; label: string; featureId: SubscriptionFeatureId }> = [
    { tab: 'Scoring Settings', label: 'Advanced scoring', featureId: 'advanced_scoring' },
    { tab: 'Playoff Settings', label: 'Advanced playoffs', featureId: 'advanced_playoff_setup' },
    { tab: 'Automation Settings', label: 'AI automation', featureId: 'commissioner_automation' },
  ]
  const draftStatus = draftSession?.status
  const canPause = draftStatus === 'in_progress'
  const canResume = draftStatus === 'paused'
  const canDraftControl = draftStatus === 'in_progress' || draftStatus === 'paused'
  const slotOrder = (draftSession?.slotOrder ?? []) as SlotOrderEntry[]

  const runDraftControl = async (action: string, body?: Record<string, unknown>) => {
    setBusyAction(action)
    try {
      const res = await fetch(draftControlsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(body ?? {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Draft control failed')
      setDraftSession((data?.session ?? null) as DraftSessionState)
      if (action === 'reset_draft') setConfirmResetDraft(false)
      if (action === 'force_autopick') {
        setShowOverrideForm(false)
        setOverridePick({ playerName: '', position: '', rosterId: '' })
      }
      toast.success(action.replace(/_/g, ' ') + ' complete')
    } catch (e: any) {
      toast.error(e?.message || 'Draft control failed')
    } finally {
      setBusyAction(null)
    }
  }

  const replaceManager = async () => {
    if (!selectedRosterId || !replacementUserId.trim()) {
      toast.error('Select a roster and provide user ID')
      return
    }
    setBusyAction('replace_manager')
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/managers`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterId: selectedRosterId, userId: replacementUserId.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Replace manager failed')
      toast.success('Manager replaced')
      setReplacementUserId('')
      await loadData()
    } catch (e: any) {
      toast.error(e?.message || 'Replace manager failed')
    } finally {
      setBusyAction(null)
    }
  }

  const removeManager = async () => {
    if (!selectedRosterId) {
      toast.error('Select a roster first')
      return
    }
    if (!confirm('Remove manager from selected roster?')) return
    setBusyAction('remove_manager')
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/managers`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterId: selectedRosterId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Remove manager failed')
      toast.success('Manager removed and roster marked orphan')
      await loadData()
    } catch (e: any) {
      toast.error(e?.message || 'Remove manager failed')
    } finally {
      setBusyAction(null)
    }
  }

  const assignAiManager = async () => {
    if (!selectedRosterId) {
      toast.error('Select a roster first')
      return
    }
    setBusyAction('assign_ai_manager')
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/managers/assign-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterId: selectedRosterId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Assign AI manager failed')
      toast.success('AI manager assigned to selected roster')
      await loadData()
    } catch (e: any) {
      toast.error(e?.message || 'Assign AI manager failed')
    } finally {
      setBusyAction(null)
    }
  }

  const reviewOrphanAdoptionRequest = async (
    requestId: string,
    decision: 'approve' | 'reject'
  ) => {
    setBusyAction(`${decision}_orphan_adoption`)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/orphan-adoptions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, decision }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to review adoption request')
      toast.success(decision === 'approve' ? 'Adoption request approved' : 'Adoption request rejected')
      await loadData()
    } catch (e: any) {
      toast.error(e?.message || 'Failed to review adoption request')
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <section className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-6">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Commissioner Controls</h3>
      </div>
      <p className="text-xs text-white/65">Core commissioner operations stay free. Premium AI and advanced setup tools are clearly labeled.</p>

      <CommissionerMonetizationOverview compact />

      <div>
        <h4 className="text-xs font-semibold text-white/80 mb-2 flex items-center gap-1.5">
          <Settings2 className="h-3.5 w-3.5" /> Edit settings
        </h4>
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-emerald-200/85">Free settings</p>
        <div className="flex flex-wrap gap-2">
          {freeSettingsTabs.map(({ tab, label }) => (
            <Link
              key={tab}
              href={`${baseUrl}?tab=Settings&settingsTab=${encodeURIComponent(tab)}`}
              data-testid={`commissioner-controls-open-settings-${tab.toLowerCase().replace(/\s+/g, '-')}`}
              className="inline-flex items-center rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/90 hover:bg-white/10"
            >
              {label}
            </Link>
          ))}
        </div>
        <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-amber-200/85">AF Commissioner premium settings</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {premiumSettingsTabs.map(({ tab, label, featureId }) => (
            <Link
              key={tab}
              href={premiumActionHref(
                featureId,
                `${baseUrl}?tab=Settings&settingsTab=${encodeURIComponent(tab)}`
              )}
              data-testid={`commissioner-controls-premium-settings-${featureId}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-500/20"
            >
              <Crown className="h-3.5 w-3.5" />
              {label}
            </Link>
          ))}
        </div>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-white/80 mb-2">League recruitment</h4>
        <LeagueRecruitmentTools leagueId={leagueId} initialInvite={null} isCommissioner />
      </div>

      <div>
        <h4 className="text-xs font-semibold text-white/80 mb-2 flex items-center gap-1.5">
          <Pause className="h-3.5 w-3.5" /> Draft controls
        </h4>
        <p className="text-xs text-white/65 mb-2">
          Status: {draftStatus ?? 'no session'}. Pause/resume, override pick, and reset draft from here.
        </p>
        {draftSession ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {canPause && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runDraftControl('pause')}
                  disabled={busyAction !== null}
                  data-testid="commissioner-controls-draft-pause"
                >
                  <Pause className="mr-1.5 h-3.5 w-3.5" />
                  Pause draft
                </Button>
              )}
              {canResume && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runDraftControl('resume')}
                  disabled={busyAction !== null}
                  data-testid="commissioner-controls-draft-resume"
                >
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  Resume draft
                </Button>
              )}
              {canDraftControl && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runDraftControl('reset_timer')}
                  disabled={busyAction !== null}
                  data-testid="commissioner-controls-draft-reset-timer"
                >
                  <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                  Reset timer
                </Button>
              )}
              {!showOverrideForm ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowOverrideForm(true)}
                  disabled={busyAction !== null || !canDraftControl}
                  data-testid="commissioner-controls-override-open"
                >
                  Override pick
                </Button>
              ) : null}
            </div>
            {showOverrideForm && (
              <div className="rounded-lg border border-cyan-500/30 bg-black/30 p-3 space-y-2">
                <Label className="text-xs text-white/80">Override pick input</Label>
                <Input
                  value={overridePick.playerName}
                  onChange={(e) => setOverridePick((prev) => ({ ...prev, playerName: e.target.value }))}
                  placeholder="Player name"
                  data-testid="commissioner-controls-override-player-name"
                  className="bg-gray-900 border-white/20 text-sm"
                />
                <Input
                  value={overridePick.position}
                  onChange={(e) => setOverridePick((prev) => ({ ...prev, position: e.target.value }))}
                  placeholder="Position (QB, RB, WR...)"
                  data-testid="commissioner-controls-override-position"
                  className="bg-gray-900 border-white/20 text-sm"
                />
                {slotOrder.length > 0 && (
                  <select
                    value={overridePick.rosterId}
                    onChange={(e) => setOverridePick((prev) => ({ ...prev, rosterId: e.target.value }))}
                    data-testid="commissioner-controls-override-roster-select"
                    className="w-full rounded border border-white/20 bg-gray-900 px-2 py-1.5 text-xs text-white"
                  >
                    <option value="">Current roster on clock</option>
                    {slotOrder.map((entry) => (
                      <option key={entry.rosterId} value={entry.rosterId}>
                        {entry.displayName || entry.rosterId}
                      </option>
                    ))}
                  </select>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      runDraftControl('force_autopick', {
                        playerName: overridePick.playerName.trim(),
                        position: overridePick.position.trim(),
                        rosterId: overridePick.rosterId || undefined,
                      })
                    }
                    disabled={
                      busyAction !== null ||
                      !canDraftControl ||
                      !overridePick.playerName.trim() ||
                      !overridePick.position.trim()
                    }
                    data-testid="commissioner-controls-override-submit"
                  >
                    Submit override
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowOverrideForm(false)}
                    data-testid="commissioner-controls-override-cancel"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {draftStatus !== 'pre_draft' && draftStatus !== 'completed' && (
              <div className="flex flex-wrap items-center gap-2">
                {!confirmResetDraft ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmResetDraft(true)}
                    disabled={busyAction !== null}
                    data-testid="commissioner-controls-reset-draft-open"
                    className="border-red-500/40 text-red-200"
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    Reset draft
                  </Button>
                ) : (
                  <>
                    <span className="text-xs text-amber-200">Confirm reset draft?</span>
                    <Button
                      size="sm"
                      onClick={() => runDraftControl('reset_draft')}
                      disabled={busyAction !== null}
                      data-testid="commissioner-controls-reset-draft-confirm"
                      className="bg-red-600 hover:bg-red-700"
                    >
                      Confirm reset
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmResetDraft(false)}
                      data-testid="commissioner-controls-reset-draft-cancel"
                    >
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            )}
            {draftStatus === 'completed' && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runDraftControl('create_next_draft')}
                  disabled={busyAction !== null}
                  data-testid="commissioner-controls-create-next-draft"
                >
                  Create next season&apos;s draft
                </Button>
                <span className="text-xs text-white/50">
                  After the season is finalized: a rookie draft for dynasty leagues, or a full draft with locked keepers on the board.
                </span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-white/50">No draft session found. Start a draft first, then controls will appear.</p>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold text-white/80 mb-2 flex items-center gap-1.5">
          <UserPlus className="h-3.5 w-3.5" /> Replace managers / assign AI manager
        </h4>
        <p className="mb-2 text-xs text-white/60">
          Replacing or orphaning managers is free. AI team manager assignment is an AF Commissioner premium tool.
        </p>
        {managers.length === 0 ? (
          <p className="text-xs text-white/50">No manager rosters loaded.</p>
        ) : (
          <div className="space-y-2">
            <select
              value={selectedRosterId}
              onChange={(e) => setSelectedRosterId(e.target.value)}
              data-testid="commissioner-controls-manager-roster-select"
              className="w-full max-w-sm rounded border border-white/20 bg-gray-900 px-2 py-1.5 text-xs text-white"
            >
              <option value="">Select roster</option>
              {managers.map((manager) => (
                <option key={manager.rosterId} value={manager.rosterId}>
                  {manager.displayName} ({manager.rosterId})
                </option>
              ))}
            </select>
            <Input
              value={replacementUserId}
              onChange={(e) => setReplacementUserId(e.target.value)}
              placeholder="Replacement user ID"
              data-testid="commissioner-controls-manager-user-id-input"
              className="max-w-sm bg-gray-900 border-white/20 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={replaceManager}
                disabled={busyAction !== null || !selectedRosterId || !replacementUserId.trim()}
                data-testid="commissioner-controls-manager-replace"
              >
                Replace manager
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={removeManager}
                disabled={busyAction !== null || !selectedRosterId}
                data-testid="commissioner-controls-manager-remove"
              >
                Mark orphan
              </Button>
              {hasAccess('ai_team_managers') ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={assignAiManager}
                  disabled={busyAction !== null || !selectedRosterId}
                  data-testid="commissioner-controls-manager-assign-ai"
                  className="border-cyan-500/40 text-cyan-200"
                >
                  <Bot className="mr-1.5 h-3.5 w-3.5" />
                  Assign AI manager
                </Button>
              ) : (
                <Link
                  href={buildFeatureUpgradePath('ai_team_managers')}
                  data-testid="commissioner-controls-manager-assign-ai-upgrade"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-500/20"
                >
                  <Crown className="h-3.5 w-3.5" />
                  Upgrade for AI team managers
                </Link>
              )}
            </div>
            {selectedManager && (
              <p className="text-xs text-white/60">
                Selected: {selectedManager.displayName} | userId: {selectedManager.userId || 'orphan'}
              </p>
            )}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold text-white/80 mb-2 flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5" /> Orphan adoption approvals
        </h4>
        {orphanAdoptionRequests.length === 0 ? (
          <p className="text-xs text-white/50">No pending orphan adoption requests.</p>
        ) : (
          <div className="space-y-2">
            {orphanAdoptionRequests.map((request) => (
              <div
                key={request.id}
                className="rounded-lg border border-white/15 bg-black/30 p-3"
                data-testid={`commissioner-controls-orphan-request-${request.id}`}
              >
                <p className="text-xs text-white/85">
                  <span className="font-semibold">{request.requesterName}</span> wants roster {request.rosterId}
                </p>
                {request.message ? (
                  <p className="mt-1 text-xs text-white/60">Message: {request.message}</p>
                ) : null}
                {request.aiEvaluationSummary ? (
                  <p className="mt-1 text-xs text-cyan-200/80">{request.aiEvaluationSummary}</p>
                ) : null}
                <p className="mt-1 text-[11px] text-white/45">
                  Requested {new Date(request.createdAt).toLocaleString()}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => reviewOrphanAdoptionRequest(request.id, 'approve')}
                    disabled={busyAction !== null}
                    data-testid={`commissioner-controls-orphan-approve-${request.id}`}
                    className="border-emerald-500/40 text-emerald-200"
                  >
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => reviewOrphanAdoptionRequest(request.id, 'reject')}
                    disabled={busyAction !== null}
                    data-testid={`commissioner-controls-orphan-reject-${request.id}`}
                    className="border-red-500/40 text-red-200"
                  >
                    <XCircle className="mr-1.5 h-3.5 w-3.5" />
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold text-white/80 mb-2 flex items-center gap-1.5">
          <Megaphone className="h-3.5 w-3.5" /> Broadcast message
        </h4>
        <CommissionerBroadcastForm leagueId={leagueId} className="mt-1" />
      </div>

      <div className="text-[11px] text-white/45">
        For additional tools (commissioner transfer, waiver processing, and full league reset), open the
        <Link
          href={`${baseUrl}?tab=Commissioner`}
          className="ml-1 text-cyan-300 hover:text-cyan-200"
        >
          Commissioner tab
        </Link>
        .
      </div>
    </section>
  )
}
