'use client'

import type { AccentTone } from '@/lib/create-league-v2/theme'
import type { CreateLeagueV2State, DynastySetupState } from '@/lib/create-league-v2/state'
import { GlassCard, SectionHeader, Toggle } from '@/components/create-league-v2/primitives'
import { sportSupportsProspectStash } from '@/lib/league-creation/prospectStashPolicy'

type Props = {
  state: CreateLeagueV2State
  accent: AccentTone
  onChange: (patch: Partial<CreateLeagueV2State>) => void
}

function numberValue(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function DynastyAdvancedSettings({ state, accent, onChange }: Props) {
  const d = state.dynasty

  const updateDynasty = (patch: Partial<DynastySetupState>) => {
    onChange({ dynasty: { ...d, ...patch } })
  }

  const isOffline = d.draftMode === 'offline'
  // NHL / MLB: no prospect pool, so no taxi squad (lib/league-creation/prospectStashPolicy.ts).
  const taxiAvailable = sportSupportsProspectStash(state.sport)

  return (
    <GlassCard>
      <SectionHeader
        title="Dynasty Setup"
        hint={taxiAvailable
          ? 'Startup + rookie drafts, taxi, schedule/playoffs, AI gating, and media are persisted to the league snapshot.'
          : 'Startup + rookie drafts, schedule/playoffs, AI gating, and media are persisted to the league snapshot.'}
      />
      {!taxiAvailable ? (
        <p className="mb-3 text-[11px] text-white/50">
          Taxi squads are not offered for {state.sport} leagues: we do not have a minor-league or prospect player pool for this sport.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-white/70">
          <span>Startup draft type</span>
          <select
            value={d.startupDraftType}
            onChange={(e) => updateDynasty({ startupDraftType: e.target.value as DynastySetupState['startupDraftType'] })}
            className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
          >
            <option value="snake">Snake</option>
            <option value="linear">Linear</option>
            <option value="auction">Auction</option>
            <option value="offline">Offline</option>
            <option value="auto">Auto</option>
          </select>
        </label>

        <label className="space-y-1 text-xs text-white/70">
          <span>Draft mode</span>
          <select
            value={d.draftMode}
            onChange={(e) => updateDynasty({ draftMode: e.target.value as DynastySetupState['draftMode'] })}
            className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
          >
            <option value="scheduled">Scheduled</option>
            <option value="offline">Offline</option>
          </select>
        </label>

        <label className="space-y-1 text-xs text-white/70 sm:col-span-2">
          <span>Draft date/time (UTC ISO)</span>
          <input
            type="datetime-local"
            disabled={isOffline}
            value={d.draftDateUtc}
            onChange={(e) => updateDynasty({ draftDateUtc: e.target.value })}
            className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white disabled:opacity-50"
          />
        </label>

        <label className="space-y-1 text-xs text-white/70">
          <span>Roster template key</span>
          <input
            value={d.rosterTemplateId}
            onChange={(e) => updateDynasty({ rosterTemplateId: e.target.value })}
            className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
          />
        </label>

        <label className="space-y-1 text-xs text-white/70">
          <span>Scoring template key</span>
          <input
            value={d.scoringTemplateId}
            onChange={(e) => updateDynasty({ scoringTemplateId: e.target.value })}
            className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
          />
        </label>

        <label className="space-y-1 text-xs text-white/70">
          <span>Divisions (0 = off)</span>
          <input
            type="number"
            min={0}
            max={8}
            value={d.divisionCount}
            onChange={(e) => updateDynasty({ divisionCount: numberValue(e.target.value, 0) })}
            className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
          />
        </label>

        <label className="space-y-1 text-xs text-white/70">
          <span>Regular season length</span>
          <input
            type="number"
            min={6}
            max={40}
            value={d.regularSeasonLength}
            onChange={(e) => updateDynasty({ regularSeasonLength: numberValue(e.target.value, d.regularSeasonLength) })}
            className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
          />
        </label>

        <label className="space-y-1 text-xs text-white/70">
          <span>Playoff teams</span>
          <input
            type="number"
            min={2}
            max={state.teamCount}
            value={d.playoffTeamCount}
            onChange={(e) => updateDynasty({ playoffTeamCount: numberValue(e.target.value, d.playoffTeamCount) })}
            className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
          />
        </label>

        <label className="space-y-1 text-xs text-white/70">
          <span>Playoff byes</span>
          <input
            type="number"
            min={0}
            max={state.teamCount}
            value={d.playoffByeCount}
            onChange={(e) => updateDynasty({ playoffByeCount: numberValue(e.target.value, d.playoffByeCount) })}
            className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
          />
        </label>

        <label className="space-y-1 text-xs text-white/70">
          <span>Startup roster depth</span>
          <input
            type="number"
            min={10}
            max={80}
            value={d.startupRosterDepth}
            onChange={(e) => updateDynasty({ startupRosterDepth: numberValue(e.target.value, d.startupRosterDepth) })}
            className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
          />
        </label>

        <label className="space-y-1 text-xs text-white/70">
          <span>Bench count</span>
          <input
            type="number"
            min={0}
            max={50}
            value={d.benchCount}
            onChange={(e) => updateDynasty({ benchCount: numberValue(e.target.value, d.benchCount) })}
            className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
          />
        </label>

        <label className="space-y-1 text-xs text-white/70">
          <span>IR count</span>
          <input
            type="number"
            min={0}
            max={10}
            value={d.irCount}
            onChange={(e) => updateDynasty({ irCount: numberValue(e.target.value, d.irCount) })}
            className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
          />
        </label>

        {taxiAvailable ? (
          <>
            <label className="space-y-1 text-xs text-white/70">
              <span>Taxi slots</span>
              <input
                type="number"
                min={0}
                max={20}
                value={d.taxiSlotCount}
                onChange={(e) => updateDynasty({ taxiSlotCount: numberValue(e.target.value, d.taxiSlotCount) })}
                className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
              />
            </label>

            <label className="space-y-1 text-xs text-white/70">
              <span>Taxi eligibility years</span>
              <input
                type="number"
                min={1}
                max={6}
                value={d.taxiEligibilityYears}
                onChange={(e) => updateDynasty({ taxiEligibilityYears: numberValue(e.target.value, d.taxiEligibilityYears) })}
                className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
              />
            </label>

            <label className="space-y-1 text-xs text-white/70">
              <span>Taxi lock deadline (period/week)</span>
              <input
                type="number"
                min={1}
                max={40}
                value={d.taxiLockDeadlineWeek}
                onChange={(e) => updateDynasty({ taxiLockDeadlineWeek: numberValue(e.target.value, d.taxiLockDeadlineWeek) })}
                className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
              />
            </label>
          </>
        ) : null}

        <label className="space-y-1 text-xs text-white/70">
          <span>Rookie draft rounds</span>
          <input
            type="number"
            min={1}
            max={12}
            value={d.rookieDraftRounds}
            onChange={(e) => updateDynasty({ rookieDraftRounds: numberValue(e.target.value, d.rookieDraftRounds) })}
            className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
          />
        </label>

        <label className="space-y-1 text-xs text-white/70">
          <span>Rookie draft type</span>
          <select
            value={d.rookieDraftType}
            onChange={(e) => updateDynasty({ rookieDraftType: e.target.value as DynastySetupState['rookieDraftType'] })}
            className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
          >
            <option value="linear">Linear</option>
            <option value="snake">Snake</option>
          </select>
        </label>

        <label className="space-y-1 text-xs text-white/70">
          <span>Rookie order method</span>
          <select
            value={d.rookieDraftOrderMethod}
            onChange={(e) => updateDynasty({ rookieDraftOrderMethod: e.target.value as DynastySetupState['rookieDraftOrderMethod'] })}
            className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
          >
            <option value="max_pf">Max PF</option>
            <option value="reverse_standings">Reverse standings</option>
            <option value="lottery">Lottery</option>
            <option value="commissioner">Commissioner</option>
          </select>
        </label>

        <label className="space-y-1 text-xs text-white/70">
          <span>Future pick trading years</span>
          <input
            type="number"
            min={1}
            max={5}
            value={d.futurePickTradeYears}
            onChange={(e) => updateDynasty({ futurePickTradeYears: numberValue(e.target.value, d.futurePickTradeYears) })}
            className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
          />
        </label>

        <label className="space-y-1 text-xs text-white/70">
          <span>Waiver type</span>
          <select
            value={d.waiverType}
            onChange={(e) => updateDynasty({ waiverType: e.target.value as DynastySetupState['waiverType'] })}
            className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
          >
            <option value="faab">FAAB</option>
            <option value="rolling">Rolling</option>
            <option value="reverse_standings">Reverse standings</option>
          </select>
        </label>

        <label className="space-y-1 text-xs text-white/70">
          <span>FAAB budget</span>
          <input
            type="number"
            min={0}
            max={5000}
            value={d.faabBudget}
            onChange={(e) => updateDynasty({ faabBudget: numberValue(e.target.value, d.faabBudget) })}
            className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
          />
        </label>

        <label className="space-y-1 text-xs text-white/70">
          <span>League visibility</span>
          <select
            value={d.visibility}
            onChange={(e) => updateDynasty({ visibility: e.target.value as DynastySetupState['visibility'] })}
            className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
          >
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </label>

        <label className="space-y-1 text-xs text-white/70">
          <span>League type</span>
          <select
            value={d.monetization}
            onChange={(e) => updateDynasty({ monetization: e.target.value as DynastySetupState['monetization'] })}
            className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
          >
            <option value="free">Free</option>
            <option value="paid">Paid</option>
          </select>
        </label>

        <label className="space-y-1 text-xs text-white/70 sm:col-span-2">
          <span>Dynasty intro video URL</span>
          <input
            value={d.introVideoUrl}
            onChange={(e) => updateDynasty({ introVideoUrl: e.target.value })}
            className="w-full rounded-xl border border-white/[0.1] bg-black/35 px-3 py-2 text-sm text-white"
          />
        </label>
      </div>

      {taxiAvailable ? (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Toggle
            checked={d.taxiAllowNonRookies}
            onChange={(v) => updateDynasty({ taxiAllowNonRookies: v })}
            label="Allow non-rookies on taxi"
            description="When off, only rookie-eligible players can be added to taxi."
            accent={accent}
          />
          <Toggle
            checked={d.taxiAllowMoveOutAfterDeadline}
            onChange={(v) => updateDynasty({ taxiAllowMoveOutAfterDeadline: v })}
            label="Allow move out after deadline"
            description="Commissioner can permit promotions after taxi lock."
            accent={accent}
          />
        </div>
      ) : null}

      <div className="mt-5 rounded-2xl border border-white/[0.08] bg-black/25 p-4">
        <h4 className="text-xs font-bold uppercase tracking-[0.18em] text-white/60">AI entitlement toggles</h4>
        <p className="mt-1 text-[11px] text-white/45">Saved to commissioner + user AI settings at creation and enforced in league settings.</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Toggle checked={d.commissionerAi.scoringRecommendations} onChange={(v) => updateDynasty({ commissionerAi: { ...d.commissionerAi, scoringRecommendations: v } })} label="Scoring recommendations" accent={accent} />
          <Toggle checked={d.commissionerAi.rosterBalanceRecommendations} onChange={(v) => updateDynasty({ commissionerAi: { ...d.commissionerAi, rosterBalanceRecommendations: v } })} label="Roster balance recommendations" accent={accent} />
          <Toggle checked={d.commissionerAi.playoffFormatRecommendations} onChange={(v) => updateDynasty({ commissionerAi: { ...d.commissionerAi, playoffFormatRecommendations: v } })} label="Playoff format recommendations" accent={accent} />
          {taxiAvailable ? <Toggle checked={d.commissionerAi.taxiRuleRecommendations} onChange={(v) => updateDynasty({ commissionerAi: { ...d.commissionerAi, taxiRuleRecommendations: v } })} label="Taxi rule recommendations" accent={accent} /> : null}
          <Toggle checked={d.commissionerAi.draftSetupRecommendations} onChange={(v) => updateDynasty({ commissionerAi: { ...d.commissionerAi, draftSetupRecommendations: v } })} label="Draft setup recommendations" accent={accent} />
          <Toggle checked={d.commissionerAi.antiTankingAlerts} onChange={(v) => updateDynasty({ commissionerAi: { ...d.commissionerAi, antiTankingAlerts: v } })} label="Anti-tanking alerts" accent={accent} />
          <Toggle checked={d.userAi.dynastyOutlook} onChange={(v) => updateDynasty({ userAi: { ...d.userAi, dynastyOutlook: v } })} label="Dynasty outlook" accent={accent} />
          <Toggle checked={d.userAi.tradeAnalyzer} onChange={(v) => updateDynasty({ userAi: { ...d.userAi, tradeAnalyzer: v } })} label="Trade analyzer" accent={accent} />
          <Toggle checked={d.userAi.rosterTimelineAnalysis} onChange={(v) => updateDynasty({ userAi: { ...d.userAi, rosterTimelineAnalysis: v } })} label="Roster timeline analysis" accent={accent} />
          <Toggle checked={d.userAi.startupDraftHelper} onChange={(v) => updateDynasty({ userAi: { ...d.userAi, startupDraftHelper: v } })} label="Startup draft helper" accent={accent} />
        </div>
      </div>
    </GlassCard>
  )
}
