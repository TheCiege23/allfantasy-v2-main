'use client'

import { useEffect, useState } from 'react'
import type { CommissionerSettingsFormData } from '@/lib/league/commissioner-league-patch'
import { COMMON_TIMEZONES } from '@/lib/timezone'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import type { LeagueSport } from '@prisma/client'
import { PremiumGate } from '@/components/subscription/PremiumGate'
import { SubscriptionGateBadge } from '@/components/subscription/SubscriptionGateBadge'
import { useEntitlements } from '@/hooks/useEntitlements'
import { useSubscriptionGateOptional } from '@/hooks/useSubscriptionGate'
import {
  SettingsPanelHeading,
  SettingsSectionLabel,
  SettingsHelper,
  SettingsToggleRow,
  SettingsRadioGroup,
  controlClass,
} from './settings-ui'

export function LeagueSettingsPanel({
  leagueId,
  initialData,
  settingsSnapshot = {},
  hasAfCommissionerSub,
  canEdit,
  save,
  debouncedSave,
}: {
  leagueId: string
  initialData: CommissionerSettingsFormData
  /** Raw `League.settings` JSON (description, listing visibility, etc.). */
  settingsSnapshot?: Record<string, unknown>
  hasAfCommissionerSub: boolean
  canEdit: boolean
  save: (partial: Record<string, unknown>) => Promise<void>
  debouncedSave: (partial: Record<string, unknown>) => void
}) {
  const [name, setName] = useState(initialData.name ?? '')
  const [sport, setSport] = useState<LeagueSport>((initialData.sport ?? 'NFL') as LeagueSport)
  const [season, setSeason] = useState(initialData.season ?? new Date().getFullYear())
  const [language, setLanguage] = useState(initialData.language ?? 'en')
  const [leagueDescription, setLeagueDescription] = useState(
    typeof settingsSnapshot.leagueDescription === 'string' ? settingsSnapshot.leagueDescription : '',
  )
  const [listingVisibility, setListingVisibility] = useState(
    typeof settingsSnapshot.leagueListingVisibility === 'string' ? settingsSnapshot.leagueListingVisibility : 'private',
  )
  const [timezone, setTimezone] = useState(initialData.timezone ?? 'America/New_York')
  const [medianGame, setMedianGame] = useState(Boolean(initialData.medianGame))
  const [leagueType, setLeagueType] = useState((initialData.leagueType ?? 'redraft') as string)
  const [leagueSize, setLeagueSize] = useState(initialData.leagueSize ?? 12)
  const [allowPreDraft, setAllowPreDraft] = useState(Boolean(initialData.allowPreDraftMoves))
  const [preventBenchDrops, setPreventBenchDrops] = useState(Boolean(initialData.preventBenchDrops))
  const [lockMoves, setLockMoves] = useState(Boolean(initialData.lockAllMoves))
  const [draftPickTrading, setDraftPickTrading] = useState(Boolean(initialData.draftPickTrading))
  const [overrideInvite, setOverrideInvite] = useState(Boolean(initialData.overrideInviteCapacity))
  const [disableInvites, setDisableInvites] = useState(Boolean(initialData.disableInviteLinks))
  const [dispersalRounds, setDispersalRounds] = useState(initialData.dispersalDraftRounds ?? 0)
  const [keeperCount, setKeeperCount] = useState(initialData.keeperCount ?? 3)
  const [keeperCostSystem, setKeeperCostSystem] = useState(initialData.keeperCostSystem ?? 'round_based')
  const [keeperRoundPenalty, setKeeperRoundPenalty] = useState(initialData.keeperRoundPenalty ?? 1)
  const [keeperInflationRate, setKeeperInflationRate] = useState(initialData.keeperInflationRate ?? 1)
  const [keeperAuctionPct, setKeeperAuctionPct] = useState(
    () => (initialData.keeperAuctionPctIncrease != null ? initialData.keeperAuctionPctIncrease * 100 : 20),
  )
  const [keeperMaxYears, setKeeperMaxYears] = useState(initialData.keeperMaxYears ?? 3)
  const [keeperWaiverAllowed, setKeeperWaiverAllowed] = useState(initialData.keeperWaiverAllowed ?? true)
  const [keeperMinRoundsHeld, setKeeperMinRoundsHeld] = useState(initialData.keeperMinRoundsHeld ?? 0)
  const [keeperDeadlineLocal, setKeeperDeadlineLocal] = useState('')

  useEffect(() => {
    setName(initialData.name ?? '')
    setSport((initialData.sport ?? 'NFL') as LeagueSport)
    setSeason(initialData.season ?? new Date().getFullYear())
    setLanguage(initialData.language ?? 'en')
    setLeagueDescription(typeof settingsSnapshot.leagueDescription === 'string' ? settingsSnapshot.leagueDescription : '')
    setListingVisibility(
      typeof settingsSnapshot.leagueListingVisibility === 'string' ? settingsSnapshot.leagueListingVisibility : 'private',
    )
    setTimezone(initialData.timezone ?? 'America/New_York')
    setMedianGame(Boolean(initialData.medianGame))
    setLeagueType(initialData.leagueType ?? 'redraft')
    setLeagueSize(initialData.leagueSize ?? 12)
    setAllowPreDraft(Boolean(initialData.allowPreDraftMoves))
    setPreventBenchDrops(Boolean(initialData.preventBenchDrops))
    setLockMoves(Boolean(initialData.lockAllMoves))
    setDraftPickTrading(Boolean(initialData.draftPickTrading))
    setOverrideInvite(Boolean(initialData.overrideInviteCapacity))
    setDisableInvites(Boolean(initialData.disableInviteLinks))
    setDispersalRounds(initialData.dispersalDraftRounds ?? 0)
    setKeeperCount(initialData.keeperCount ?? 3)
    setKeeperCostSystem(initialData.keeperCostSystem ?? 'round_based')
    setKeeperRoundPenalty(initialData.keeperRoundPenalty ?? 1)
    setKeeperInflationRate(initialData.keeperInflationRate ?? 1)
    setKeeperAuctionPct(initialData.keeperAuctionPctIncrease != null ? initialData.keeperAuctionPctIncrease * 100 : 20)
    setKeeperMaxYears(initialData.keeperMaxYears ?? 3)
    setKeeperWaiverAllowed(initialData.keeperWaiverAllowed ?? true)
    setKeeperMinRoundsHeld(initialData.keeperMinRoundsHeld ?? 0)
    if (initialData.keeperSelectionDeadline) {
      const d = new Date(initialData.keeperSelectionDeadline)
      setKeeperDeadlineLocal(d.toISOString().slice(0, 16))
    }
  }, [initialData, settingsSnapshot])

  const disabled = !canEdit
  const { hasCommissioner } = useEntitlements()
  const hasCommissionerAccess = hasCommissioner || hasAfCommissionerSub
  /** Show upgrade hints when user lacks commissioner access (resolver + profile). */
  const subHint = !hasCommissionerAccess
  const showKeeper = leagueType === 'keeper'
  const subscriptionGate = useSubscriptionGateOptional()

  return (
    <div className="space-y-8 px-6 py-6 text-[13px] text-white/85" data-league-id={leagueId}>
      <SettingsPanelHeading
        title="General league settings"
        subtitle="Set league identity, format, and core rules. Playoff and waiver detail live in their own tabs."
      />

      <div>
        <SettingsSectionLabel>League description</SettingsSectionLabel>
        <textarea
          className={`${controlClass} min-h-[96px] max-w-lg rounded-2xl py-3`}
          disabled={disabled}
          value={leagueDescription}
          placeholder="Shown on league cards and discovery where your league opts in."
          onChange={(e) => {
            const v = e.target.value
            setLeagueDescription(v)
            debouncedSave({ settingsMerge: { leagueDescription: v } })
          }}
        />
      </div>

      <div className="grid max-w-lg gap-4 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <SettingsSectionLabel>Sport</SettingsSectionLabel>
          <select
            className={controlClass}
            disabled={disabled}
            value={sport}
            onChange={(e) => {
              const v = e.target.value as LeagueSport
              setSport(v)
              debouncedSave({ sport: v })
            }}
          >
            {SUPPORTED_SPORTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-1">
          <SettingsSectionLabel>Season year</SettingsSectionLabel>
          <input
            type="number"
            min={2000}
            max={2100}
            className={controlClass}
            disabled={disabled}
            value={season}
            onChange={(e) => {
              const n = Number(e.target.value)
              setSeason(n)
              debouncedSave({ season: n })
            }}
          />
        </div>
        <div className="sm:col-span-1">
          <SettingsSectionLabel>Default language</SettingsSectionLabel>
          <select
            className={controlClass}
            disabled={disabled}
            value={language}
            onChange={(e) => {
              const v = e.target.value
              setLanguage(v)
              debouncedSave({ language: v })
            }}
          >
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </div>
      </div>

      <div>
        <SettingsSectionLabel>Listing &amp; discoverability</SettingsSectionLabel>
        <select
          className={controlClass}
          disabled={disabled}
          value={listingVisibility}
          onChange={(e) => {
            const v = e.target.value
            setListingVisibility(v)
            debouncedSave({ settingsMerge: { leagueListingVisibility: v } })
          }}
        >
          <option value="private">Private — invite only</option>
          <option value="unlisted">Unlisted — link only</option>
          <option value="public">Public — discoverable in browse</option>
        </select>
        <SettingsHelper>Controls how this league can appear in Find League and shared links (enforced server-side where applicable).</SettingsHelper>
      </div>

      <div>
        <SettingsSectionLabel>League name</SettingsSectionLabel>
        <input
          id="ls-name"
          className={controlClass}
          value={name}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value
            setName(v)
            debouncedSave({ name: v })
          }}
        />
      </div>

      <div>
        <SettingsSectionLabel>League type</SettingsSectionLabel>
        <SettingsRadioGroup
          name="league-type"
          value={leagueType}
          disabled={disabled}
          onChange={(v) => {
            setLeagueType(v)
            debouncedSave({ leagueType: v })
          }}
          options={[
            {
              id: 'redraft',
              title: 'Redraft',
              description: 'Full redraft each season; all players available.',
            },
            {
              id: 'keeper',
              title: 'Keeper',
              description: 'Teams retain a configured number of players year to year.',
            },
            {
              id: 'dynasty',
              title: 'Dynasty',
              description: 'Rosters carry over; rookie and free-agent drafts replenish talent.',
            },
          ]}
        />
      </div>

      <div>
        <SettingsSectionLabel>Number of teams</SettingsSectionLabel>
        <select
          className={controlClass}
          disabled={disabled}
          value={leagueSize}
          onChange={(e) => {
            const n = Number(e.target.value)
            setLeagueSize(n)
            debouncedSave({ leagueSize: n })
          }}
        >
          {Array.from({ length: 15 }, (_, i) => i + 4).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <SettingsSectionLabel>Core rules</SettingsSectionLabel>
        <SettingsToggleRow
          label="Extra game vs league median"
          checked={medianGame}
          disabled={disabled}
          onChange={(v) => {
            setMedianGame(v)
            void save({ medianGame: v })
          }}
        />
        <SettingsToggleRow
          label="Allow moves pre-draft"
          checked={allowPreDraft}
          disabled={disabled}
          onChange={(v) => {
            setAllowPreDraft(v)
            debouncedSave({ allowPreDraftMoves: v })
          }}
        />
        <SettingsToggleRow
          label="Prevent bench players from being dropped after game starts"
          checked={preventBenchDrops}
          disabled={disabled}
          onChange={(v) => {
            setPreventBenchDrops(v)
            debouncedSave({ preventBenchDrops: v })
          }}
        />
        <SettingsToggleRow
          label="Lock all free agent and waiver moves"
          checked={lockMoves}
          disabled={disabled}
          dimmed={false}
          onChange={(v) => {
            setLockMoves(v)
            void save({ lockAllMoves: v })
          }}
        />
        <SettingsToggleRow
          label="Allow draft pick trading"
          checked={draftPickTrading}
          disabled={disabled}
          onChange={(v) => {
            setDraftPickTrading(v)
            void save({ draftPickTrading: v })
          }}
        />
        <SettingsToggleRow
          label="Override league invite capacity"
          checked={overrideInvite}
          disabled={disabled}
          onChange={(v) => {
            setOverrideInvite(v)
            debouncedSave({ overrideInviteCapacity: v })
          }}
        />
        <SettingsToggleRow
          label="Disable league invite links"
          checked={disableInvites}
          disabled={disabled}
          onChange={(v) => {
            setDisableInvites(v)
            debouncedSave({ disableInviteLinks: v })
          }}
        />
      </div>

      <div>
        <SettingsSectionLabel>Supplemental / dispersal rounds</SettingsSectionLabel>
        <select
          className={controlClass}
          disabled={disabled}
          value={dispersalRounds}
          onChange={(e) => {
            const n = Number(e.target.value)
            setDispersalRounds(n)
            debouncedSave({ dispersalDraftRounds: n })
          }}
        >
          {Array.from({ length: 11 }, (_, i) => i).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <SettingsHelper>Used for supplemental or dispersal draft configuration where your league format supports it.</SettingsHelper>
      </div>

      <div>
        <SettingsSectionLabel>Timezone</SettingsSectionLabel>
        <select
          id="ls-tz"
          className={controlClass}
          disabled={disabled}
          value={timezone}
          onChange={(e) => {
            const v = e.target.value
            setTimezone(v)
            debouncedSave({ timezone: v })
          }}
        >
          {COMMON_TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </select>
      </div>

      {showKeeper ? (
        <div className="space-y-4 border-t border-white/[0.08] pt-6">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-sky-300/90">Keeper rules</p>

          <div>
            <label className="mb-1 block text-[11px] text-white/45" htmlFor="kp-count">
              Keepers per team
            </label>
            <select
              id="kp-count"
              className="rounded-lg border border-white/[0.12] bg-[#0a1220] px-3 py-2 text-white disabled:opacity-50"
              disabled={disabled}
              value={Math.min(20, Math.max(0, keeperCount))}
              onChange={(e) => {
                const n = Number(e.target.value)
                setKeeperCount(n)
                debouncedSave({ keeperCount: n })
              }}
            >
              {Array.from({ length: 21 }, (_, i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-white/40">
              How many players each team can keep per season. 0 = no keepers.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-white/45">Keeper cost system</label>
            <select
              className="w-full max-w-md rounded-lg border border-white/[0.12] bg-[#0a1220] px-3 py-2 text-white disabled:opacity-50"
              disabled={disabled}
              value={keeperCostSystem}
              onChange={(e) => {
                const v = e.target.value
                setKeeperCostSystem(v)
                debouncedSave({ keeperCostSystem: v })
              }}
            >
              <option value="round_based">Round-based (draft round penalty)</option>
              <option value="inflation">Inflation (penalty grows yearly)</option>
              <option value="auction_value">Auction value carryover</option>
              <option value="free">Free (no pick cost)</option>
            </select>
          </div>

          {(keeperCostSystem === 'round_based' || keeperCostSystem === 'inflation') && (
            <div>
              <label className="mb-1 block text-[11px] text-white/45">Round penalty (rounds earlier)</label>
              <select
                className="rounded-lg border border-white/[0.12] bg-[#0a1220] px-3 py-2 text-white disabled:opacity-50"
                disabled={disabled}
                value={keeperRoundPenalty}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  setKeeperRoundPenalty(n)
                  debouncedSave({ keeperRoundPenalty: n })
                }}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          )}

          {keeperCostSystem === 'inflation' && (
            <div>
              <label className="mb-1 block text-[11px] text-white/45">Inflation rate (rounds / year)</label>
              <select
                className="rounded-lg border border-white/[0.12] bg-[#0a1220] px-3 py-2 text-white disabled:opacity-50"
                disabled={disabled}
                value={keeperInflationRate}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  setKeeperInflationRate(n)
                  debouncedSave({ keeperInflationRate: n })
                }}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          )}

          {keeperCostSystem === 'auction_value' && (
            <div>
              <label className="mb-1 block text-[11px] text-white/45">Auction inflation %</label>
              <input
                type="number"
                min={0}
                max={100}
                className="w-32 rounded-lg border border-white/[0.12] bg-[#0a1220] px-3 py-2 text-white disabled:opacity-50"
                disabled={disabled}
                value={Math.round(keeperAuctionPct)}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  setKeeperAuctionPct(n)
                  debouncedSave({ keeperAuctionPctIncrease: n / 100 })
                }}
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-[11px] text-white/45">Max years per keeper</label>
            <select
              className="rounded-lg border border-white/[0.12] bg-[#0a1220] px-3 py-2 text-white disabled:opacity-50"
              disabled={disabled}
              value={keeperMaxYears}
              onChange={(e) => {
                const n = Number(e.target.value)
                setKeeperMaxYears(n)
                debouncedSave({ keeperMaxYears: n })
              }}
            >
              <option value={0}>Unlimited</option>
              <option value={1}>1 year</option>
              <option value={2}>2 years</option>
              <option value={3}>3 years</option>
              <option value={5}>5 years</option>
            </select>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-white/80">
            <input
              type="checkbox"
              className="rounded border-white/20 bg-[#0a1220]"
              checked={keeperWaiverAllowed}
              disabled={disabled}
              onChange={(e) => {
                const v = e.target.checked
                setKeeperWaiverAllowed(v)
                void save({ keeperWaiverAllowed: v })
              }}
            />
            Allow waiver pickups as keepers
          </label>

          <div>
            <label className="mb-1 block text-[11px] text-white/45">Keeper selection deadline (local)</label>
            <input
              type="datetime-local"
              className="max-w-xs rounded-lg border border-white/[0.12] bg-[#0a1220] px-3 py-2 text-white disabled:opacity-50"
              disabled={disabled}
              value={keeperDeadlineLocal}
              onChange={(e) => {
                const v = e.target.value
                setKeeperDeadlineLocal(v)
                if (!v) {
                  void save({ keeperSelectionDeadline: null })
                  return
                }
                void save({ keeperSelectionDeadline: new Date(v).toISOString() })
              }}
            />
            <p className="mt-1 text-[11px] text-white/40">Stored in UTC; pick time in your local browser.</p>
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-white/45">Minimum rounds held</label>
            <select
              className="rounded-lg border border-white/[0.12] bg-[#0a1220] px-3 py-2 text-white disabled:opacity-50"
              disabled={disabled}
              value={keeperMinRoundsHeld}
              onChange={(e) => {
                const n = Number(e.target.value)
                setKeeperMinRoundsHeld(n)
                debouncedSave({ keeperMinRoundsHeld: n })
              }}
            >
              {Array.from({ length: 11 }, (_, i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </div>

          {subHint ? (
            <PremiumGate
              featureId="commissioner_ai_tools"
              hasAccess={hasCommissionerAccess}
              mode="overlay"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] text-amber-400/90">
                  AF Commissioner unlocks keeper Decision OS recommendations (server-gated).
                </p>
                <SubscriptionGateBadge
                  featureId="commissioner_ai_tools"
                  onClick={() => subscriptionGate?.gate('commissioner_ai_tools', { highlightParam: 'ai_tools' })}
                />
              </div>
            </PremiumGate>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
