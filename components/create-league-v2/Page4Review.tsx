'use client'

/**
 * Page 4 — Review.
 *
 * AI-summary-style overview of every choice. Each section has an "Edit"
 * link that jumps back to the relevant page.
 */

import type { AccentTone } from '@/lib/create-league-v2/theme'
import type { CreateLeagueV2State, V2PageId } from '@/lib/create-league-v2/state'
import { getEffectiveLeagueType, isFootballLike } from '@/lib/create-league-v2/state'
import { isThirdRoundReversalAvailable } from '@/lib/create-league-v2/rules-engine'
import { getDraftTypeUiLabel } from '@/lib/draft-types/draftTypeRegistry'
import { GlassCard, InnerPanel } from './primitives'

const LEAGUE_TYPE_LABEL: Record<string, string> = {
  redraft: 'Redraft',
  dynasty: 'Dynasty',
  keeper: 'Keeper',
  best_ball: 'Best Ball',
  salary_cap: 'Salary Cap',
  survivor: 'Survivor',
  guillotine: 'Guillotine',
  devy: 'Devy',
  c2c: 'College to Pros',
  zombie: 'Zombie',
  big_brother: 'Big Brother',
}

const SOCCER_PIPELINE_LABEL: Record<string, string> = {
  mls: 'MLS (North America)',
  euro: 'European (Top 5)',
}

const SCORING_LABEL = {
  af: 'AllFantasy Default',
  sleeper: 'Sleeper Defaults',
  espn: 'ESPN Defaults',
  yahoo: 'Yahoo Defaults',
} as const

const TRADE_REVIEW_LABEL = {
  none: 'Instant (no review)',
  commissioner: 'Commissioner Review',
  league_vote: 'League Vote',
} as const

const PPR_LABEL = { standard: 'Standard', half: 'Half PPR', full: 'Full PPR' } as const

function Badge({ children, accent }: { children: React.ReactNode; accent: AccentTone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-white/[0.08] px-3 py-1 text-[11px] font-semibold ${accent.text}`}
      style={{ background: `${accent.hex}10`, boxShadow: `0 0 12px -4px ${accent.hex}40` }}
    >
      {children}
    </span>
  )
}

function Row({
  label,
  value,
  accent: _accent,
}: {
  label: string
  value: React.ReactNode
  accent: AccentTone
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/[0.04] py-2.5 last:border-b-0">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">{label}</span>
      <span className="text-right text-sm font-semibold text-white/95">{value}</span>
    </div>
  )
}

function SectionCard({
  title,
  onEdit,
  children,
  accent,
}: {
  title: string
  onEdit: () => void
  children: React.ReactNode
  accent: AccentTone
}) {
  return (
    <InnerPanel className="overflow-hidden">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="h-1 w-1 rounded-full"
            style={{ background: accent.hex, boxShadow: `0 0 6px ${accent.hex}` }}
          />
          <h4 className={`text-[11px] font-bold uppercase tracking-[0.16em] ${accent.text}`}>{title}</h4>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] font-semibold text-white/50 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
        >
          Edit
        </button>
      </div>
      <div className="divide-y divide-white/[0.04]">{children}</div>
    </InnerPanel>
  )
}

export interface Page4ReviewProps {
  state: CreateLeagueV2State
  accent: AccentTone
  onJump: (page: V2PageId) => void
}

export function Page4Review({ state, accent, onJump }: Page4ReviewProps) {
  const football = isFootballLike(state.sport)
  const lt = getEffectiveLeagueType(state)

  return (
    <div className="space-y-4">
      <GlassCard>
        <div className="mb-6">
          <div className="mb-3 flex items-center gap-3">
            <span
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-lg"
              style={{ background: `linear-gradient(135deg, ${accent.hex}30, ${accent.hexSoft}20)`, boxShadow: `0 0 20px -6px ${accent.hex}` }}
            >
              ✦
            </span>
            <div>
              <h2 className="text-2xl font-black tracking-tight text-white">League Blueprint</h2>
              <p className="text-xs text-white/45">AI-ready configuration summary</p>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-white/50">
            Review your setup below. Tap <span className="text-white/75">Edit</span> on any section to adjust.
          </p>
        </div>

        <div className="space-y-3">
          {/* Overview */}
          <SectionCard title="League Overview" accent={accent} onEdit={() => onJump('setup')}>
            <Row
              label="Name"
              accent={accent}
              value={state.name.trim() || <span className="text-white/30">— unnamed —</span>}
            />
            <Row
              label="Format"
              accent={accent}
              value={
                <Badge accent={accent}>
                  {state.idpSelected ? 'IDP' : lt ? LEAGUE_TYPE_LABEL[String(lt)] ?? lt : '—'}
                </Badge>
              }
            />
            <Row label="Sport" accent={accent} value={state.sport} />
            {state.sport === 'SOCCER' && state.soccerPipeline && (
              <Row label="Region" accent={accent} value={SOCCER_PIPELINE_LABEL[state.soccerPipeline] ?? state.soccerPipeline} />
            )}
            <Row label="Teams" accent={accent} value={state.teamCount} />
            {lt === 'survivor' ? (
              <Row label="Starting Tribes" accent={accent} value={state.survivorTribeCount} />
            ) : null}
          </SectionCard>

          {/* Rules */}
          <SectionCard title="Rules & Draft" accent={accent} onEdit={() => onJump('setup')}>
            <Row
              label="Draft Type"
              accent={accent}
              value={
                <Badge accent={accent}>
                  {getDraftTypeUiLabel(String(state.draftType), lt ?? undefined)}
                </Badge>
              }
            />
            {isThirdRoundReversalAvailable(state.draftType) ? (
              <Row
                label="3RR"
                accent={accent}
                value={state.thirdRoundReversal ? 'Enabled' : 'Disabled'}
              />
            ) : null}
            <Row
              label="Trade Review"
              accent={accent}
              value={TRADE_REVIEW_LABEL[state.tradeReviewMode]}
            />
            <Row label="Timezone" accent={accent} value={state.timezone} />
            <Row label="Language" accent={accent} value={state.language.toUpperCase()} />
          </SectionCard>

          {/* Scoring */}
          <SectionCard title="Scoring" accent={accent} onEdit={() => onJump('scoring')}>
            <Row label="Source" accent={accent} value={SCORING_LABEL[state.scoringSource]} />
            {football ? (
              <>
                <Row label="Reception" accent={accent} value={PPR_LABEL[state.pprMode]} />
                <Row label="Superflex" accent={accent} value={state.superflex ? 'Yes' : 'No'} />
                <Row
                  label="TE Premium"
                  accent={accent}
                  value={
                    state.tePremium ? (
                      <Badge accent={accent}>×{state.tePremiumMultiplier}</Badge>
                    ) : (
                      'No'
                    )
                  }
                />
              </>
            ) : (
              <Row
                label="Preset"
                accent={accent}
                value={`${state.sport} defaults`}
              />
            )}
          </SectionCard>

          {state.description.trim() ? (
            <SectionCard title="Description" accent={accent} onEdit={() => onJump('identity')}>
              <p className="py-1 text-sm leading-relaxed text-white/80">{state.description.trim()}</p>
            </SectionCard>
          ) : null}
        </div>
      </GlassCard>
    </div>
  )
}
