'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { toast } from 'sonner'
import { ChimmyAlertPreferencesPanel } from '@/components/chimmy-surfaces'
import { SubscriptionGateBadge } from '@/components/subscription/SubscriptionGateBadge'
import { SubscriptionGateModal } from '@/components/subscription/SubscriptionGateModal'
import { IntegritySettingsPanel } from '@/components/commissioner/IntegritySettingsPanel'
import { isBestBallLeague } from '@/lib/autocoach/bestBallShared'
import { useEntitlement } from '@/hooks/useEntitlement'
import { useSubscriptionGateOptional } from '@/hooks/useSubscriptionGate'
import { isLeagueEligibleForDispersalDraft } from '@/lib/league/dispersal-draft-eligibility'
import { postOpenDraftOverlayMessage } from '@/lib/dashboard/dashboard-draft-overlay-bridge'
import { getUpgradeUrlWithHighlightForFeature } from '@/lib/subscription/featureGating'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'
import type { DraftOrderSlotRow } from '@/lib/draft/pick-order'
import { pickTimerSecondsFromLeagueSettings } from '@/lib/league/league-settings-pick-timer'
import { COMMON_TIMEZONES, formatInTz, isValidIanaTimeZone, toUtc } from '@/lib/timezone'
import { DraftOrderList } from './settings/DraftOrderList'
import { KeeperModal } from './settings/KeeperModal'
import { ResetDraftModal } from './settings/ResetDraftModal'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import {
  DangerButton,
  Input,
  LeagueSettingsHeader,
  Select,
  SettingsNav,
  SettingsRow,
  SettingsSection,
  Toggle,
} from './settings/components'
import type { LeagueSettingsApi, LeagueTeamBrief, RawSettings } from './settings/types'

function parseDraftSlots(raw: unknown): DraftOrderSlotRow[] {
  if (!Array.isArray(raw)) return []
  const out: DraftOrderSlotRow[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const slot = typeof o.slot === 'number' ? o.slot : Number(o.slot)
    const ownerId = typeof o.ownerId === 'string' ? o.ownerId : ''
    const ownerName = typeof o.ownerName === 'string' ? o.ownerName : ''
    const avatarUrl = o.avatarUrl as string | null | undefined
    if (Number.isFinite(slot)) out.push({ slot, ownerId, ownerName, avatarUrl })
  }
  return out.sort((a, b) => a.slot - b.slot)
}

function buildSlots(teamCount: number, teams: LeagueTeamBrief[], raw: unknown): DraftOrderSlotRow[] {
  const parsed = parseDraftSlots(raw)
  const rows: DraftOrderSlotRow[] = []
  const teamById = new Map(teams.map((t) => [t.id, t]))
  for (let i = 0; i < teamCount; i++) {
    const p = parsed[i]
    const t = p?.ownerId ? teamById.get(p.ownerId) : undefined
    rows.push({
      slot: i + 1,
      ownerId: p?.ownerId ?? '',
      ownerName: t?.teamName ?? p?.ownerName ?? '',
      avatarUrl: t?.avatarUrl ?? p?.avatarUrl,
    })
  }
  if (parsed.length === 0) {
    for (let i = 0; i < teamCount; i++) {
      const t = teams[i]
      if (t) {
        rows[i] = {
          slot: i + 1,
          ownerId: t.id,
          ownerName: t.teamName || t.ownerName,
          avatarUrl: t.avatarUrl,
        }
      }
    }
  }
  return rows
}

function orderTeamsWorstRecordFirst(teams: LeagueTeamBrief[]): DraftOrderSlotRow[] {
  const sorted = [...teams].sort((a, b) => {
    const wa = a.wins ?? 0
    const wb = b.wins ?? 0
    if (wa !== wb) return wa - wb
    const pa = a.pointsFor ?? 0
    const pb = b.pointsFor ?? 0
    if (pa !== pb) return pa - pb
    return a.teamName.localeCompare(b.teamName)
  })
  return sorted.map((t, i) => ({
    slot: i + 1,
    ownerId: t.id,
    ownerName: t.teamName || t.ownerName,
    avatarUrl: t.avatarUrl,
  }))
}

function orderTeamsBestRecordFirst(teams: LeagueTeamBrief[]): DraftOrderSlotRow[] {
  const sorted = [...teams].sort((a, b) => {
    const wa = (b.wins ?? 0) - (a.wins ?? 0)
    if (wa !== 0) return wa
    return (b.pointsFor ?? 0) - (a.pointsFor ?? 0)
  })
  return sorted.map((t, i) => ({
    slot: i + 1,
    ownerId: t.id,
    ownerName: t.teamName || t.ownerName,
    avatarUrl: t.avatarUrl,
  }))
}

function humanDuration(sec: number): string {
  if (sec < 60) return `${sec} seconds`
  if (sec < 3600) return `${Math.round(sec / 60)} minutes`
  if (sec < 86400) return `${Math.round(sec / 3600)} hours`
  return `${Math.round(sec / 86400)} days`
}

export function LeagueSettingsTab({
  leagueId,
  isCommissioner: isCommissionerShell,
  isHeadCommissioner: isHeadCommissionerShell,
  dashboardEmbed = false,
}: {
  leagueId: string
  /** From shell while settings API loads; API role wins once loaded */
  isCommissioner?: boolean
  isHeadCommissioner?: boolean
  /** Dashboard iframe hub — open dispersal draft in parent overlay */
  dashboardEmbed?: boolean
}) {
  const [data, setData] = useState<LeagueSettingsApi | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [slotRows, setSlotRows] = useState<DraftOrderSlotRow[]>([])
  const [localDate, setLocalDate] = useState('')
  const [localTime, setLocalTime] = useState('12:00')
  const [tzDraft, setTzDraft] = useState('America/New_York')
  const [preset, setPreset] = useState('120s')
  const [customValue, setCustomValue] = useState('120')
  const [customUnit, setCustomUnit] = useState<'seconds' | 'minutes' | 'hours'>('seconds')
  const [randomizeCount, setRandomizeCount] = useState(3)
  const [resetOpen, setResetOpen] = useState(false)
  const [keeperOpen, setKeeperOpen] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [maxPfWarning, setMaxPfWarning] = useState<string | null>(null)
  const [orphanApi, setOrphanApi] = useState<{
    orphanCount: number
    hasActiveDispersalDraft: boolean
    activeDispersalDraftId: string | null
    canRunDispersalDraft: boolean
    dispersalDraftGated: boolean
    totalAssets: number
  } | null>(null)
  const [localSubGate, setLocalSubGate] = useState<SubscriptionFeatureId | null>(null)
  const gateOptional = useSubscriptionGateOptional()
  const integrityEnt = useEntitlement('commissioner_integrity_monitoring')
  const { t } = useLanguage()

  const refresh = useCallback(async () => {
    setLoadError(null)
    const res = await fetch(`/api/league/settings?leagueId=${encodeURIComponent(leagueId)}`)
    if (!res.ok) {
      setLoadError('league.draftSettings.error.load')
      return
    }
    const json = (await res.json()) as LeagueSettingsApi
    setData(json)
    const s = json.settings as RawSettings | null
    const teamCount = json.league.teamCount
    const teams = json.league.teams
    setSlotRows(buildSlots(teamCount, teams, s?.draftOrderSlots))
    const tz = s?.timezone ?? json.league.timezone ?? 'America/New_York'
    setTzDraft(tz)
    if (s?.draftDateUtc) {
      const d = new Date(s.draftDateUtc)
      setLocalDate(formatInTimeZone(d, tz, 'yyyy-MM-dd'))
      setLocalTime(formatInTimeZone(d, tz, 'HH:mm'))
    } else {
      setLocalDate(formatInTimeZone(new Date(), tz, 'yyyy-MM-dd'))
      setLocalTime('12:00')
    }
    const pr = s?.pickTimerPreset ?? '120s'
    setPreset(pr)
    const cv = s?.pickTimerCustomValue
    setCustomValue(cv != null && Number.isFinite(cv) ? String(cv) : '120')
    setCustomUnit('seconds')
  }, [leagueId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const isDispersalDraftLeague = useMemo(() => {
    if (!data?.league) return false
    return isLeagueEligibleForDispersalDraft({
      isDynasty: data.league.isDynasty,
      leagueType: data.league.leagueType ?? null,
      leagueVariant: data.league.leagueVariant ?? null,
    })
  }, [data?.league])

  useEffect(() => {
    if (
      !leagueId ||
      !isDispersalDraftLeague ||
      (data?.userRole !== 'commissioner' && data?.userRole !== 'co_commissioner')
    ) {
      setOrphanApi(null)
      return
    }
    let cancelled = false
    void (async () => {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/orphaned-teams`, { cache: 'no-store' })
      const json = (await res.json().catch(() => ({}))) as {
        orphanCount?: number
        hasActiveDispersalDraft?: boolean
        activeDispersalDraftId?: string | null
        canRunDispersalDraft?: boolean
        dispersalDraftGated?: boolean
        orphanedTeams?: { playerCount?: number; draftPickCount?: number; faabRemaining?: number }[]
      }
      if (!res.ok || cancelled) return
      const teams = Array.isArray(json.orphanedTeams) ? json.orphanedTeams : []
      const totalAssets = teams.reduce(
        (acc, t) =>
          acc +
          (t.playerCount ?? 0) +
          (t.draftPickCount ?? 0) +
          (typeof t.faabRemaining === 'number' && t.faabRemaining > 0 ? 1 : 0),
        0
      )
      setOrphanApi({
        orphanCount: json.orphanCount ?? 0,
        hasActiveDispersalDraft: Boolean(json.hasActiveDispersalDraft),
        activeDispersalDraftId: json.activeDispersalDraftId ?? null,
        canRunDispersalDraft: Boolean(json.canRunDispersalDraft),
        dispersalDraftGated: Boolean(json.dispersalDraftGated),
        totalAssets,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [data?.userRole, isDispersalDraftLeague, leagueId])

  const openDispersalGate = (id: SubscriptionFeatureId) => {
    gateOptional?.gate(id) ?? setLocalSubGate(id)
  }

  const s = data?.settings as RawSettings | null
  const league = data?.league

  const patch = useCallback(
    async (partial: Record<string, unknown>) => {
      if (data?.userRole !== 'commissioner' && data?.userRole !== 'co_commissioner') return
      const res = await fetch('/api/league/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, ...partial }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(err.error ?? 'Save failed')
        return
      }
      const json = (await res.json()) as { settings: RawSettings }
      setData((prev) => (prev ? { ...prev, settings: json.settings } : prev))
    },
    [leagueId, data?.userRole],
  )

  const totalSecondsPick = useMemo(() => {
    if (preset !== 'custom') return pickTimerSecondsFromLeagueSettings(preset, null)
    const n = Number(customValue)
    if (!Number.isFinite(n)) return 120
    if (customUnit === 'minutes') return Math.round(n * 60)
    if (customUnit === 'hours') return Math.round(n * 3600)
    return Math.round(n)
  }, [preset, customValue, customUnit])

  const totalRosterSlots = league?.totalRosterSlots ?? 15
  const method = String(s?.draftOrderMethod ?? 'manual')
  const draftType = String(s?.draftType ?? 'snake')
  const rounds = Number(s?.rounds ?? 15)
  const emptySlots = slotRows.filter((r) => !r.ownerId?.trim()).length

  const saveDraftTime = async () => {
    if (!isValidIanaTimeZone(tzDraft)) {
      toast.error('Invalid timezone')
      return
    }
    const utc = toUtc(localDate, localTime, tzDraft)
    await patch({ draftDateUtc: utc.toISOString(), timezone: tzDraft })
    setDirty(false)
  }

  const savePickTimer = async () => {
    if (totalSecondsPick < 10 || totalSecondsPick > 604800) {
      toast.error('Pick timer must be between 10 seconds and 7 days.')
      return
    }
    await patch({
      pickTimerPreset: preset,
      pickTimerCustomValue: preset === 'custom' ? totalSecondsPick : null,
    })
    setDirty(false)
  }

  const handleReorder = (next: DraftOrderSlotRow[]) => {
    setSlotRows(next)
    void patch({ draftOrderSlots: next })
  }

  const handleAssignSlot = (slotIndex: number, teamId: string) => {
    const tm = league?.teams.find((t) => t.id === teamId)
    if (!tm || !league) return
    const next = [...slotRows]
    const row = next[slotIndex]
    if (!row) return
    next[slotIndex] = {
      ...row,
      ownerId: tm.id,
      ownerName: tm.teamName || tm.ownerName,
      avatarUrl: tm.avatarUrl,
    }
    setSlotRows(next)
    void patch({ draftOrderSlots: next })
  }

  const handleMethodChange = async (m: string) => {
    if (!league) return
    if (m === 'prev_standings') {
      const rows = orderTeamsBestRecordFirst(league.teams)
      setSlotRows(rows)
      await patch({ draftOrderMethod: m, draftOrderSlots: rows })
      return
    }
    if (m === 'worst_to_first') {
      const rows = orderTeamsWorstRecordFirst(league.teams)
      setSlotRows(rows)
      await patch({ draftOrderMethod: m, draftOrderSlots: rows })
      return
    }
    await patch({ draftOrderMethod: m })
  }

  const handleRandomize = async () => {
    if (data?.userRole !== 'commissioner' && data?.userRole !== 'co_commissioner') return
    const res = await fetch('/api/league/settings/randomize-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId, count: randomizeCount }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      toast.error(err.error ?? 'Randomize failed')
      return
    }
    const json = (await res.json()) as { slots: DraftOrderSlotRow[]; settings: RawSettings }
    setSlotRows(json.slots)
    setData((prev) => (prev ? { ...prev, settings: json.settings } : prev))
    toast.success('Draft order randomized')
  }

  const loadMaxPfOrder = async () => {
    if (data?.userRole !== 'commissioner' && data?.userRole !== 'co_commissioner') return
    const L = data?.league
    if (!L) return
    const res = await fetch(`/api/league/settings/max-pf?leagueId=${encodeURIComponent(leagueId)}`)
    const json = (await res.json()) as {
      rows: { ownerId: string; ownerName: string }[]
      warning?: string | null
    }
    if (json.warning) {
      setMaxPfWarning(json.warning)
      toast.message(json.warning)
      return
    }
    setMaxPfWarning(null)
    const rows: DraftOrderSlotRow[] = json.rows.map((r, i) => {
      const tm = L.teams.find((t) => t.id === r.ownerId)
      return {
        slot: i + 1,
        ownerId: r.ownerId,
        ownerName: r.ownerName,
        avatarUrl: tm?.avatarUrl,
      }
    })
    setSlotRows(rows)
    await patch({ draftOrderMethod: 'reverse_max_pf', draftOrderSlots: rows })
    toast.success('Reverse Max PF order applied')
  }

  const utcPreview =
    localDate && localTime ? toUtc(localDate, localTime, tzDraft).toISOString().replace('T', ' ').slice(0, 19) : '—'
  const leagueLocalPreview =
    s?.draftDateUtc && tzDraft ? formatInTz(new Date(String(s.draftDateUtc)), tzDraft) : '—'

  const lastRandom =
    Array.isArray(s?.randomizeHistory) && s.randomizeHistory.length > 0
      ? (s.randomizeHistory as { count?: number; performedAt?: string; performedBy?: string }[])[
          s.randomizeHistory.length - 1
        ]
      : null

  const saveAll = async () => {
    await savePickTimer()
    await saveDraftTime()
  }

  if (loadError || (!data && !loadError)) {
    return (
      <div className="h-full overflow-y-auto px-4 py-4">
        <p className="text-[13px] text-white/50">
          {loadError ? t(loadError) : t('common.loading')}
        </p>
      </div>
    )
  }

  if (!data || !league) return null

  const userRole = data.userRole ?? null
  const canEdit =
    userRole != null
      ? userRole === 'commissioner' || userRole === 'co_commissioner'
      : Boolean(isCommissionerShell)
  const isHeadCommissioner =
    userRole != null ? userRole === 'commissioner' : Boolean(isHeadCommissionerShell)

  const isBestBall = isBestBallLeague(league.leagueVariant ?? null, league.bestBallMode ?? null)

  const handleAutoCoachLeagueToggle = async () => {
    const next = !(league.autoCoachEnabled ?? true)
    const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/autocoach-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoCoachEnabled: next }),
    })
    if (!res.ok) {
      toast.error('Could not update AutoCoach')
      return
    }
    toast.success(next ? 'AutoCoach allowed for managers' : 'AutoCoach disabled for this league')
    void refresh()
  }

  const setCoCommissioner = async (memberId: string, next: boolean) => {
    const res = await fetch('/api/league/settings/co-commissioners', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId, memberId, isCoCommissioner: next }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      toast.error(err.error ?? 'Update failed')
      return
    }
    toast.success(next ? 'Co-commissioner added' : 'Co-commissioner removed')
    void refresh()
  }

  return (
    <div className="h-full space-y-5 overflow-y-auto px-4 py-4">
      {!canEdit && userRole !== null ? (
        <div
          className="mb-4 flex items-center gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3"
          data-testid="league-settings-view-only-banner"
        >
          <span className="text-[16px] text-amber-400" aria-hidden>
            🔒
          </span>
          <p className="text-[12px] text-amber-300/80">{t('league.draftSettings.viewOnlyBanner')}</p>
        </div>
      ) : null}
      <div>
      <LeagueSettingsHeader isDirty={dirty} onSaveAll={() => void saveAll()} canEdit={canEdit} />
      <SettingsNav canEdit={canEdit} />

      {localSubGate && !gateOptional ? (
        <SubscriptionGateModal
          isOpen={Boolean(localSubGate)}
          onClose={() => setLocalSubGate(null)}
          featureId={localSubGate}
        />
      ) : null}

      <SettingsSection
        id="draft-time"
        title="Draft Time"
        description="All times are stored in UTC and displayed in your league's timezone."
      >
        <SettingsRow
          label="Draft Date & Time"
          description={`Set when your draft begins. Your league timezone (${league.timezone}) applies.`}
          faqText="Draft time is stored in UTC and shown to all managers converted to their local time. The league timezone is the source of truth — if you change it, all scheduled times update automatically."
          control={
            <div className="flex max-w-xs flex-col gap-2">
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={localDate}
                  disabled={!canEdit}
                  onChange={(e) => { setLocalDate(e.target.value); setDirty(true) }}
                />
                <Input
                  type="time"
                  value={localTime}
                  disabled={!canEdit}
                  onChange={(e) => { setLocalTime(e.target.value); setDirty(true) }}
                />
              </div>
              <Select value={tzDraft} disabled={!canEdit} onChange={(v) => { setTzDraft(v); setDirty(true) }}>
                {COMMON_TIMEZONES.map((z) => (
                  <option key={z.value} value={z.value}>
                    {z.label}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => void saveDraftTime()}
                className="rounded-xl bg-cyan-500 px-3 py-2 text-[12px] font-bold text-black hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save Draft Time
              </button>
              <p className="text-[11px] text-white/40">
                New UTC preview: {utcPreview} UTC
                <br />
                Last saved local: {leagueLocalPreview} ({String(s?.timezone ?? tzDraft)})
              </p>
            </div>
          }
        />
      </SettingsSection>

      {canEdit ? (
        <SettingsSection
        id="automation"
        title="Automation"
        description="Control how the draft handles timers, pauses, and auto-picks."
      >
        <SettingsRow
          label="Autostart Draft"
          description="Draft begins automatically at the scheduled time."
          faqText="When enabled, the draft starts automatically at your scheduled time. Works for both live and slow drafts. Requires a draft time to be set."
          control={<Toggle checked={Boolean(s?.autostart)} onChange={(v) => void patch({ autostart: v })} />}
        />
        <SettingsRow
          label="Slow Draft Auto-Pause"
          description="Pause the draft daily during a quiet window."
          faqText="For slow/long drafts, pause activity during overnight or off-hours. Times are in your league's timezone."
          control={
            <div>
              <Toggle
                checked={Boolean(s?.slowDraftPause)}
                onChange={(v) => void patch({ slowDraftPause: v })}
              />
              {s?.slowDraftPause ? (
                <div className="mt-3 flex items-center gap-3">
                  <div>
                    <label className="mb-1 block text-[10px] text-white/40">Pause From</label>
                    <Input
                      type="time"
                      value={String(s?.slowPauseFrom ?? '22:00')}
                      onChange={(e) => void patch({ slowPauseFrom: e.target.value })}
                    />
                  </div>
                  <span className="text-[12px] text-white/30">→</span>
                  <div>
                    <label className="mb-1 block text-[10px] text-white/40">Pause Until</label>
                    <Input
                      type="time"
                      value={String(s?.slowPauseUntil ?? '08:00')}
                      onChange={(e) => void patch({ slowPauseUntil: e.target.value })}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          }
        />
        <SettingsRow
          label="CPU Auto-Pick"
          description="System picks the highest-ranked available player when timer expires."
          faqText="When a manager's timer runs out, the system automatically drafts the top-available player by ADP/ranking that fits a roster need."
          control={<Toggle checked={Boolean(s?.cpuAutoPick ?? true)} onChange={(v) => void patch({ cpuAutoPick: v })} />}
        />
        <SettingsRow
          label="AI Auto-Pick"
          description="Chimmy AI drafts intelligently when timer expires — considers roster build, positional scarcity, projections, and bye weeks."
          faqText="AI Auto-Pick uses Chimmy to make smart draft decisions. Falls back to CPU if AI unavailable."
          control={
            <div>
              <Toggle checked={Boolean(s?.aiAutoPick)} onChange={(v) => void patch({ aiAutoPick: v })} />
              {s?.aiAutoPick ? (
                <p className="mt-1.5 text-[10px] text-cyan-400/70">✓ AI takes priority over CPU auto-pick</p>
              ) : null}
            </div>
          }
        />
        </SettingsSection>
      ) : null}

      <SettingsSection id="draft-format" title="Draft Format">
        <SettingsRow
          label="Draft Type"
          faqText="Snake: order reverses each round. Linear: same order every round. 3rd Round Reversal: snake until round 3, then reverses again. Auction: bidding."
          control={
            <Select
              value={draftType}
              disabled={!canEdit}
              onChange={(v) => void patch({ draftType: v })}
            >
              <option value="snake">Snake</option>
              <option value="linear">Linear (Non-Snake)</option>
              <option value="3rd_reversal">3rd Round Reversal</option>
              <option value="auction">Auction</option>
            </Select>
          }
        />
        <SettingsRow
          label="Time Per Pick"
          faqText="How long each manager has to make their selection. Custom allows 10 seconds to 7 days."
          control={
            <div className="flex max-w-sm flex-col gap-2">
              <Select
                value={preset}
                disabled={!canEdit}
                onChange={(v) => {
                  setPreset(v)
                  setDirty(true)
                }}
              >
                <option value="30s">30 seconds</option>
                <option value="60s">1 minute</option>
                <option value="90s">90 seconds</option>
                <option value="120s">2 minutes (default)</option>
                <option value="300s">5 minutes</option>
                <option value="600s">10 minutes</option>
                <option value="1800s">30 minutes</option>
                <option value="3600s">1 hour</option>
                <option value="3h">3 hours</option>
                <option value="8h">8 hours</option>
                <option value="24h">1 day</option>
                <option value="custom">Custom…</option>
              </Select>
              {preset === 'custom' ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    className="w-28"
                    min={10}
                    max={604800}
                    value={customValue}
                    disabled={!canEdit}
                    onChange={(e) => {
                      setCustomValue(e.target.value)
                      setDirty(true)
                    }}
                  />
                  <Select
                    value={customUnit}
                    disabled={!canEdit}
                    onChange={(v) => {
                      setCustomUnit(v as 'seconds' | 'minutes' | 'hours')
                      setDirty(true)
                    }}
                  >
                    <option value="seconds">seconds</option>
                    <option value="minutes">minutes</option>
                    <option value="hours">hours</option>
                  </Select>
                </div>
              ) : null}
              {preset === 'custom' && totalSecondsPick < 10 ? (
                <p className="text-[11px] text-red-400">⚠ Minimum 10 seconds per pick.</p>
              ) : null}
              {preset === 'custom' && totalSecondsPick > 172800 ? (
                <p className="text-[11px] text-amber-400">⚠ This is longer than 2 days per pick.</p>
              ) : null}
              {preset !== 'custom' && totalSecondsPick < 30 ? (
                <p className="text-[11px] text-amber-400">⚠ Very fast clock — managers may miss picks.</p>
              ) : null}
              <p className="text-[11px] text-cyan-400/70">Each manager will have {humanDuration(totalSecondsPick)} to make a pick.</p>
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => void savePickTimer()}
                className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-1.5 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save pick clock
              </button>
            </div>
          }
        />
        <SettingsRow
          label="Number of Rounds"
          faqText="Number of rounds = players each team drafts. Should typically match roster slots."
          control={
            <div className="flex flex-col gap-1.5">
              <Select
                value={rounds}
                disabled={!canEdit}
                onChange={(v) => void patch({ rounds: Number(v) })}
              >
                {Array.from({ length: 30 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1} rounds
                  </option>
                ))}
              </Select>
              <p className="text-[11px] text-white/40">
                League roster: {totalRosterSlots} slots
                {rounds !== totalRosterSlots ? (
                  <span className="ml-2 text-amber-400">
                    ⚠ Rounds don&apos;t match roster size ({totalRosterSlots})
                  </span>
                ) : null}
              </p>
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection
        id="draft-order"
        title="Draft Order"
        description="Assign how teams are ordered in the draft. Commissioner only."
      >
        <SettingsRow
          label="Order Method"
          faqText="How the draft order is determined. Manual: assign slots. Randomized: system shuffles."
          control={
            <div>
              <Select
                value={method}
                disabled={!canEdit}
                onChange={(v) => void handleMethodChange(v)}
              >
                <option value="manual">Manual Assignment</option>
                <option value="randomized">Randomized</option>
                <option value="prev_standings">Previous Season Standings</option>
                <option value="worst_to_first">Worst to First</option>
                {draftType !== 'auction' ? <option value="reverse_max_pf">Reverse Max PF</option> : null}
                <option value="custom_import">Custom Imported Order</option>
              </Select>
              {draftType === 'auction' ? (
                <p className="mt-1.5 text-[11px] text-amber-400">⚠ Reverse Max PF is unavailable for auction drafts.</p>
              ) : null}
            </div>
          }
        />

        {method === 'randomized' ? (
          <div className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
            <p className="mb-3 text-[13px] font-semibold text-white">Randomizer</p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-[11px] text-white/40">Times to randomize</label>
                <div className="flex flex-wrap gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setRandomizeCount(n)}
                      className={`h-9 w-9 rounded-lg text-[13px] font-bold transition ${
                        randomizeCount === n ? 'bg-cyan-500 text-black' : 'bg-white/[0.07] text-white hover:bg-white/[0.12]'
                      } disabled:cursor-not-allowed disabled:opacity-40`}
                    >
                      {n}
                    </button>
                  ))}
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    placeholder="Custom"
                    className="w-20 text-center"
                    value={randomizeCount > 5 ? randomizeCount : ''}
                    disabled={!canEdit}
                    onChange={(e) => setRandomizeCount(Number(e.target.value) || 1)}
                  />
                </div>
                <p className="mt-1 text-[10px] text-white/30">Max 50 randomizations</p>
              </div>
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => void handleRandomize()}
                className="rounded-xl bg-cyan-500 px-4 py-2 text-[13px] font-bold text-black hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                🎲 Randomize
              </button>
            </div>
            {lastRandom?.performedAt ? (
              <div className="mt-3 text-[11px] text-white/30">
                Last randomized: {new Date(lastRandom.performedAt).toLocaleString()} ({lastRandom.count ?? '?'}×)
              </div>
            ) : null}
          </div>
        ) : null}

        {method === 'reverse_max_pf' ? (
          <div className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
            <p className="text-[12px] leading-relaxed text-white/60">
              <strong className="text-white/90">Max PF</strong> = best possible score a team could have produced. Non-playoff
              teams order by lowest Max PF (picks first). Playoff teams order by finish — champion always picks last.
            </p>
            {maxPfWarning ? <p className="mt-2 text-[11px] text-amber-400">{maxPfWarning}</p> : null}
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => void loadMaxPfOrder()}
              className="mt-3 text-[12px] text-cyan-400 underline hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Calculate order from last season →
            </button>
          </div>
        ) : null}

        <div className="mt-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[13px] font-semibold text-white">Draft Order</p>
            {!s?.draftOrderLocked && method === 'manual' ? (
              <p className="text-[11px] text-white/40">Drag to reorder</p>
            ) : null}
          </div>
          <DraftOrderList
            slots={slotRows}
            teams={league.teams}
            method={method}
            locked={Boolean(s?.draftOrderLocked)}
            readOnly={!canEdit}
            onReorder={handleReorder}
            onAssignSlot={handleAssignSlot}
          />
          {emptySlots > 0 ? (
            <p className="mt-2 text-[11px] text-amber-400">
              ⚠ {emptySlots} slots unassigned. League may not be full yet.
            </p>
          ) : null}
        </div>
      </SettingsSection>

      {isDispersalDraftLeague && canEdit && orphanApi ? (
        <div
          className={[
            'rounded-xl border p-4 mt-4',
            orphanApi.hasActiveDispersalDraft && orphanApi.activeDispersalDraftId
              ? 'border-emerald-500/25 bg-emerald-500/[0.04]'
              : orphanApi.orphanCount < 2
                ? [
                    'border-white/[0.06] opacity-50',
                    orphanApi.hasActiveDispersalDraft ? null : 'pointer-events-none',
                  ]
                    .filter(Boolean)
                    .join(' ')
                : orphanApi.dispersalDraftGated
                  ? 'border-amber-500/20 bg-amber-500/[0.03]'
                  : 'border-cyan-500/20 bg-cyan-500/[0.03]',
          ].join(' ')}
          data-testid="league-settings-dispersal-draft"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-bold text-white">🏈 Dispersal Draft</h4>
              <p className="text-xs text-white/50 mt-0.5">
                For orphaned teams or league downsizing. Pool assets and draft them among new managers.
              </p>
            </div>
            {orphanApi.dispersalDraftGated ? (
              <SubscriptionGateBadge
                featureId="commissioner_dispersal_draft"
                onClick={() => openDispersalGate('commissioner_dispersal_draft')}
              />
            ) : null}
          </div>

          {orphanApi.hasActiveDispersalDraft && orphanApi.activeDispersalDraftId ? (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-semibold text-emerald-200/90">Draft in Progress</p>
              <div className="flex flex-wrap gap-2">
                {dashboardEmbed ? (
                  <button
                    type="button"
                    className="inline-flex rounded-xl border border-emerald-400/35 bg-emerald-500/15 px-3 py-2 text-xs font-bold text-emerald-100"
                    data-testid="league-settings-dispersal-open-embed"
                    onClick={() =>
                      postOpenDraftOverlayMessage({
                        leagueId,
                        dispersalDraftId: orphanApi.activeDispersalDraftId as string,
                        source: 'LeagueSettingsTab-dispersal',
                      })
                    }
                  >
                    Open draft room →
                  </button>
                ) : (
                  <Link
                    href={`/league/${leagueId}/dispersal-draft/${orphanApi.activeDispersalDraftId}`}
                    className="inline-flex rounded-xl border border-emerald-400/35 bg-emerald-500/15 px-3 py-2 text-xs font-bold text-emerald-100"
                  >
                    Open draft room →
                  </Link>
                )}
              </div>
            </div>
          ) : null}

          {orphanApi.orphanCount < 2 && !orphanApi.hasActiveDispersalDraft ? (
            <p className="text-xs text-white/30 mt-2">
              {orphanApi.orphanCount === 0
                ? 'Requires 2+ orphaned teams — currently 0.'
                : '1 orphaned team — need at least 2 to run dispersal draft.'}
            </p>
          ) : null}

          {orphanApi.orphanCount >= 2 && !orphanApi.dispersalDraftGated && !orphanApi.hasActiveDispersalDraft ? (
            <>
              <p className="text-xs text-green-400/80 mt-2">
                ✓ {orphanApi.orphanCount} orphaned teams detected — {orphanApi.totalAssets} assets available
              </p>
              <div className="mt-3 flex gap-2 flex-wrap">
                <Link
                  href={`/league/${leagueId}/orphan-teams`}
                  className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/[0.05]"
                >
                  Manage Orphaned Teams
                </Link>
                <Link
                  href={`/league/${leagueId}/dispersal-draft/setup`}
                  className="rounded-xl bg-cyan-500/20 px-3 py-2 text-xs font-bold text-cyan-300 hover:bg-cyan-500/30"
                >
                  Set Up Dispersal Draft →
                </Link>
              </div>
            </>
          ) : null}

          {orphanApi.dispersalDraftGated && !orphanApi.hasActiveDispersalDraft ? (
            <div className="mt-3">
              <p className="text-xs text-amber-200/70">
                AF Commissioner subscription required to run dispersal drafts.
              </p>
              <Link
                href="/commissioner-upgrade?highlight=dispersal_draft"
                className="mt-2 inline-flex rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/15"
              >
                View AF Commissioner Plans →
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      {canEdit ? (
        <>
      <SettingsSection
        id="keepers"
        title="Keepers & Dynasty"
        description="Assign keepers or carryover dynasty players before the draft."
      >
        <SettingsRow
          label="Keeper Count"
          faqText="Number of players each team can keep from last season."
          control={
            <Select value={Number(s?.keeperCount ?? 0)} onChange={(v) => void patch({ keeperCount: Number(v) })}>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'No keepers' : `${n} keeper${n > 1 ? 's' : ''}`}
                </option>
              ))}
            </Select>
          }
        />
        <SettingsRow
          label="Round Cost for Keepers"
          description="Keepers cost the round they were originally drafted."
          faqText="When enabled, keeping a player costs the round they were drafted in the previous year."
          control={
            <Toggle
              checked={Boolean(s?.keeperRoundCost)}
              onChange={(v) => void patch({ keeperRoundCost: v })}
              disabled={Number(s?.keeperCount ?? 0) === 0}
            />
          }
        />
        <SettingsRow
          label="Dynasty Player Carryover"
          description="All rostered players carry over — no traditional draft."
          faqText="Requires league type = Dynasty in AllFantasy."
          control={
            <Toggle
              checked={Boolean(s?.dynastyCarryover)}
              onChange={(v) => void patch({ dynastyCarryover: v })}
              disabled={!league.isDynasty}
            />
          }
        />
        {(Number(s?.keeperCount ?? 0) > 0 || s?.dynastyCarryover) && (
          <button
            type="button"
            onClick={() => setKeeperOpen(true)}
            className="mt-2 rounded-xl border border-cyan-500/30 bg-transparent px-4 py-2 text-[12px] font-semibold text-cyan-400 hover:bg-cyan-500/10"
          >
            📋 Set Keeper / Dynasty Players
          </button>
        )}
      </SettingsSection>

      <SettingsSection
        id="player-pool"
        title="Player Pool"
        description="Filter which players are available to draft."
      >
        <SettingsRow
          label="Available Players"
          faqText="All Players = full pool. Rookies Only = dynasty rookie draft. Veterans Only = dispersal."
          control={
            <Select value={String(s?.playerPool ?? 'all')} onChange={(v) => void patch({ playerPool: v })}>
              <option value="all">All Players</option>
              <option value="rookies_only">Rookies Only</option>
              <option value="veterans_only">Veterans Only</option>
            </Select>
          }
        />
        <SettingsRow
          label="Alphabetical Sort"
          description="Players listed A–Z instead of by ranking/ADP."
          faqText="When enabled, the draft player list sorts alphabetically by last name."
          control={<Toggle checked={Boolean(s?.alphabeticalSort)} onChange={(v) => void patch({ alphabeticalSort: v })} />}
        />
      </SettingsSection>

      <SettingsSection
        id="ai-controls"
        title="AI Features"
        description="Configure AllFantasy AI assistance for your draft."
      >
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-cyan-500/12 bg-cyan-500/[0.06] p-3">
          <span className="text-[12px] font-semibold text-cyan-300">AI Scope:</span>
          <Select value={String(s?.aiScope ?? 'everyone')} onChange={(v) => void patch({ aiScope: v })} className="max-w-[220px]">
            <option value="everyone">Available to everyone</option>
            <option value="per_user">Optional per user</option>
            <option value="commissioner_only">Commissioner only</option>
            <option value="disabled">Disabled for all</option>
          </Select>
        </div>
        <SettingsRow
          label="AI Auto-Pick"
          description="Matches Automation → AI Auto-Pick."
          faqText="When a manager times out, Chimmy picks based on roster needs, value, scarcity, and bye weeks."
          control={<Toggle checked={Boolean(s?.aiAutoPick)} onChange={(v) => void patch({ aiAutoPick: v })} />}
        />
        <SettingsRow
          label="AI Queue Suggestions"
          faqText="Chimmy suggests players to queue before your pick."
          control={<Toggle checked={Boolean(s?.aiQueueSuggestions ?? true)} onChange={(v) => void patch({ aiQueueSuggestions: v })} />}
        />
        <SettingsRow
          label="Best Available Recommendations"
          faqText="Highlights best available by position in real time."
          control={<Toggle checked={Boolean(s?.aiBestAvailable ?? true)} onChange={(v) => void patch({ aiBestAvailable: v })} />}
        />
        <SettingsRow
          label="Roster Build Guidance"
          faqText="Monitors roster shape and alerts on positional imbalance."
          control={<Toggle checked={Boolean(s?.aiRosterGuidance ?? true)} onChange={(v) => void patch({ aiRosterGuidance: v })} />}
        />
        <SettingsRow
          label="Positional Scarcity Alerts"
          faqText="Warns when a position tier is about to run dry."
          control={<Toggle checked={Boolean(s?.aiScarcityAlerts ?? true)} onChange={(v) => void patch({ aiScarcityAlerts: v })} />}
        />
        <SettingsRow
          label="Draft Grade After Completion"
          faqText="Post-draft grades for each team."
          control={<Toggle checked={Boolean(s?.aiDraftGrade ?? true)} onChange={(v) => void patch({ aiDraftGrade: v })} />}
        />
        <SettingsRow
          label="Sleeper / Value Alerts"
          faqText="Flags players available below ADP."
          control={<Toggle checked={Boolean(s?.aiSleeperAlerts ?? true)} onChange={(v) => void patch({ aiSleeperAlerts: v })} />}
        />
        <SettingsRow
          label="Bye Week Awareness"
          faqText="Alerts when stacking players on the same bye."
          control={<Toggle checked={Boolean(s?.aiByeAwareness ?? true)} onChange={(v) => void patch({ aiByeAwareness: v })} />}
        />
        <SettingsRow
          label="Stack Suggestions"
          faqText="QB + pass-catcher stack ideas."
          control={<Toggle checked={Boolean(s?.aiStackSuggestions)} onChange={(v) => void patch({ aiStackSuggestions: v })} />}
        />
        <SettingsRow
          label="Risk / Upside Notes"
          faqText="Brief risk vs upside on suggestions."
          control={<Toggle checked={Boolean(s?.aiRiskUpsideNotes ?? true)} onChange={(v) => void patch({ aiRiskUpsideNotes: v })} />}
        />
      </SettingsSection>
        </>
      ) : null}

      {isHeadCommissioner ? (
        isBestBall ? (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
            <p className="text-sm font-bold text-white/80">⚡ AutoCoach AI</p>
            <p className="mt-1 text-xs text-white/45">
              Not available in Best Ball — lineups optimize automatically for this format.
            </p>
          </div>
        ) : (
          <div className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-bold text-white">
                  ⚡ AutoCoach AI
                  <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2 py-0.5 text-[9px] font-bold text-cyan-400">
                    FREE FOR LEAGUES
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-white/50">
                  Allow managers to use Chimmy AutoCoach in this league. AutoCoach automatically swaps injured or
                  inactive starters before games. Managers must have AF Pro to use it.
                </p>
              </div>
              <button
                type="button"
                aria-label="Toggle AutoCoach AI for this league"
                onClick={() => void handleAutoCoachLeagueToggle()}
                className={[
                  'relative h-6 w-11 shrink-0 rounded-full border transition-colors',
                  league.autoCoachEnabled ?? true ? 'border-cyan-400 bg-cyan-500' : 'border-white/20 bg-white/10',
                ].join(' ')}
              >
                <span
                  className={[
                    'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                    league.autoCoachEnabled ?? true ? 'translate-x-5' : 'translate-x-0.5',
                  ].join(' ')}
                />
              </button>
            </div>
            {!(league.autoCoachEnabled ?? true) ? (
              <p className="text-[11px] text-amber-400/80">
                AutoCoach is disabled for this league. Managers cannot use AutoCoach here even with AF Pro.
              </p>
            ) : null}
          </div>
        )
      ) : null}

      {isHeadCommissioner ? (
        <IntegritySettingsPanel
          leagueId={leagueId}
          hasAccess={integrityEnt.hasAccess('commissioner_integrity_monitoring')}
          upgradeUrl={getUpgradeUrlWithHighlightForFeature('commissioner_integrity_monitoring')}
        />
      ) : null}

      {canEdit ? (
        <SettingsSection
          id="chimmy-alerts"
          title="Chimmy Commissioner Alerts"
          description="Tune Chimmy alert frequency, channels, muted categories, and commissioner-only alert rules for your account while managing this league."
        >
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
            <ChimmyAlertPreferencesPanel role="commissioner" />
          </div>
        </SettingsSection>
      ) : null}

      {isHeadCommissioner ? (
        <SettingsSection id="co-commissioners" title="Co-Commissioners">
          <p className="mb-3 text-[12px] text-white/45">
            Co-commissioners can change settings but cannot reset the draft or manage other co-commissioners.
          </p>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03]">
            {league.teams.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between border-b border-white/[0.04] px-3 py-2.5 last:border-0"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  {member.avatarUrl ? (
                    <img src={member.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full" />
                  ) : (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[10px] font-bold text-white/50">
                      {(member.teamName || member.ownerName || '?').slice(0, 2)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-semibold text-white">{member.ownerName || member.teamName}</p>
                    {member.isCommissioner ? (
                      <p className="text-[10px] text-cyan-400">Commissioner</p>
                    ) : null}
                  </div>
                </div>
                {!member.isCommissioner ? (
                  <Toggle
                    checked={Boolean(member.isCoCommissioner)}
                    onChange={(v) => void setCoCommissioner(member.id, v)}
                    disabled={!canEdit}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </SettingsSection>
      ) : null}

      {canEdit ? (
        <SettingsSection id="reset" title="Safety & Reset">
          {isHeadCommissioner ? (
            <div className="rounded-xl border border-red-500/15 bg-red-500/[0.06] p-4">
              <div className="flex items-start gap-3">
                <span className="text-[20px]">⚠️</span>
                <div>
                  <p className="mb-1 text-[14px] font-bold text-red-400">Reset Draft</p>
                  <p className="mb-4 text-[12px] text-white/50">
                    This will clear all picks and return the draft to pre-draft state. Draft settings are preserved. This cannot be
                    undone.
                  </p>
                  <DangerButton onClick={() => setResetOpen(true)}>Reset Draft</DangerButton>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-white/40">Only the head commissioner can reset the draft.</p>
          )}
        </SettingsSection>
      ) : null}

      <ResetDraftModal
        open={resetOpen}
        leagueId={leagueId}
        onClose={() => setResetOpen(false)}
        onSuccess={() => toast.success('Draft has been reset.')}
      />
      <KeeperModal open={keeperOpen} leagueId={leagueId} teams={league.teams} onClose={() => setKeeperOpen(false)} />
      </div>
    </div>
  )
}
