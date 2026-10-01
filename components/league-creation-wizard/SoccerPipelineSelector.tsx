'use client'

import { OptionCardMedia } from '@/components/league-creation-wizard/OptionCardMedia'
import type { SoccerPipeline } from '@/lib/soccer/soccer-pipeline'

export type SoccerPipelineSelectorProps = {
  value: SoccerPipeline
  onChange: (pipeline: SoccerPipeline) => void
}

const OPTIONS: {
  id: SoccerPipeline
  label: string
  description: string
  /** Public MP4 when present; shared soccer motion clip for both pipelines. */
  videoSrc?: string
  posterSrc: string
  fallbackSrc: string
}[] = [
  {
    id: 'euro',
    label: 'European leagues',
    description: 'Premier League, La Liga, Serie A, Bundesliga, UCL pipeline (Euro data feeds).',
    videoSrc: '/Soccer.mp4',
    posterSrc: '/Soccer.png',
    fallbackSrc: '/af-crest.svg',
  },
  {
    id: 'mls',
    label: 'MLS / North America',
    description: 'Major League Soccer and NA soccer feeds (aligned with MLS API paths).',
    videoSrc: '/Soccer.mp4',
    posterSrc: '/Soccer.png',
    fallbackSrc: '/af-crest.svg',
  },
]

/**
 * Shown when the user selects Soccer — picks which external soccer data chain the league uses.
 */
export function SoccerPipelineSelector({ value, onChange }: SoccerPipelineSelectorProps) {
  return (
    <div className="space-y-3" data-testid="wizard-soccer-pipeline">
      <div>
        <h3 className="text-sm font-semibold text-white/90">Soccer data region</h3>
        <p className="mt-1 text-xs leading-relaxed text-white/55">
          Choose which player and match data source powers this league. You can’t mix both in one league.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {OPTIONS.map((opt) => {
          const selected = value === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              data-testid={`wizard-soccer-pipeline-${opt.id}`}
              onClick={() => onChange(opt.id)}
              className={[
                'group relative overflow-hidden rounded-xl border px-0 py-0 text-left transition-colors',
                selected
                  ? 'border-cyan-400/50 bg-cyan-500/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                  : 'border-white/10 bg-black/25 hover:border-white/15 hover:bg-white/[0.04]',
              ].join(' ')}
            >
              <OptionCardMedia
                videoSrc={opt.videoSrc}
                posterSrc={opt.posterSrc}
                fallbackSrc={opt.fallbackSrc}
                gradientOverlay={false}
                frameClassName="relative aspect-[16/9] min-h-[5.5rem] w-full overflow-hidden bg-black/40"
                mediaClassName="object-cover object-center"
              />
              <div className="pointer-events-none absolute inset-0 z-[3] bg-gradient-to-t from-black/88 via-black/40 to-transparent" />
              <div className="relative z-[4] px-3 pb-3 pt-2">
                <div className="text-sm font-medium text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">{opt.label}</div>
                <div className="mt-1 text-[11px] leading-snug text-white/75 drop-shadow-[0_1px_6px_rgba(0,0,0,0.95)]">
                  {opt.description}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
