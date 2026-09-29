'use client'

import { Label } from '@/components/ui/label'
import { getDraftTypeUiLabel } from '@/lib/draft-types/draftTypeRegistry'
import type { DraftTypeId, LeagueTypeId } from '@/lib/league-creation-wizard/types'
import { getCreateLeagueDraftTypes } from '@/lib/league/format-engine'
import { StepHeader } from './StepHelp'
import { getDraftTypeMedia } from '@/lib/league-media/draftTypeMedia'
import { LeagueStepPreviewVideo, OptionCardMedia } from './OptionCardMedia'

export type DraftTypeSelectorProps = {
  sport: string
  leagueType: LeagueTypeId
  value: DraftTypeId
  onChange: (draftType: DraftTypeId) => void
}

const DRAFT_TYPE_TOOLTIPS: Record<DraftTypeId, string> = {
  snake: 'Pick order reverses each round (1–12, then 12–1). Most common.',
  linear: 'Same pick order every round (1, 2, 3…).',
  auction: 'Each team has a budget; bid on players. Highest bid wins.',
  slow_draft: 'No live timer; picks can take hours or days. Good for busy leagues.',
  mock_draft: 'Practice draft engine mode tied to mock-draft flows and recap tools.',
  devy_snake: 'Snake draft with a college-only devy pool and devy-specific rules.',
  devy_auction: 'Auction draft for devy assets with college-only player pool support.',
  c2c_snake: 'Snake draft for mixed C2C pools, including dedicated college rounds.',
  c2c_auction: 'Auction draft for C2C leagues with college/pro pool controls.',
  devy_linear: 'Linear draft for devy leagues — same pick order every round, college-only pool.',
  c2c_linear: 'Linear draft for C2C leagues with mixed college/pro pool and same order each round.',
}

const DRAFT_TYPE_DESCRIPTIONS: Record<DraftTypeId, string> = {
  snake: 'Each round reverses order. Most common way to draft.',
  linear: 'The same draft order repeats every round.',
  auction: 'Each manager gets a budget and bids on every player.',
  slow_draft: 'Async format with longer pick windows.',
  mock_draft: 'Practice-first draft flow that integrates with the mock draft engine stack.',
  devy_snake: 'College-player snake draft that feeds long-term devy rosters.',
  devy_auction: 'College-player auction draft that supports premium devy stash formats.',
  c2c_snake: 'Campus to Canton snake draft with college rounds and optional pro mixing.',
  c2c_auction: 'Campus to Canton auction format with mixed pool bidding.',
  devy_linear: 'College-player linear draft that feeds long-term devy rosters.',
  c2c_linear: 'Campus to Canton linear draft with college rounds and optional pro mixing.',
}

const DRAFT_TYPE_ICONS: Record<DraftTypeId, string> = {
  snake: '↔',
  linear: '⇢',
  auction: '◼',
  slow_draft: '⏱',
  mock_draft: '🎯',
  devy_snake: '🎓',
  devy_auction: '🏷',
  c2c_snake: '🏈',
  c2c_auction: '🏀',
  devy_linear: '🎓',
  c2c_linear: '🏈',
}

/**
 * Draft type selection for startup leagues (snake, linear, auction).
 */
function draftTypeLabel(leagueType: LeagueTypeId, id: DraftTypeId): string {
  return getDraftTypeUiLabel(id, leagueType)
}

export function DraftTypeSelector({ sport, leagueType, value, onChange }: DraftTypeSelectorProps) {
  const allowed = getCreateLeagueDraftTypes(sport, leagueType) as DraftTypeId[]
  const safeValue = allowed.includes(value) ? value : allowed[0]!
  const previewMedia = getDraftTypeMedia(safeValue)
  return (
    <div className="space-y-6">
      <StepHeader
        title="Choose Draft Type"
        description="You can change it later in settings."
        help={
          <>
            <strong>Snake</strong> — Rounds go 1–12, 12–1, 1–12… <strong>Linear</strong> — Same order every round. <strong>Auction</strong> — Budget (e.g. $200); bid on players.
          </>
        }
        helpTitle="Draft type explained"
      />
      {leagueType === 'zombie' && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-amber-100/90">
          <strong className="font-semibold text-amber-200">Zombie leagues use Snake drafts only.</strong> Auction is not supported for this format.
        </div>
      )}
      <div className="space-y-3">
        <Label className="text-cyan-300">Type</Label>
        <p className="text-xs text-white/60">
          {leagueType === 'devy'
            ? 'Startup uses pro + college devy pools (NFL/NCAAF or NBA/NCAAB only — no MLB/NHL). Formats: '
            : leagueType === 'c2c'
              ? 'Pro + college C2C pools (NFL↔NCAAF or NBA↔NCAAB). Formats: '
              : `${String(sport).toUpperCase()} supports: `}
          {allowed.map((id) => draftTypeLabel(leagueType, id)).join(', ')}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {allowed.map((id) => {
            const media = getDraftTypeMedia(id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => onChange(id)}
                title={DRAFT_TYPE_TOOLTIPS[id]}
                className={`group min-h-[132px] overflow-hidden rounded-2xl border px-0 py-0 text-left transition ${
                  safeValue === id
                    ? 'border-cyan-300 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(0,255,220,0.2)_inset]'
                    : 'border-white/15 bg-black/25 hover:bg-white/[0.05] hover:shadow-[0_0_20px_rgba(0,255,220,0.05)]'
                }`}
              >
                <div className="relative h-20 w-full shrink-0 overflow-hidden bg-black/40">
                  <OptionCardMedia
                    videoSrc={media.selectionVideo}
                    posterSrc={media.thumbnail}
                    fallbackSrc={media.thumbnailFallback}
                    gradientOverlay={false}
                    frameClassName="relative h-full min-h-[5rem] w-full overflow-hidden"
                    mediaClassName="object-cover object-center"
                  />
                  <div className="pointer-events-none absolute inset-0 z-[3] bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
                </div>
                <div className="flex items-start gap-2 px-3 pb-3 pt-2">
                  <span
                    aria-hidden
                    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-base font-black ${
                      safeValue === id
                        ? 'border-cyan-300 text-cyan-200 bg-cyan-300/10'
                        : 'border-white/20 text-white/80 bg-black/20'
                    }`}
                  >
                    {DRAFT_TYPE_ICONS[id]}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-cyan-200/75">
                      {leagueType === 'devy' || leagueType === 'c2c'
                        ? draftTypeLabel(leagueType, id).toUpperCase()
                        : id.replace('_', ' ')}
                    </p>
                    <p className="text-sm font-bold leading-tight text-white">{draftTypeLabel(leagueType, id)}</p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-cyan-400/25 bg-[#07122d]/80 p-4">
        <p className="text-xs uppercase tracking-[0.14em] text-cyan-200/80">Draft type preview</p>
        <p className="mt-1 text-2xl font-black text-white">{draftTypeLabel(leagueType, safeValue)}</p>
        <p className="mt-1 text-sm text-cyan-200/75">How picks flow in your draft room</p>
        <LeagueStepPreviewVideo
          videoSrc={previewMedia.selectionVideo}
          posterSrc={previewMedia.thumbnail}
          fallbackSrc={previewMedia.thumbnailFallback}
          description={`${draftTypeLabel(leagueType, safeValue)} draft type preview`}
        />
        <p className="mt-3 text-base text-white/85">{DRAFT_TYPE_DESCRIPTIONS[safeValue]}</p>
      </div>
    </div>
  )
}
