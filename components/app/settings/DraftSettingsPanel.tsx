'use client'

import { useState, useCallback, useEffect } from 'react'
import type { DraftUISettings, TimerMode } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { useUserTimezone } from '@/hooks/useUserTimezone'

type DraftConfig = {
  draft_type?: string
  rounds?: number
  timer_seconds?: number | null
  slow_timer_seconds?: number | null
  snake_or_linear?: string
  pick_order_rules?: string
  third_round_reversal?: boolean
  autopick_behavior?: string
  queue_size_limit?: number | null
  pre_draft_ranking_source?: string
  roster_fill_order?: string
  position_filter_behavior?: string
  sport?: string
  variant?: string | null
  leagueSize?: number
}

type SessionVariantPayload = {
  keeperConfig?: { maxKeepers: number; deadline?: string | null; maxKeepersPerPosition?: Record<string, number> } | null
  devyConfig?: { enabled: boolean; devyRounds: number[] } | null
  c2cConfig?: { enabled: boolean; collegeRounds: number[] } | null
  auctionBudgetPerTeam?: number | null
}

type DraftOrderMode = 'randomize' | 'manual' | 'weighted_lottery'

type LotteryConfigPayload = {
  enabled?: boolean
  lotteryTeamCount?: number
  lotteryPickCount?: number
  eligibilityMode?: string
  weightingMode?: string
  fallbackOrder?: string
  tiebreakMode?: string
}

type DraftSettingsResponse = {
  config: DraftConfig | null
  draftUISettings: DraftUISettings
  isCommissioner: boolean
  variantSettings?: { config: DraftConfig | null; sessionVariant?: SessionVariantPayload | null; sessionPreDraft?: boolean }
  sessionVariant?: SessionVariantPayload | null
  sessionPreDraft?: boolean
  draftOrderMode?: DraftOrderMode
  lotteryRestriction?: string | null
  lotteryConfig?: LotteryConfigPayload | null
  lotteryLastSeed?: string | null
  lotteryLastRunAt?: string | null
}

const TIMER_MODE_OPTIONS: { value: TimerMode; label: string }[] = [
  { value: 'per_pick', label: 'Per pick' },
  { value: 'soft_pause', label: 'Soft pause' },
  { value: 'overnight_pause', label: 'Overnight pause' },
  { value: 'none', label: 'None' },
]

const AUTOPICK_BEHAVIOR_OPTIONS = [
  { value: 'queue-first', label: 'Queue first' },
  { value: 'bpa', label: 'Best player available' },
  { value: 'need-based', label: 'Need based' },
  { value: 'skip', label: 'Skip pick' },
] as const

const PRE_DRAFT_RANKING_SOURCE_OPTIONS = [
  { value: 'adp', label: 'ADP' },
  { value: 'ecr', label: 'ECR' },
  { value: 'projections', label: 'Projections' },
  { value: 'tiers', label: 'Tiers' },
  { value: 'custom', label: 'Custom' },
  { value: 'sport_default', label: 'Sport default' },
] as const

const ROSTER_FILL_ORDER_OPTIONS = [
  { value: 'starter_first', label: 'Starter first' },
  { value: 'need_based', label: 'Need based' },
  { value: 'bpa', label: 'Best player available' },
  { value: 'position_scarcity', label: 'Position scarcity' },
] as const

const POSITION_FILTER_BEHAVIOR_OPTIONS = [
  { value: 'all', label: 'All players' },
  { value: 'by_slot', label: 'By slot' },
  { value: 'by_need', label: 'By need' },
  { value: 'by_eligibility', label: 'By eligibility' },
] as const

const DEFAULT_SESSION_VARIANT: SessionVariantPayload = {
  keeperConfig: { maxKeepers: 0, deadline: null, maxKeepersPerPosition: {} },
  devyConfig: { enabled: false, devyRounds: [] },
  c2cConfig: { enabled: false, collegeRounds: [] },
  auctionBudgetPerTeam: 200,
}

function parseRoundList(value: string): number[] {
  return Array.from(
    new Set(
      value
        .split(/[,\s]+/)
        .map((token) => Number.parseInt(token.trim(), 10))
        .filter((round) => Number.isFinite(round) && round >= 1 && round <= 50)
    )
  ).sort((a, b) => a - b)
}

function parsePositionCaps(value: string): Record<string, number> {
  const result: Record<string, number> = {}
  const tokens = value
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
  for (const token of tokens) {
    const [positionRaw, capRaw] = token.split(':')
    const position = String(positionRaw ?? '').trim().toUpperCase()
    const cap = Number.parseInt(String(capRaw ?? '').trim(), 10)
    if (!position || !Number.isFinite(cap) || cap < 0) continue
    result[position] = Math.min(50, cap)
  }
  return result
}

function stringifyPositionCaps(caps: Record<string, number> | undefined | null): string {
  if (!caps || typeof caps !== 'object') return ''
  return Object.entries(caps)
    .map(([position, cap]) => `${position}:${cap}`)
    .join(', ')
}

function normalizeSessionVariant(input: SessionVariantPayload | null | undefined): SessionVariantPayload {
  const devyRounds = Array.isArray(input?.devyConfig?.devyRounds) ? input?.devyConfig?.devyRounds : []
  const collegeRounds = Array.isArray(input?.c2cConfig?.collegeRounds) ? input?.c2cConfig?.collegeRounds : []
  return {
    keeperConfig: {
      maxKeepers: Math.max(0, Math.min(50, Math.round(Number(input?.keeperConfig?.maxKeepers ?? 0) || 0))),
      deadline: input?.keeperConfig?.deadline ?? null,
      maxKeepersPerPosition: input?.keeperConfig?.maxKeepersPerPosition ?? {},
    },
    devyConfig: {
      enabled: Boolean(input?.devyConfig?.enabled),
      devyRounds,
    },
    c2cConfig: {
      enabled: Boolean(input?.c2cConfig?.enabled),
      collegeRounds,
    },
    auctionBudgetPerTeam: Number(input?.auctionBudgetPerTeam ?? 200),
  }
}

const DRAFT_TYPE_LABELS: Record<string, string> = {
  snake: 'Snake',
  linear: 'Linear',
  auction: 'Auction',
  slow_draft: 'Slow Draft',
  mock_draft: 'Mock Draft',
  devy_snake: 'Devy Snake',
  devy_linear: 'Devy Linear',
  devy_auction: 'Devy Auction',
  c2c_snake: 'C2C Snake',
  c2c_linear: 'C2C Linear',
  c2c_auction: 'C2C Auction',
  offline: 'Offline',
  auto: 'Auto',
  team: 'Team',
  third_round_reversal: '3rd Round Reversal',
  '3rd_reversal': '3rd Round Reversal',
}

function labelForDraftType(id: string): string {
  return DRAFT_TYPE_LABELS[id] ?? id.replace(/_/g, ' ')
}

export default function DraftSettingsPanel({ leagueId }: { leagueId: string }) {
  const { formatInTimezone } = useUserTimezone()
  const [data, setData] = useState<DraftSettingsResponse | null>(null)
  const [loading, setLoading] = useState(!!leagueId)
  const [error, setError] = useState<string | null>(null)
  const [uiSettings, setUISettings] = useState<DraftUISettings | null>(null)
  const [config, setConfig] = useState<DraftConfig | null>(null)
  const [sessionVariant, setSessionVariant] = useState<SessionVariantPayload | null>(null)
  // Format-scoped draft-type allowlist pulled from the canonical aggregate
  // endpoint so devy/c2c/salary_cap leagues see the right options instead
  // of a hardcoded snake/linear/auction list.
  const [availableDraftTypes, setAvailableDraftTypes] = useState<string[]>(['snake', 'linear', 'auction'])
  const [executionMode, setExecutionMode] = useState<'live' | 'auto' | 'offline'>('live')
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [sessionPreDraft, setSessionPreDraft] = useState(false)
  const [draftOrderMode, setDraftOrderMode] = useState<DraftOrderMode>('randomize')
  const [lotteryConfig, setLotteryConfig] = useState<LotteryConfigPayload | null>(null)
  const [lotteryPreview, setLotteryPreview] = useState<{ eligible: Array<{ displayName: string; oddsPercent: number; rank: number }>; message?: string } | null>(null)
  const [lotteryRunning, setLotteryRunning] = useState(false)
  const [orphanStatus, setOrphanStatus] = useState<{
    orphanRosterIds: string[]
    orphanTeamAiManagerEnabled: boolean
    recentActions: Array<{ action: string; createdAt: string; reason: string | null }>
  } | null>(null)

  const load = useCallback(async () => {
    if (!leagueId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/settings`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Failed to load draft settings')
        setData(null)
        return
      }
      setData(json)
      setUISettings(json.draftUISettings ?? null)
      setConfig(json.config ?? null)
      setSessionVariant(normalizeSessionVariant(json.variantSettings?.sessionVariant ?? json.sessionVariant ?? DEFAULT_SESSION_VARIANT))
      setSessionPreDraft(!!json.sessionPreDraft)
      if (json.draftOrderMode) setDraftOrderMode(json.draftOrderMode)
      if (json.lotteryConfig != null) setLotteryConfig(json.lotteryConfig)
      if (json.orphanStatus) setOrphanStatus(json.orphanStatus)

      // Side-fetch the format-scoped draft-type allowlist + current execution
      // mode from the canonical aggregate endpoint. Non-blocking; falls back
      // to snake/linear/auction + live if the endpoint 4xxs.
      fetch(`/api/leagues/${encodeURIComponent(leagueId)}/settings/draft`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((agg) => {
          const types = agg?.options?.draftTypes
          if (Array.isArray(types) && types.length > 0) {
            setAvailableDraftTypes(types as string[])
          }
          const mode = agg?.current?.executionMode
          if (mode === 'live' || mode === 'auto' || mode === 'offline') {
            setExecutionMode(mode)
          }
        })
        .catch(() => {})
    } catch {
      setError('Failed to load draft settings')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    load()
  }, [load])

  const handleSave = useCallback(async () => {
    if (!leagueId || !data?.isCommissioner) return
    setSaving(true)
    setSaveSuccess(false)
    try {
      const payload: Record<string, unknown> = {}
      if (uiSettings) Object.assign(payload, uiSettings)
      if (config && (config.draft_type || config.rounds != null || config.timer_seconds !== undefined || config.slow_timer_seconds !== undefined || config.third_round_reversal !== undefined || config.snake_or_linear || config.autopick_behavior || config.queue_size_limit !== undefined || config.pre_draft_ranking_source)) {
        payload.draft_type = config.draft_type
        payload.rounds = config.rounds
        payload.timer_seconds = config.timer_seconds
        payload.slow_timer_seconds = config.slow_timer_seconds
        payload.pick_order_rules = config.pick_order_rules ?? config.snake_or_linear
        payload.snake_or_linear = config.snake_or_linear
        payload.third_round_reversal = config.third_round_reversal
        payload.autopick_behavior = config.autopick_behavior
        payload.queue_size_limit = config.queue_size_limit
        payload.pre_draft_ranking_source = config.pre_draft_ranking_source
        payload.roster_fill_order = config.roster_fill_order
        payload.position_filter_behavior = config.position_filter_behavior
      }
      payload.draft_order_mode = draftOrderMode
      if (lotteryConfig && draftOrderMode === 'weighted_lottery') payload.lotteryConfig = lotteryConfig
      if (sessionPreDraft && sessionVariant && Object.keys(sessionVariant).length > 0) {
        payload.sessionVariant = sessionVariant
      }
      // Persist execution mode via the settings/draft PATCH endpoint
      // (separate from the main draft/settings route which handles timer, rounds, etc.)
      await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/settings/draft`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executionMode }),
      }).catch(() => {})
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Failed to save')
        return
      }
      setData((prev) => (prev ? { ...prev, draftUISettings: json.draftUISettings, config: json.config, draftOrderMode: json.draftOrderMode, lotteryConfig: json.lotteryConfig } : null))
      setUISettings(json.draftUISettings)
      setConfig(json.config ?? null)
      setSessionVariant(normalizeSessionVariant(json.variantSettings?.sessionVariant ?? json.sessionVariant ?? DEFAULT_SESSION_VARIANT))
      if (json.draftOrderMode) setDraftOrderMode(json.draftOrderMode)
      if (json.lotteryConfig != null) setLotteryConfig(json.lotteryConfig)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    } finally {
      setSaving(false)
    }
  }, [leagueId, uiSettings, config, sessionVariant, sessionPreDraft, draftOrderMode, lotteryConfig, data?.isCommissioner])

  const setUI = useCallback(<K extends keyof DraftUISettings>(key: K, value: DraftUISettings[K]) => {
    setUISettings((prev) => (prev ? { ...prev, [key]: value } : null))
  }, [])

  const setConfigField = useCallback(<K extends keyof DraftConfig>(key: K, value: DraftConfig[K]) => {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : null))
  }, [])

  const setSessionVariantField = useCallback((patch: Partial<SessionVariantPayload>) => {
    setSessionVariant((prev) => ({ ...(prev ?? {}), ...patch }))
  }, [])

  if (!leagueId) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Draft Settings</h3>
        <p className="mt-2 text-xs text-white/65">Select a league to view draft settings.</p>
      </section>
    )
  }

  if (loading && !data) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Draft Settings</h3>
        <p className="mt-2 text-xs text-white/65">Loading…</p>
      </section>
    )
  }

  if (error && !data) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Draft Settings</h3>
        <p className="mt-2 text-xs text-red-400/90">{error}</p>
      </section>
    )
  }

  const effectiveConfig = config ?? data?.config ?? null
  const isCommissioner = data?.isCommissioner ?? false
  const ui = uiSettings ?? data?.draftUISettings
  const effectiveSessionVariant = normalizeSessionVariant(sessionVariant ?? data?.sessionVariant ?? DEFAULT_SESSION_VARIANT)

  return (
    <section className="space-y-6 rounded-xl border border-white/10 bg-black/20 p-4">
      <h3 className="text-sm font-semibold text-white">Draft Variant Settings Hub</h3>
      <p className="text-xs text-white/65">
        One place for all draft variants: live, mock, auction, slow, keeper, devy, C2C. Commissioner can edit; settings apply deterministically.
      </p>

      {effectiveConfig && (
        <>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-white/70">Draft type & timer</h4>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <div><dt className="text-white/50">Sport / variant</dt><dd className="text-white/90">{effectiveConfig.sport ?? '—'}{effectiveConfig.variant ? ` · ${effectiveConfig.variant}` : ''}</dd></div>
            <div>
              <dt className="text-white/50">Draft type</dt>
              <dd className="text-white/90">
                {isCommissioner ? (
                  <select
                    value={effectiveConfig.draft_type ?? 'snake'}
                    onChange={(e) => setConfigField('draft_type', e.target.value)}
                    data-testid="commissioner-draft-type-select"
                    className="rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                  >
                    {availableDraftTypes.map((id) => (
                      <option key={id} value={id}>{labelForDraftType(id)}</option>
                    ))}
                  </select>
                ) : (effectiveConfig.draft_type ?? '—')}
              </dd>
            </div>
            <div>
              <dt className="text-white/50">Rounds</dt>
              <dd className="text-white/90">
                {isCommissioner ? (
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={effectiveConfig.rounds ?? 15}
                    onChange={(e) => setConfigField('rounds', parseInt(e.target.value, 10) || 15)}
                    className="w-16 rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                  />
                ) : (effectiveConfig.rounds ?? '—')}
              </dd>
            </div>
            <div>
              <dt className="text-white/50">Draft timer (seconds)</dt>
              <dd className="text-white/90">
                {isCommissioner ? (
                  <input
                    type="number"
                    min={0}
                    max={86400}
                    value={effectiveConfig.timer_seconds ?? ''}
                    onChange={(e) => setConfigField('timer_seconds', e.target.value === '' ? null : parseInt(e.target.value, 10))}
                    data-testid="commissioner-draft-timer-input"
                    placeholder="—"
                    className="w-20 rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                  />
                ) : (effectiveConfig.timer_seconds ?? '—')}
              </dd>
            </div>
            <div>
              <dt className="text-white/50">Slow draft timer (minutes)</dt>
              <dd className="text-white/90">
                {isCommissioner ? (
                  <input
                    type="number"
                    min={5}
                    max={10080}
                    value={Math.max(5, Math.round(Number(effectiveConfig.slow_timer_seconds ?? 3600) / 60))}
                    onChange={(e) => {
                      const minutes = Math.max(5, Math.min(10080, parseInt(e.target.value, 10) || 60))
                      setConfigField('slow_timer_seconds', minutes * 60)
                    }}
                    data-testid="commissioner-draft-slow-timer-input"
                    className="w-24 rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                  />
                ) : (effectiveConfig.slow_timer_seconds != null ? Math.round(Number(effectiveConfig.slow_timer_seconds) / 60) : '—')}
              </dd>
            </div>
            <div>
              <dt className="text-white/50">Snake / linear</dt>
              <dd className="text-white/90">
                {isCommissioner && effectiveConfig.draft_type !== 'auction' ? (
                  <select
                    value={effectiveConfig.snake_or_linear ?? effectiveConfig.pick_order_rules ?? 'snake'}
                    onChange={(e) => {
                      const v = e.target.value as string
                      setConfigField('snake_or_linear', v)
                      setConfigField('pick_order_rules', v)
                    }}
                    className="rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                  >
                    <option value="snake">Snake</option>
                    <option value="linear">Linear</option>
                  </select>
                ) : (effectiveConfig.snake_or_linear ?? effectiveConfig.pick_order_rules ?? '—')}
              </dd>
            </div>
            <div>
              <dt className="text-white/50">Execution mode</dt>
              <dd className="text-white/90">
                {isCommissioner ? (
                  <select
                    value={executionMode}
                    onChange={(e) => setExecutionMode(e.target.value as 'live' | 'auto' | 'offline')}
                    data-testid="commissioner-execution-mode-select"
                    className="rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                  >
                    <option value="live">Live</option>
                    <option value="auto">Auto (CPU drafts)</option>
                    <option value="offline">Offline (in-person)</option>
                  </select>
                ) : (executionMode === 'live' ? 'Live' : executionMode === 'auto' ? 'Auto (CPU drafts)' : 'Offline')}
              </dd>
            </div>
            {effectiveConfig.draft_type !== 'auction' && (effectiveConfig.snake_or_linear ?? effectiveConfig.pick_order_rules ?? 'snake') === 'snake' && (
            <div>
              <dt className="text-white/50">Third-round reversal</dt>
              <dd className="text-white/90">
                {isCommissioner ? (
                  <input
                    type="checkbox"
                    checked={!!effectiveConfig.third_round_reversal}
                    onChange={(e) => setConfigField('third_round_reversal', e.target.checked)}
                    className="rounded border-white/20"
                    title="Only applies to snake draft order"
                  />
                ) : (effectiveConfig.third_round_reversal ? 'Yes' : 'No')}
              </dd>
            </div>
            )}
            <div>
              <dt className="text-white/50">Autopick</dt>
              <dd className="text-white/90">
                {isCommissioner ? (
                  <select
                    value={effectiveConfig.autopick_behavior ?? 'queue-first'}
                    onChange={(e) => setConfigField('autopick_behavior', e.target.value)}
                    className="rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                  >
                    {AUTOPICK_BEHAVIOR_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                ) : (effectiveConfig.autopick_behavior ?? '—')}
              </dd>
            </div>
            <div>
              <dt className="text-white/50">Queue size limit</dt>
              <dd className="text-white/90">
                {isCommissioner ? (
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={effectiveConfig.queue_size_limit ?? 50}
                    onChange={(e) => setConfigField('queue_size_limit', parseInt(e.target.value, 10) || 50)}
                    className="w-16 rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                  />
                ) : (effectiveConfig.queue_size_limit ?? '—')}
              </dd>
            </div>
            <div>
              <dt className="text-white/50">Ranking source</dt>
              <dd className="text-white/90">
                {isCommissioner ? (
                  <select
                    value={effectiveConfig.pre_draft_ranking_source ?? 'adp'}
                    onChange={(e) => setConfigField('pre_draft_ranking_source', e.target.value)}
                    className="rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                  >
                    {PRE_DRAFT_RANKING_SOURCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                ) : (effectiveConfig.pre_draft_ranking_source ?? '—')}
              </dd>
            </div>
            <div>
              <dt className="text-white/50">Roster fill order</dt>
              <dd className="text-white/90">
                {isCommissioner ? (
                  <select
                    value={effectiveConfig.roster_fill_order ?? 'starter_first'}
                    onChange={(e) => setConfigField('roster_fill_order', e.target.value)}
                    className="rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                  >
                    {ROSTER_FILL_ORDER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                ) : (effectiveConfig.roster_fill_order ?? '—')}
              </dd>
            </div>
            <div>
              <dt className="text-white/50">Position filter behavior</dt>
              <dd className="text-white/90">
                {isCommissioner ? (
                  <select
                    value={effectiveConfig.position_filter_behavior ?? 'by_eligibility'}
                    onChange={(e) => setConfigField('position_filter_behavior', e.target.value)}
                    className="rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                  >
                    {POSITION_FILTER_BEHAVIOR_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                ) : (effectiveConfig.position_filter_behavior ?? '—')}
              </dd>
            </div>
          </dl>

          <h4 className="text-xs font-semibold uppercase tracking-wider text-white/70 mt-4">Draft order mode</h4>
          <p className="text-xs text-white/65 mb-2">How the initial draft order is determined (snake/linear/auction unchanged).</p>
          <div className="flex flex-wrap items-center gap-3">
            {isCommissioner ? (
              <select
                value={draftOrderMode}
                onChange={(e) => {
                  const v = e.target.value as DraftOrderMode
                  setDraftOrderMode(v)
                  if (v === 'weighted_lottery' && !lotteryConfig?.lotteryPickCount) {
                    setLotteryConfig({
                      enabled: true,
                      lotteryTeamCount: 6,
                      lotteryPickCount: 6,
                      eligibilityMode: 'non_playoff',
                      weightingMode: 'inverse_standings',
                      fallbackOrder: 'reverse_max_pf',
                      tiebreakMode: 'lower_max_pf',
                    })
                  }
                }}
                data-testid="commissioner-draft-order-mode-select"
                className="rounded border border-white/20 bg-black/40 px-3 py-1.5 text-sm text-white"
              >
                <option value="randomize">Randomize</option>
                <option value="manual">Manual</option>
                <option value="weighted_lottery" disabled={Boolean(data?.lotteryRestriction)}>Weighted lottery</option>
              </select>
            ) : (
              <span className="text-sm text-white/90">{draftOrderMode === 'weighted_lottery' ? 'Weighted lottery' : draftOrderMode === 'manual' ? 'Manual' : 'Randomize'}</span>
            )}
          </div>

          {data?.lotteryRestriction && <p className="text-xs text-white/65">{data.lotteryRestriction}</p>}

          {draftOrderMode === 'weighted_lottery' && (
            <div className="mt-4 rounded-lg border border-white/15 bg-black/30 p-4 space-y-3">
              <h5 className="text-xs font-semibold text-white/90">Weighted lottery (anti-tank)</h5>
              <p className="text-xs text-white/65">Worse teams get better odds at top picks. Run lottery then finalize to set draft order.</p>
              {isCommissioner && (
                <>
                  <div className="grid gap-2 text-xs sm:grid-cols-2">
                    <div>
                      <label className="text-white/50">Lottery teams</label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={lotteryConfig?.lotteryTeamCount ?? 6}
                        onChange={(e) => setLotteryConfig((c) => ({ ...c, lotteryTeamCount: parseInt(e.target.value, 10) || 6 }))}
                        className="ml-2 w-14 rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                      />
                    </div>
                    <div>
                      <label className="text-white/50">Lottery picks</label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={lotteryConfig?.lotteryPickCount ?? 6}
                        onChange={(e) => setLotteryConfig((c) => ({ ...c, lotteryPickCount: parseInt(e.target.value, 10) || 6 }))}
                        className="ml-2 w-14 rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        setLotteryPreview(null)
                        try {
                          const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/lottery/preview`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              lotteryTeamCount: lotteryConfig?.lotteryTeamCount ?? 6,
                              lotteryPickCount: lotteryConfig?.lotteryPickCount ?? 6,
                              eligibilityMode: lotteryConfig?.eligibilityMode ?? 'non_playoff',
                              weightingMode: lotteryConfig?.weightingMode ?? 'inverse_standings',
                              fallbackOrder: lotteryConfig?.fallbackOrder ?? 'reverse_max_pf',
                              tiebreakMode: lotteryConfig?.tiebreakMode ?? 'lower_max_pf',
                            }),
                          })
                          const json = await res.json().catch(() => ({}))
                          if (res.ok && json.eligible) setLotteryPreview({ eligible: json.eligible, message: json.message })
                          else setLotteryPreview({ eligible: [], message: json.error || 'Failed to load odds' })
                        } catch {
                          setLotteryPreview({ eligible: [], message: 'Request failed' })
                        }
                      }}
                      className="rounded bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
                    >
                      Preview odds
                    </button>
                    <p className="text-xs text-white/50">Save draft settings first if you changed lottery teams/picks.</p>
                    <button
                      type="button"
                      disabled={lotteryRunning}
                      onClick={async () => {
                        setLotteryRunning(true)
                        try {
                          const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/lottery/run`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ finalize: true }),
                          })
                          const json = await res.json().catch(() => ({}))
                          if (res.ok && json.finalized) {
                            setLotteryPreview(null)
                            void load()
                          } else {
                            setLotteryPreview((p) => ({ ...p ?? { eligible: [] }, message: json.error || 'Run failed' }))
                          }
                        } finally {
                          setLotteryRunning(false)
                        }
                      }}
                      className="rounded bg-amber-600/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                    >
                      {lotteryRunning ? 'Running…' : 'Run lottery & finalize order'}
                    </button>
                  </div>
                  {lotteryPreview && (
                    <div className="mt-2 text-xs">
                      {lotteryPreview.message && <p className="text-amber-400/90">{lotteryPreview.message}</p>}
                      {lotteryPreview.eligible.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-white/80">
                          {lotteryPreview.eligible.slice(0, 12).map((e, i) => (
                            <li key={i}>{e.displayName}: {e.oddsPercent.toFixed(1)}%</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </>
              )}
              {data?.lotteryLastRunAt && (
                <p className="text-xs text-white/50">Last run: {formatInTimezone(data.lotteryLastRunAt)}{data.lotteryLastSeed ? ` · Seed: ${data.lotteryLastSeed}` : ''}</p>
              )}
            </div>
          )}
        </>
      )}

      {ui && (
        <>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-white/70">Draft room display & behavior</h4>
          <div className="space-y-3">
            <label className="flex items-center justify-between gap-4 text-xs text-white/90">
              <span>Draft order randomization</span>
              <input
                type="checkbox"
                checked={ui.draftOrderRandomizationEnabled}
                onChange={(e) => setUI('draftOrderRandomizationEnabled', e.target.checked)}
                disabled={!isCommissioner}
                className="rounded border-white/20"
                data-testid="commissioner-draft-order-randomization-toggle"
              />
            </label>
            <label className="flex items-center justify-between gap-4 text-xs text-white/90">
              <span>Pick trade allowed</span>
              <input
                type="checkbox"
                checked={ui.pickTradeEnabled}
                onChange={(e) => setUI('pickTradeEnabled', e.target.checked)}
                disabled={!isCommissioner}
                className="rounded border-white/20"
                data-testid="commissioner-draft-pick-trade-toggle"
              />
            </label>
            <label className="flex items-center justify-between gap-4 text-xs text-white/90">
              <span>Traded-pick color mode</span>
              <input
                type="checkbox"
                checked={ui.tradedPickColorModeEnabled}
                onChange={(e) => setUI('tradedPickColorModeEnabled', e.target.checked)}
                disabled={!isCommissioner}
                className="rounded border-white/20"
                data-testid="commissioner-draft-traded-pick-color-toggle"
              />
            </label>
            <label className="flex items-center justify-between gap-4 text-xs text-white/90">
              <span>Traded-pick owner name in red</span>
              <input
                type="checkbox"
                checked={ui.tradedPickOwnerNameRedEnabled}
                onChange={(e) => setUI('tradedPickOwnerNameRedEnabled', e.target.checked)}
                disabled={!isCommissioner}
                className="rounded border-white/20"
              />
            </label>
            <label className="flex items-center justify-between gap-4 text-xs text-white/90">
              <span>AI ADP enabled</span>
              <input
                type="checkbox"
                checked={ui.aiAdpEnabled}
                onChange={(e) => setUI('aiAdpEnabled', e.target.checked)}
                disabled={!isCommissioner}
                className="rounded border-white/20"
                data-testid="commissioner-draft-ai-adp-toggle"
              />
            </label>
            <label className="flex items-center justify-between gap-4 text-xs text-white/90">
              <span>AI queue reorder enabled</span>
              <input
                type="checkbox"
                checked={ui.aiQueueReorderEnabled}
                onChange={(e) => setUI('aiQueueReorderEnabled', e.target.checked)}
                disabled={!isCommissioner}
                className="rounded border-white/20"
                data-testid="commissioner-draft-ai-queue-reorder-toggle"
              />
            </label>
            <label className="flex items-center justify-between gap-4 text-xs text-white/90">
              <span>CPU manager for empty teams</span>
              <input
                type="checkbox"
                checked={ui.orphanTeamAiManagerEnabled && (ui.orphanDrafterMode ?? 'cpu') === 'cpu'}
                onChange={(e) => {
                  const enabled = e.target.checked
                  setUI('orphanTeamAiManagerEnabled', enabled)
                  if (enabled) setUI('orphanDrafterMode', 'cpu')
                }}
                disabled={!isCommissioner}
                className="rounded border-white/20"
                data-testid="commissioner-draft-cpu-manager-toggle"
              />
            </label>
            <label className="flex items-center justify-between gap-4 text-xs text-white/90">
              <span>AI manager for empty teams (optional)</span>
              <input
                type="checkbox"
                checked={ui.orphanTeamAiManagerEnabled && (ui.orphanDrafterMode ?? 'cpu') === 'ai'}
                onChange={(e) => {
                  const enabled = e.target.checked
                  setUI('orphanTeamAiManagerEnabled', enabled)
                  setUI('orphanDrafterMode', enabled ? 'ai' : 'cpu')
                }}
                disabled={!isCommissioner}
                className="rounded border-white/20"
                data-testid="commissioner-draft-ai-manager-toggle"
              />
            </label>
            {isCommissioner && orphanStatus && (
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80">
                <p>
                  Orphan rosters: <strong className="text-white">{orphanStatus.orphanRosterIds.length}</strong>
                  {ui.orphanTeamAiManagerEnabled
                    ? (ui.orphanDrafterMode === 'ai'
                        ? ' · AI manager will draft (fallback to CPU if unavailable).'
                        : ' · CPU manager will draft for them when on the clock.')
                    : ' · Enable toggle above to let CPU or AI draft for orphan teams.'}
                </p>
                {orphanStatus.recentActions.length > 0 && (
                  <p className="mt-1 text-white/60">
                    Last action: {orphanStatus.recentActions[0].action} at {formatInTimezone(orphanStatus.recentActions[0].createdAt)}
                  </p>
                )}
              </div>
            )}
            <label className="flex items-center justify-between gap-4 text-xs text-white/90">
              <span>Live draft chat sync with league chat</span>
              <input
                type="checkbox"
                checked={ui.liveDraftChatSyncEnabled}
                onChange={(e) => setUI('liveDraftChatSyncEnabled', e.target.checked)}
                disabled={!isCommissioner}
                className="rounded border-white/20"
              />
            </label>
            <label className="flex items-center justify-between gap-4 text-xs text-white/90">
              <span>Draft import enabled</span>
              <input
                type="checkbox"
                checked={ui.importEnabled ?? true}
                onChange={(e) => setUI('importEnabled', e.target.checked)}
                disabled={!isCommissioner}
                className="rounded border-white/20"
                data-testid="commissioner-draft-import-enabled-toggle"
              />
            </label>
            <label className="flex items-center justify-between gap-4 text-xs text-white/90">
              <span>Auto-pick enabled</span>
              <input
                type="checkbox"
                checked={ui.autoPickEnabled}
                onChange={(e) => setUI('autoPickEnabled', e.target.checked)}
                disabled={!isCommissioner}
                className="rounded border-white/20"
              />
            </label>
            <div className="flex items-center justify-between gap-4 text-xs text-white/90">
              <span>Timer mode</span>
              <select
                value={ui.timerMode}
                onChange={(e) => setUI('timerMode', e.target.value as TimerMode)}
                disabled={!isCommissioner}
                className="rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
              >
                {TIMER_MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            {ui.timerMode === 'overnight_pause' && isCommissioner && (
              <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2 text-xs">
                <p className="text-white/80 font-medium">Slow draft overnight pause window</p>
                <p className="text-white/50">Timer does not count down during this window (e.g. 10pm–8am).</p>
                <div className="flex flex-wrap gap-2 items-center">
                  <label className="flex items-center gap-1.5">
                    <span className="text-white/60">Start</span>
                    <input
                      type="text"
                      placeholder="22:00"
                      value={ui.slowDraftPauseWindow?.start ?? ''}
                      onChange={(e) => setUI('slowDraftPauseWindow', { ...(ui.slowDraftPauseWindow ?? { start: '', end: '', timezone: 'America/New_York' }), start: e.target.value })}
                      className="w-16 rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span className="text-white/60">End</span>
                    <input
                      type="text"
                      placeholder="08:00"
                      value={ui.slowDraftPauseWindow?.end ?? ''}
                      onChange={(e) => setUI('slowDraftPauseWindow', { ...(ui.slowDraftPauseWindow ?? { start: '', end: '', timezone: 'America/New_York' }), end: e.target.value })}
                      className="w-16 rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span className="text-white/60">Timezone</span>
                    <input
                      type="text"
                      placeholder="America/New_York"
                      value={ui.slowDraftPauseWindow?.timezone ?? ''}
                      onChange={(e) => setUI('slowDraftPauseWindow', { ...(ui.slowDraftPauseWindow ?? { start: '', end: '', timezone: 'America/New_York' }), timezone: e.target.value })}
                      className="w-40 rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                    />
                  </label>
                </div>
              </div>
            )}
            <label className="flex items-center justify-between gap-4 text-xs text-white/90">
              <span>Commissioner force auto-pick enabled</span>
              <input
                type="checkbox"
                checked={ui.commissionerForceAutoPickEnabled}
                onChange={(e) => setUI('commissionerForceAutoPickEnabled', e.target.checked)}
                disabled={!isCommissioner}
                className="rounded border-white/20"
              />
            </label>
          </div>

          {sessionPreDraft && (
            <>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-white/70">Keeper rules</h4>
              <div className="space-y-2 text-xs rounded-lg border border-white/10 bg-black/25 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-white/70">Max keepers</span>
                  {isCommissioner ? (
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={effectiveSessionVariant.keeperConfig?.maxKeepers ?? 0}
                      onChange={(e) => setSessionVariantField({ keeperConfig: { ...(effectiveSessionVariant.keeperConfig ?? { maxKeepers: 0 }), maxKeepers: parseInt(e.target.value, 10) || 0 } })}
                      className="w-16 rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                      data-testid="commissioner-draft-keeper-max-input"
                    />
                  ) : (
                    <span className="text-white/90">{effectiveSessionVariant.keeperConfig?.maxKeepers ?? 0}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white/70">Keeper deadline (ISO)</span>
                  {isCommissioner ? (
                    <input
                      type="text"
                      value={effectiveSessionVariant.keeperConfig?.deadline ?? ''}
                      onChange={(e) => setSessionVariantField({ keeperConfig: { ...(effectiveSessionVariant.keeperConfig ?? { maxKeepers: 0 }), deadline: e.target.value.trim() || null } })}
                      className="w-64 rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                      placeholder="2026-08-15T23:59:00.000Z"
                      data-testid="commissioner-draft-keeper-deadline-input"
                    />
                  ) : (
                    <span className="text-white/90">{effectiveSessionVariant.keeperConfig?.deadline ?? '—'}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white/70">Max keepers per position</span>
                  {isCommissioner ? (
                    <input
                      type="text"
                      value={stringifyPositionCaps(effectiveSessionVariant.keeperConfig?.maxKeepersPerPosition)}
                      onChange={(e) => setSessionVariantField({
                        keeperConfig: {
                          ...(effectiveSessionVariant.keeperConfig ?? { maxKeepers: 0 }),
                          maxKeepersPerPosition: parsePositionCaps(e.target.value),
                        },
                      })}
                      className="w-64 rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                      placeholder="QB:1, RB:3, WR:3"
                      data-testid="commissioner-draft-keeper-position-caps-input"
                    />
                  ) : (
                    <span className="text-white/90">{stringifyPositionCaps(effectiveSessionVariant.keeperConfig?.maxKeepersPerPosition) || '—'}</span>
                  )}
                </div>
              </div>

              <h4 className="text-xs font-semibold uppercase tracking-wider text-white/70">Devy rules</h4>
              <div className="space-y-2 text-xs rounded-lg border border-white/10 bg-black/25 p-3">
                <label className="flex items-center gap-2 text-white/90">
                  <input
                    type="checkbox"
                    checked={!!effectiveSessionVariant.devyConfig?.enabled}
                    onChange={(e) => setSessionVariantField({ devyConfig: e.target.checked ? { enabled: true, devyRounds: effectiveSessionVariant.devyConfig?.devyRounds ?? [] } : { enabled: false, devyRounds: [] } })}
                    disabled={!isCommissioner}
                    className="rounded border-white/20"
                    data-testid="commissioner-draft-devy-enabled-toggle"
                  />
                  Devy rounds enabled (rounds as comma list, e.g. 14,15)
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-white/70">Devy rounds</span>
                  {isCommissioner ? (
                    <input
                      type="text"
                      value={(effectiveSessionVariant.devyConfig?.devyRounds ?? []).join(', ')}
                      onChange={(e) => setSessionVariantField({
                        devyConfig: {
                          enabled: effectiveSessionVariant.devyConfig?.enabled ?? false,
                          devyRounds: parseRoundList(e.target.value),
                        },
                      })}
                      className="w-56 rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                      placeholder="14, 15"
                      data-testid="commissioner-draft-devy-rounds-input"
                    />
                  ) : (
                    <span className="text-white/90">{(effectiveSessionVariant.devyConfig?.devyRounds ?? []).join(', ') || '—'}</span>
                  )}
                </div>
              </div>

              <h4 className="text-xs font-semibold uppercase tracking-wider text-white/70">C2C rules</h4>
              <div className="space-y-2 text-xs rounded-lg border border-white/10 bg-black/25 p-3">
                <label className="flex items-center gap-2 text-white/90">
                  <input
                    type="checkbox"
                    checked={!!effectiveSessionVariant.c2cConfig?.enabled}
                    onChange={(e) => setSessionVariantField({ c2cConfig: e.target.checked ? { enabled: true, collegeRounds: effectiveSessionVariant.c2cConfig?.collegeRounds ?? [] } : { enabled: false, collegeRounds: [] } })}
                    disabled={!isCommissioner}
                    className="rounded border-white/20"
                    data-testid="commissioner-draft-c2c-enabled-toggle"
                  />
                  College vs pro rounds enabled
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-white/70">College rounds</span>
                  {isCommissioner ? (
                    <input
                      type="text"
                      value={(effectiveSessionVariant.c2cConfig?.collegeRounds ?? []).join(', ')}
                      onChange={(e) => setSessionVariantField({
                        c2cConfig: {
                          enabled: effectiveSessionVariant.c2cConfig?.enabled ?? false,
                          collegeRounds: parseRoundList(e.target.value),
                        },
                      })}
                      className="w-56 rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                      placeholder="1, 2, 3"
                      data-testid="commissioner-draft-c2c-rounds-input"
                    />
                  ) : (
                    <span className="text-white/90">{(effectiveSessionVariant.c2cConfig?.collegeRounds ?? []).join(', ') || '—'}</span>
                  )}
                </div>
              </div>

              {effectiveConfig?.draft_type === 'auction' && (
                <>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-white/70">Auction budget rules</h4>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-white/70">Budget per team</span>
                    {isCommissioner ? (
                      <input
                        type="number"
                        min={1}
                        max={10000}
                        value={effectiveSessionVariant.auctionBudgetPerTeam ?? 200}
                        onChange={(e) => setSessionVariantField({ auctionBudgetPerTeam: parseInt(e.target.value, 10) || 200 })}
                        className="w-20 rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                      />
                    ) : (
                      <span className="text-white/90">{effectiveSessionVariant.auctionBudgetPerTeam ?? 200}</span>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          <h4 className="text-xs font-semibold uppercase tracking-wider text-white/70">Import</h4>
          <p className="text-xs text-white/50">Draft import is available from the commissioner control center in the draft room (Import draft data).</p>

          {isCommissioner && (
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                data-testid="commissioner-draft-save"
                className="rounded-lg border border-cyan-500/40 bg-cyan-500/20 px-4 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save draft variant settings'}
              </button>
              {saveSuccess && <span className="text-xs text-emerald-400">Saved.</span>}
            </div>
          )}
        </>
      )}
    </section>
  )
}
