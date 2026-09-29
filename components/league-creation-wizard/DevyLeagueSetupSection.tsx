'use client'

import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import type { LeagueSport } from '@prisma/client'
import {
  type DevyLeagueSetupState,
  type DevyAnnualDraftOrderStyleId,
  type DevyPromotionModelId,
  type DevyRookieDevyDraftStructureId,
  type DevyDraftPacingId,
  defaultDevyLeagueSetup,
} from '@/lib/devy/devy-league-config'

const SHOW_C2C_MODE = process.env.NEXT_PUBLIC_DEVY_C2C === '1'
const SHOW_EXPANDED_PIPELINE = process.env.NEXT_PUBLIC_DEVY_EXPANDED_PIPELINE === '1'

function FieldHelp({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-[11px] leading-relaxed text-white/50">{children}</p>
}

export type DevyLeagueSetupSectionProps = {
  sport: LeagueSport | string
  value: DevyLeagueSetupState
  onChange: (next: DevyLeagueSetupState) => void
}

export function DevyLeagueSetupSection({ sport, value, onChange }: DevyLeagueSetupSectionProps) {
  const patch = (partial: Partial<DevyLeagueSetupState>) => onChange({ ...value, ...partial })

  const feederLabel =
    value.feederSource === 'ncaab_for_nba'
      ? 'NCAA Basketball / prospect pool'
      : 'NCAA Football / prospect pool'

  const sportLine =
    String(sport).toUpperCase() === 'NBA' || String(sport).toUpperCase() === 'NCAAB'
      ? 'NBA-style devy uses the college/prospect pipeline (NCAAB-aligned).'
      : 'NFL-style devy uses the college/prospect pipeline (NCAAF-aligned).'

  return (
    <section
      className="mt-6 space-y-5 rounded-[22px] border border-cyan-400/20 bg-gradient-to-b from-[#0a1628]/95 to-[#050915]/90 p-4 shadow-[0_0_40px_rgba(0,200,255,0.06)] backdrop-blur-md"
      data-testid="devy-league-setup-section"
    >
      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            background:
              'radial-gradient(800px 200px at 10% 0%, rgba(56,189,248,0.5), transparent 60%), radial-gradient(600px 180px at 90% 20%, rgba(167,139,250,0.35), transparent 55%)',
          }}
        />
        <p className="relative text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-200/90">Devy league setup</p>
        <h3 className="relative mt-1 text-base font-bold text-white">Long-term development format</h3>
        <p className="relative mt-1 text-[12px] leading-relaxed text-white/65">
          Devy slots and taxi slots are <span className="text-cyan-100/95">included by default</span> — this is a true
          multi-year dynasty development league, not a simple toggle. You can fine-tune counts and rules in League
          Settings after creation.
        </p>
        <p className="relative mt-2 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-2 text-[11px] text-cyan-50/95">
          Default Devy settings are tailored to the selected sport&apos;s prospect pipeline and development cycle.{' '}
          {sportLine}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label className="text-cyan-200/90">Devy mode</Label>
          <select
            className="mt-1.5 w-full rounded-xl border border-white/12 bg-black/40 px-3 py-2.5 text-[13px] text-white outline-none focus:border-cyan-400/40"
            value={value.devyMode}
            onChange={(e) => {
              const mode = e.target.value as DevyLeagueSetupState['devyMode']
              if (mode === 'campus_to_canton' && !SHOW_C2C_MODE) return
              if (mode === 'expanded_pipeline' && !SHOW_EXPANDED_PIPELINE) return
              patch({ devyMode: mode })
            }}
          >
            <option value="standard_devy">Standard Devy</option>
            {SHOW_C2C_MODE ? <option value="campus_to_canton">Campus to Canton</option> : null}
            {SHOW_EXPANDED_PIPELINE ? <option value="expanded_pipeline">Expanded Devy Pipeline</option> : null}
            <option value="future_placeholder" disabled>
              More modes (coming soon)
            </option>
          </select>
          <FieldHelp>Standard Devy is the flagship long-term college asset format for this sport.</FieldHelp>
        </div>

        <div>
          <Label className="text-cyan-200/90">Associated feeder / prospect source</Label>
          <div className="mt-1.5 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-[13px] text-white/85">
            {feederLabel}
          </div>
          <FieldHelp>Sport-aware: NFL devy pulls from NCAA football; NBA devy from NCAA basketball / prospect pool.</FieldHelp>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label className="text-cyan-200/90">Devy rounds per season</Label>
          <input
            type="number"
            min={1}
            max={24}
            className="mt-1.5 w-full rounded-xl border border-white/12 bg-black/40 px-3 py-2.5 text-[13px] text-white outline-none focus:border-cyan-400/40"
            value={value.devyRoundsPerSeason}
            onChange={(e) => patch({ devyRoundsPerSeason: Math.max(1, Math.min(24, Number(e.target.value) || 1)) })}
          />
          <FieldHelp>Controls how many devy picks are scheduled each league year in the annual devy draft.</FieldHelp>
        </div>
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.07] px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-200/90">Included by default</p>
          <p className="mt-1 text-[12px] text-white/80">
            <span className="text-emerald-100/95">Devy roster slots</span> and{' '}
            <span className="text-emerald-100/95">taxi stash slots</span> ship with this format. Adjust counts later in
            League Settings — the format always expects both pipelines.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label className="text-cyan-200/90">Devy slots (starting count)</Label>
          <input
            type="number"
            min={1}
            max={32}
            className="mt-1.5 w-full rounded-xl border border-white/12 bg-black/40 px-3 py-2.5 text-[13px] text-white"
            value={value.rosterSlots.devy}
            onChange={(e) =>
              patch({
                rosterSlots: {
                  ...value.rosterSlots,
                  devy: Math.max(1, Math.min(32, Number(e.target.value) || 1)),
                },
              })
            }
          />
        </div>
        <div>
          <Label className="text-cyan-200/90">Taxi slots (starting count)</Label>
          <input
            type="number"
            min={0}
            max={20}
            className="mt-1.5 w-full rounded-xl border border-white/12 bg-black/40 px-3 py-2.5 text-[13px] text-white"
            value={value.rosterSlots.taxi}
            onChange={(e) =>
              patch({
                rosterSlots: {
                  ...value.rosterSlots,
                  taxi: Math.max(0, Math.min(20, Number(e.target.value) || 0)),
                },
              })
            }
          />
          <FieldHelp>Taxi stashes young pros; Devy holds pre-pro prospects — kept separate.</FieldHelp>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/25 px-3 py-3">
        <div>
          <p className="text-[12px] font-semibold text-white">Future picks trading</p>
          <p className="text-[11px] text-white/55">Enable trading of future rookie and devy pick assets.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={value.futurePickTradingEnabled}
          onClick={() => patch({ futurePickTradingEnabled: !value.futurePickTradingEnabled })}
          className={`relative h-8 w-14 rounded-full border transition ${
            value.futurePickTradingEnabled
              ? 'border-cyan-400/50 bg-cyan-500/25'
              : 'border-white/15 bg-white/[0.06]'
          }`}
        >
          <span
            className={`absolute top-0.5 h-7 w-7 rounded-full bg-white shadow transition ${
              value.futurePickTradingEnabled ? 'left-6' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      <div>
        <Label className="text-cyan-200/90">Promotion model</Label>
        <select
          className="mt-1.5 w-full rounded-xl border border-white/12 bg-black/40 px-3 py-2.5 text-[13px] text-white"
          value={value.promotionModel}
          onChange={(e) => patch({ promotionModel: e.target.value as DevyPromotionModelId })}
        >
          <option value="manual_commissioner">Manual commissioner approval</option>
          <option value="auto_pro_eligible">Auto-promote when player becomes pro eligible</option>
          <option value="commissioner_rules_gated">Commissioner + rules gated</option>
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label className="text-cyan-200/90">Rookie / Devy draft structure</Label>
          <select
            className="mt-1.5 w-full rounded-xl border border-white/12 bg-black/40 px-3 py-2.5 text-[13px] text-white"
            value={value.rookieDevyDraftStructure}
            onChange={(e) => patch({ rookieDevyDraftStructure: e.target.value as DevyRookieDevyDraftStructureId })}
          >
            <option value="separate_rookie">Separate rookie draft</option>
            <option value="separate_devy">Separate devy draft</option>
            <option value="combined">Combined rookie + devy draft</option>
          </select>
        </div>
        <div>
          <Label className="text-cyan-200/90">Annual rookie/devy order style</Label>
          <select
            className="mt-1.5 w-full rounded-xl border border-white/12 bg-black/40 px-3 py-2.5 text-[13px] text-white"
            value={value.annualRookieDevyOrderStyle}
            onChange={(e) => patch({ annualRookieDevyOrderStyle: e.target.value as DevyAnnualDraftOrderStyleId })}
          >
            <option value="linear">Linear</option>
            <option value="snake">Snake</option>
            <option value="auction">Auction</option>
            <option value="weighted_lottery">Weighted lottery draft</option>
          </select>
          <FieldHelp>
            Weighted lottery is allowed for annual rookie/devy drafts — startup drafts never use lottery here.
          </FieldHelp>
        </div>
      </div>

      <div>
        <Label className="text-cyan-200/90">Prospect eligibility rules</Label>
        <select
          className="mt-1.5 w-full rounded-xl border border-white/12 bg-black/40 px-3 py-2.5 text-[13px] text-white"
          value={value.prospectEligibility.model}
          onChange={(e) =>
            patch({
              prospectEligibility: { ...value.prospectEligibility, model: e.target.value as DevyLeagueSetupState['prospectEligibility']['model'] },
            })
          }
        >
          <option value="class_year">Class year based</option>
          <option value="age_declaration">Age / declaration based</option>
          <option value="manual_curated_pool">Manually curated pool</option>
          <option value="hybrid">Hybrid</option>
        </select>
        <div className="mt-2 flex flex-wrap gap-2">
          {(
            [
              ['includeFreshmen', 'Fr'],
              ['includeSophomores', 'So'],
              ['includeJuniors', 'Jr'],
              ['includeSeniors', 'Sr'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1.5 text-[11px] text-white/75">
              <input
                type="checkbox"
                checked={value.prospectEligibility[key]}
                onChange={(e) =>
                  patch({
                    prospectEligibility: { ...value.prospectEligibility, [key]: e.target.checked },
                  })
                }
                className="rounded border-white/20 bg-black/40"
              />
              {label}
            </label>
          ))}
          <label className="flex items-center gap-1.5 text-[11px] text-white/75">
            <input
              type="checkbox"
              checked={value.prospectEligibility.declaredOnly}
              onChange={(e) =>
                patch({
                  prospectEligibility: { ...value.prospectEligibility, declaredOnly: e.target.checked },
                })
              }
              className="rounded border-white/20 bg-black/40"
            />
            Declared only
          </label>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label className="text-cyan-200/90">Draft pacing</Label>
          <select
            className="mt-1.5 w-full rounded-xl border border-white/12 bg-black/40 px-3 py-2.5 text-[13px] text-white"
            value={value.draftPacing}
            onChange={(e) => patch({ draftPacing: e.target.value as DevyDraftPacingId })}
          >
            <option value="live_timer">Live draft (timer-driven)</option>
            <option value="relaxed_timer">Relaxed timer (slower clock)</option>
            <option value="commissioner_paused">Commissioner pause-friendly</option>
          </select>
          <FieldHelp>Timer sets live vs relaxed pacing — there is no separate &quot;slow draft&quot; type.</FieldHelp>
        </div>
        <div>
          <Label className="text-cyan-200/90">Pick timer (seconds)</Label>
          <input
            type="number"
            min={30}
            max={86400}
            step={30}
            className="mt-1.5 w-full rounded-xl border border-white/12 bg-black/40 px-3 py-2.5 text-[13px] text-white"
            value={value.draftTimerSeconds}
            onChange={(e) => patch({ draftTimerSeconds: Math.max(30, Number(e.target.value) || 90) })}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-4 rounded-xl border border-white/10 bg-black/20 px-3 py-3">
        <label className="flex items-center gap-2 text-[12px] text-white/80">
          <input
            type="checkbox"
            checked={value.poolControls.lockAtSeasonStart}
            onChange={(e) =>
              patch({ poolControls: { ...value.poolControls, lockAtSeasonStart: e.target.checked } })
            }
            className="rounded border-white/20 bg-black/40"
          />
          Lock player pool at season start
        </label>
        <label className="flex items-center gap-2 text-[12px] text-white/80">
          <input
            type="checkbox"
            checked={value.poolControls.dynamicUpdates}
            onChange={(e) => patch({ poolControls: { ...value.poolControls, dynamicUpdates: e.target.checked } })}
            className="rounded border-white/20 bg-black/40"
          />
          Dynamic pool updates
        </label>
        <label className="flex items-center gap-2 text-[12px] text-white/80">
          <input
            type="checkbox"
            checked={value.poolControls.manualCommissionerEdits}
            onChange={(e) =>
              patch({ poolControls: { ...value.poolControls, manualCommissionerEdits: e.target.checked } })
            }
            className="rounded border-white/20 bg-black/40"
          />
          Manual commissioner add/remove
        </label>
      </div>

      <div className="rounded-xl border border-violet-400/25 bg-violet-500/[0.06] px-3 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-200/90">@chimmy for Devy</p>
        <div className="mt-2 flex flex-wrap gap-3">
          {(
            [
              ['devyPlaybookEnabled', 'Devy playbook'],
              ['surfaceFuturePicks', 'Future picks context'],
              ['surfacePromotionHints', 'Promotion hints'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-[11px] text-white/80">
              <input
                type="checkbox"
                checked={value.chimmy[k]}
                onChange={(e) => patch({ chimmy: { ...value.chimmy, [k]: e.target.checked } })}
                className="rounded border-white/20 bg-black/40"
              />
              {label}
            </label>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-white/45">
          Chimmy can read devy rules, rosters, taxi/devy buckets, and pick assets for this league once saved.
        </p>
      </div>

      <button
        type="button"
        className="text-[11px] text-cyan-300/80 underline-offset-2 hover:text-cyan-200 hover:underline"
        onClick={() => onChange(defaultDevyLeagueSetup(sport))}
      >
        Reset Devy defaults for this sport
      </button>
    </section>
  )
}
