'use client'

import { useMemo } from 'react'
import type { AccentTone } from '@/lib/create-league-v2/theme'
import type { CreateLeagueFieldErrors } from '@/lib/create-league-v2/submit'
import type { CreateLeagueV2State, SupportedSport } from '@/lib/create-league-v2/state'
import {
  SUPPORTED_SPORTS,
  getEffectiveLeagueType,
  hydrateFootballScoringFields,
  isDynastyConcept,
  isFootballLike,
  getDefaultDynastySetup,
  getDefaultBestBallSetup,
} from '@/lib/create-league-v2/state'
import { getDraftTypeOptions, getScoringPresetOptionsForSelection, getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'
import { buildSuggestedLeagueName } from '@/lib/create-league-v2/suggested-league-name'
import { getQuickTemplatePatch, resolveScoringPresetAfterSportChange, type QuickTemplateId } from '@/lib/create-league-v2/quick-defaults'
import type { CanonicalLeagueDiscoveryVisibility } from '@/lib/league-creation/canonical/createLeagueVisibilityMonetization'
import { GlassCard, SectionHeader, Segmented } from '@/components/create-league-v2/primitives'

const TEMPLATE_CHIPS: { id: QuickTemplateId; label: string }[] = [
  { id: 'casual_redraft', label: 'Casual Redraft' },
  { id: 'competitive_redraft', label: 'Competitive Redraft' },
  { id: 'dynasty', label: 'Dynasty' },
  { id: 'best_ball', label: 'Best Ball' },
  { id: 'guillotine', label: 'Guillotine' },
]

function toLocalDatetimeValue(iso: string): string {
  if (!iso?.trim()) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalDatetimeValue(v: string): string {
  if (!v?.trim()) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

const fieldClass =
  'mt-1 w-full min-h-[48px] rounded-xl border border-white/[0.12] bg-[#0a1228]/90 px-3 py-2.5 text-sm text-white outline-none ring-0 transition focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-500/25'

const labelClass = 'text-[11px] font-bold uppercase tracking-[0.14em] text-white/50'

export function QuickCreatePanel({
  state,
  accent,
  onChange,
  onSwitchToAdvanced,
  firstName,
  fieldErrors,
  showTemplateChips = true,
}: {
  state: CreateLeagueV2State
  accent: AccentTone
  onChange: (patch: Partial<CreateLeagueV2State>) => void
  onSwitchToAdvanced: () => void
  firstName?: string
  fieldErrors?: CreateLeagueFieldErrors | null
  showTemplateChips?: boolean
}) {
  const fe = fieldErrors ?? undefined
  const lt = getEffectiveLeagueType(state)

  const teamOpts = useMemo(() => {
    if (!lt) return []
    return getTeamCountOptions(state.sport, lt, state.soccerPipeline, state.draftType, state.idpSelected)
  }, [lt, state.sport, state.soccerPipeline, state.draftType, state.idpSelected])

  const draftOpts = useMemo(() => (lt ? getDraftTypeOptions(lt, state.sport) : []), [lt, state.sport])

  const scoringOpts = useMemo(() => {
    if (!lt) return []
    return getScoringPresetOptionsForSelection({ leagueType: lt, sport: state.sport, idpSelected: state.idpSelected })
  }, [lt, state.sport, state.idpSelected])

  const draftLocal = useMemo(() => {
    if (lt === 'best_ball') return toLocalDatetimeValue(state.bestBall.draftDateUtc)
    if (lt && isDynastyConcept(lt)) return toLocalDatetimeValue(state.dynasty.draftDateUtc)
    return ''
  }, [lt, state.bestBall.draftDateUtc, state.dynasty.draftDateUtc])

  const selectedTemplate: QuickTemplateId | null = useMemo(() => {
    if (state.selectedTemplateId) return state.selectedTemplateId
    if (!lt) return null
    if (lt === 'dynasty') return 'dynasty'
    if (lt === 'best_ball') return 'best_ball'
    if (lt === 'guillotine') return 'guillotine'
    if (lt === 'redraft') {
      if (state.teamCount === 10) return 'casual_redraft'
      if (state.teamCount === 12) return 'competitive_redraft'
    }
    return null
  }, [state.selectedTemplateId, lt, state.teamCount])

  const supportsPaidToggle = Boolean(lt && (isDynastyConcept(lt) || lt === 'best_ball'))
  const supportsDraftSchedule = Boolean(lt && (isDynastyConcept(lt) || lt === 'best_ball'))

  const applyTemplate = (id: QuickTemplateId) => {
    const patch = getQuickTemplatePatch(id, state)
    const nextLt = patch.leagueType ?? state.leagueType
    const suggested =
      nextLt && !state.nameTouched
        ? buildSuggestedLeagueName({
            leagueType: nextLt,
            sport: patch.sport ?? state.sport,
            teamCount: patch.teamCount ?? state.teamCount,
            idpSelected: false,
            commissionerFirstName: firstName,
          })
        : undefined
    onChange({
      ...patch,
      ...(suggested ? { name: suggested } : {}),
    })
  }

  const onSportChange = (sport: SupportedSport) => {
    if (!lt) {
      onChange({ sport })
      return
    }
    const scoringPresetId = resolveScoringPresetAfterSportChange(state.scoringPresetId, lt, sport, false)
    const d0 = state.dynasty
    const b0 = state.bestBall
    const nextDyn = getDefaultDynastySetup(sport, state.draftType)
    const nextBb = getDefaultBestBallSetup(sport, b0.mode, state.draftType)
    onChange({
      sport,
      scoringPresetId,
      ...hydrateFootballScoringFields(sport, false, scoringPresetId),
      dynasty: {
        ...nextDyn,
        visibility: d0.visibility,
        monetization: d0.monetization,
        entryFeeDollars: d0.entryFeeDollars,
        payoutType: d0.payoutType,
        commissionerPayoutResponsible: d0.commissionerPayoutResponsible,
        externalEscrowUrl: d0.externalEscrowUrl,
        externalEscrowLabel: d0.externalEscrowLabel,
        draftMode: d0.draftMode,
        draftDateUtc: d0.draftDateUtc,
      },
      bestBall: {
        ...nextBb,
        visibility: b0.visibility,
        monetization: b0.monetization,
        entryFeeCents: b0.entryFeeCents,
        payoutType: b0.payoutType,
        commissionerPayoutResponsible: b0.commissionerPayoutResponsible,
        externalEscrowUrl: b0.externalEscrowUrl,
        externalEscrowLabel: b0.externalEscrowLabel,
        draftDateUtc: b0.draftDateUtc,
      },
    })
  }

  return (
    <GlassCard data-testid="quick-create-panel" className="!p-4 sm:!p-6">
      <SectionHeader
        title={showTemplateChips ? 'Quick Create' : 'League details'}
        hint={
          showTemplateChips
            ? 'One screen — same POST /api/leagues + defaults as Advanced. Fine-tune anytime after launch.'
            : 'Adjust name, sport, size, and visibility. Same canonical create as Quick and Advanced.'
        }
      />

      {showTemplateChips ? (
        <div className="mb-6">
          <p className={labelClass}>Template</p>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TEMPLATE_CHIPS.map((chip) => {
              const selected = selectedTemplate === chip.id
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => applyTemplate(chip.id)}
                  className={`shrink-0 touch-manipulation rounded-full border px-4 py-2.5 text-xs font-semibold transition ${
                    selected
                      ? `border-cyan-400/50 bg-cyan-500/15 ${accent.text}`
                      : 'border-white/[0.12] bg-white/[0.04] text-white/75 hover:border-white/25'
                  }`}
                >
                  {chip.label}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-[11px] text-white/35">Templates hydrate format, size, and scoring — you can override below.</p>
        </div>
      ) : null}

      <div className="space-y-5">
        <div>
          <label className={labelClass} htmlFor="qc-league-name">
            League name
          </label>
          <input
            id="qc-league-name"
            className={fieldClass}
            value={state.name}
            onChange={(e) => onChange({ name: e.target.value, nameTouched: true })}
            placeholder="e.g. Sunday Night Crew"
            autoComplete="off"
            maxLength={100}
            aria-invalid={Boolean(fe?.leagueName)}
          />
          {fe?.leagueName ? <p className="mt-1 text-xs text-rose-300/90">{fe.leagueName}</p> : null}
        </div>

        <div>
          <label className={labelClass} htmlFor="qc-sport">
            Sport
          </label>
          <select
            id="qc-sport"
            className={fieldClass}
            value={state.sport}
            onChange={(e) => onSportChange(e.target.value as SupportedSport)}
          >
            {SUPPORTED_SPORTS.map((s) => (
              <option key={s} value={s}>
                {s === 'SOCCER' ? 'Soccer' : s}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="qc-teams">
            League size
          </label>
          <select
            id="qc-teams"
            className={`${fieldClass} ${!lt ? 'opacity-40' : ''}`}
            disabled={!lt}
            value={state.teamCount}
            onChange={(e) => {
              const n = Number(e.target.value)
              onChange({
                teamCount: n,
                ...(lt === 'tournament' ? { tournamentPoolSize: n } : {}),
              })
            }}
          >
            {teamOpts.map((n) => (
              <option key={n} value={n}>
                {n} {lt === 'tournament' ? 'managers (pool)' : 'teams'}
              </option>
            ))}
          </select>
          {fe?.teamCount ? <p className="mt-1 text-xs text-rose-300/90">{fe.teamCount}</p> : null}
        </div>

        <div>
          <p className={labelClass}>Public / private</p>
          {lt === 'best_ball' ? (
            <div className="mt-2">
              <Segmented
                ariaLabel="League visibility"
                accent={accent}
                value={state.bestBall.visibility}
                onChange={(visibility) => onChange({ bestBall: { ...state.bestBall, visibility } })}
                options={[
                  { value: 'private' as const, label: 'Private' },
                  { value: 'public' as const, label: 'Public' },
                ]}
              />
            </div>
          ) : lt && isDynastyConcept(lt) ? (
            <div className="mt-2">
              <Segmented
                ariaLabel="League visibility"
                accent={accent}
                value={state.dynasty.visibility}
                onChange={(visibility) =>
                  onChange({
                    dynasty: { ...state.dynasty, visibility },
                  })
                }
                options={[
                  { value: 'private' as const, label: 'Private' },
                  { value: 'public' as const, label: 'Public' },
                ]}
              />
            </div>
          ) : (
            <div className="mt-2">
              <Segmented
                ariaLabel="Discovery visibility"
                accent={accent}
                value={state.standardDiscoveryVisibility}
                onChange={(standardDiscoveryVisibility) =>
                  onChange({
                    standardDiscoveryVisibility: standardDiscoveryVisibility as CanonicalLeagueDiscoveryVisibility,
                  })
                }
                options={[
                  { value: 'private' as const, label: 'Private' },
                  { value: 'public' as const, label: 'Public' },
                  { value: 'invite_only' as const, label: 'Invite-only' },
                ]}
              />
            </div>
          )}
        </div>

        <div>
          <p className={labelClass}>Free / paid</p>
          {supportsPaidToggle ? (
            lt === 'best_ball' ? (
              <div className="mt-2">
                <Segmented
                  ariaLabel="League monetization"
                  accent={accent}
                  value={state.bestBall.monetization}
                  onChange={(monetization) => {
                    const nextBb = { ...state.bestBall, monetization }
                    if (monetization === 'paid' && (nextBb.entryFeeCents ?? 0) < 100) {
                      nextBb.entryFeeCents = 100
                      nextBb.payoutType = nextBb.payoutType === 'not_configured' ? 'commissioner_managed' : nextBb.payoutType
                    }
                    onChange({ bestBall: nextBb })
                  }}
                  options={[
                    { value: 'free' as const, label: 'Free' },
                    { value: 'paid' as const, label: 'Paid' },
                  ]}
                />
              </div>
            ) : (
              <div className="mt-2">
                <Segmented
                  ariaLabel="League monetization"
                  accent={accent}
                  value={state.dynasty.monetization}
                  onChange={(monetization) => {
                    const next = { ...state.dynasty, monetization }
                    if (monetization === 'paid') {
                      if (!Number.isFinite(next.entryFeeDollars) || next.entryFeeDollars < 1) {
                        next.entryFeeDollars = 50
                      }
                      if (next.payoutType === 'not_configured') {
                        next.payoutType = 'commissioner_managed'
                      }
                    }
                    onChange({ dynasty: next })
                  }}
                  options={[
                    { value: 'free' as const, label: 'Free' },
                    { value: 'paid' as const, label: 'Paid' },
                  ]}
                />
              </div>
            )
          ) : (
            <p className="mt-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-xs text-white/55">
              Free league — paid entry for this format is configured in Advanced.
            </p>
          )}
        </div>

        <div>
          <label className={labelClass} htmlFor="qc-scoring">
            Scoring preset
          </label>
          <select
            id="qc-scoring"
            className={`${fieldClass} ${!lt ? 'opacity-40' : ''}`}
            disabled={!lt}
            value={state.scoringPresetId}
            onChange={(e) => {
              const scoringPresetId = e.target.value
              onChange({
                scoringPresetId,
                ...(isFootballLike(state.sport) ? hydrateFootballScoringFields(state.sport, false, scoringPresetId) : {}),
              })
            }}
          >
            {scoringOpts.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {fe?.scoringPreset ? <p className="mt-1 text-xs text-rose-300/90">{fe.scoringPreset}</p> : null}
        </div>

        <div>
          <label className={labelClass} htmlFor="qc-draft-type">
            Draft type
          </label>
          <select
            id="qc-draft-type"
            className={`${fieldClass} ${!lt ? 'opacity-40' : ''}`}
            disabled={!lt}
            value={state.draftType}
            onChange={(e) => onChange({ draftType: e.target.value as CreateLeagueV2State['draftType'] })}
          >
            {draftOpts.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {fe?.draftType ? <p className="mt-1 text-xs text-rose-300/90">{fe.draftType}</p> : null}
        </div>

        <div>
          <label className={labelClass} htmlFor="qc-draft-when">
            Draft date / time
          </label>
          <input
            id="qc-draft-when"
            type="datetime-local"
            className={`${fieldClass} ${!supportsDraftSchedule ? 'cursor-not-allowed opacity-40' : ''}`}
            disabled={!supportsDraftSchedule}
            value={draftLocal}
            onChange={(e) => {
              const v = fromLocalDatetimeValue(e.target.value)
              if (lt === 'best_ball') {
                onChange({ bestBall: { ...state.bestBall, draftDateUtc: v } })
              } else if (lt && isDynastyConcept(lt)) {
                onChange({
                  dynasty: {
                    ...state.dynasty,
                    draftDateUtc: v,
                    draftMode: v.trim() ? 'scheduled' : 'offline',
                  },
                })
              }
            }}
          />
          <p className="mt-1 text-[11px] text-white/38">
            {supportsDraftSchedule
              ? 'Leave empty for offline / TBD startup draft. When set, dynasty uses scheduled mode.'
              : 'Scheduling for this format is handled after create, or switch to Dynasty / Best Ball.'}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onSwitchToAdvanced}
        className="mt-8 w-full touch-manipulation rounded-xl border border-cyan-400/35 bg-cyan-500/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/20"
        data-testid="quick-create-advanced-settings"
      >
        Advanced commissioner settings
      </button>
    </GlassCard>
  )
}
