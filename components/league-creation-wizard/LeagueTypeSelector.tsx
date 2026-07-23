'use client'

import { Label } from '@/components/ui/label'
import {
  LEAGUE_TYPE_IDS,
  LEAGUE_TYPE_LABELS,
} from '@/lib/league-creation-wizard/league-type-registry'
import { getLeagueTypeMedia } from '@/lib/league-media/leagueTypeMedia'
import type { LeagueTypeId } from '@/lib/league-creation-wizard/types'
import { StepHeader } from './StepHelp'
import { LeagueStepPreviewVideo, OptionCardMedia } from './OptionCardMedia'

export type LeagueTypeSelectorProps = {
  sport?: string
  value: LeagueTypeId
  onChange: (leagueType: LeagueTypeId) => void
}

const LEAGUE_TYPE_TOOLTIPS: Partial<Record<LeagueTypeId, string>> = {
  redraft: 'One season; redraft every year. Most common.',
  dynasty: 'Keep your full roster year to year; rookie drafts each season.',
  keeper: 'Keep a set number of players each season.',
  best_ball: 'No lineup setting; best scoring lineup counts each week.',
  devy: 'Long-term devy format: NFL/NCAAF or NBA/NCAAB prospect pipelines — not available for MLB, NHL, or Soccer.',
  c2c: 'Campus to Canton: college + pro assets in one league with live college scoring; supports football and basketball ecosystems.',
  guillotine: 'Lowest scorer each week is eliminated. Roster released to waivers. Last team standing wins.',
  survivor: 'Tribes compete weekly. Losing tribe votes someone out. Idols, exile island, merge, jury — full Survivor experience.',
  zombie: 'Infection mechanics, whisperer role, serums & weapons. Eliminated teams can spread the virus.',
  salary_cap: 'Salary cap and contracts.',
}

const LEAGUE_TYPE_BADGES: Partial<Record<LeagueTypeId, 'POPULAR' | 'NEW' | 'FLAGSHIP'>> = {
  redraft: 'POPULAR',
  survivor: 'FLAGSHIP',
  guillotine: 'NEW',
  zombie: 'NEW',
  salary_cap: 'NEW',
}

/**
 * League type selection (redraft, dynasty, keeper, etc.). Options filtered by sport.
 */
export function LeagueTypeSelector({ value, onChange }: LeagueTypeSelectorProps) {
  const visibleLeagueTypes = LEAGUE_TYPE_IDS
  const safeValue = visibleLeagueTypes.includes(value) ? value : visibleLeagueTypes[0]!
  const selectedMedia = getLeagueTypeMedia(safeValue)

  return (
    <div className="space-y-6">
      <StepHeader
        title="Choose League Type"
        description="You can change this later in settings (except where league rules lock the choice)."
        help={
          <>
            <strong>Redraft</strong> — New draft every season. <strong>Dynasty</strong> — Keep full roster; add rookies each year. <strong>Keeper</strong> — Keep a few players. <strong>Devy / C2C</strong> — College pipelines for NFL↔NCAAF and NBA↔NCAAB (no MLB/NHL Devy).
          </>
        }
        helpTitle="League type explained"
      />

      <div className="space-y-3">
        <Label className="text-cyan-300">Type</Label>
        <div className="grid gap-3 sm:grid-cols-2">
          {LEAGUE_TYPE_IDS.filter((id) => visibleLeagueTypes.includes(id)).map((id) => {
            const media = getLeagueTypeMedia(id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => onChange(id)}
                className={`group relative overflow-hidden rounded-2xl border text-left transition ${
                  safeValue === id
                    ? 'border-cyan-300 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(0,255,220,0.2)_inset]'
                    : 'border-white/15 bg-black/25 hover:bg-white/[0.05] hover:shadow-[0_0_24px_rgba(0,255,220,0.06)]'
                }`}
                title={LEAGUE_TYPE_TOOLTIPS[id]}
              >
                {LEAGUE_TYPE_BADGES[id] && (
                  <span className={`absolute left-2 top-2 z-[4] rounded-md px-1.5 py-0.5 text-[10px] font-black tracking-[0.08em] ${
                    LEAGUE_TYPE_BADGES[id] === 'FLAGSHIP'
                      ? 'bg-amber-400 text-[#1a0800]'
                      : LEAGUE_TYPE_BADGES[id] === 'NEW'
                        ? 'bg-purple-400 text-[#0f001a]'
                        : 'bg-[#00ffd4] text-[#021827]'
                  }`}>
                    {LEAGUE_TYPE_BADGES[id]}
                  </span>
                )}
                <OptionCardMedia
                  videoSrc={media.selectionVideo}
                  posterSrc={media.thumbnail}
                  fallbackSrc={media.thumbnailFallback}
                  gradientOverlay={false}
                  frameClassName="relative aspect-[16/9] min-h-[8rem] w-full overflow-hidden bg-black/50"
                  mediaClassName="object-cover object-center"
                />
                <div className="pointer-events-none absolute inset-0 z-[3] bg-gradient-to-t from-black/80 via-black/35 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 z-[4] p-3">
                  <p className="text-sm font-semibold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
                    {LEAGUE_TYPE_LABELS[id]}
                  </p>
                  {LEAGUE_TYPE_TOOLTIPS[id] && (
                    <p className="mt-0.5 text-[10px] leading-tight text-white/70 line-clamp-2 drop-shadow-[0_1px_6px_rgba(0,0,0,0.9)]">
                      {LEAGUE_TYPE_TOOLTIPS[id]}
                    </p>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-cyan-400/25 bg-[#07122d]/80 p-3">
        <p className="text-xs uppercase tracking-[0.14em] text-cyan-200/80">League type preview</p>
        <p className="mt-1 text-sm text-white/85">{LEAGUE_TYPE_LABELS[safeValue]}</p>
        <LeagueStepPreviewVideo
          videoSrc={selectedMedia.selectionVideo}
          posterSrc={selectedMedia.thumbnail}
          fallbackSrc={selectedMedia.thumbnailFallback}
          description={`${LEAGUE_TYPE_LABELS[safeValue]} selection preview clip`}
        />
        <p className="mt-2 text-xs text-white/60">
          This is the selection clip for your format; a welcome intro can still play when managers enter the league.
        </p>
      </div>
    </div>
  )
}
