'use client'

import { useMemo } from 'react'
import { getVariantsForSport } from '@/lib/sport-defaults/LeagueVariantRegistry'
import type { PlatformStyleMirror } from '@/lib/league-creation-wizard/types'
import { resolveVariantForPlatformStyle } from '@/lib/league-creation-wizard/platform-style'
import { Label } from '@/components/ui/label'
import { StepHeader } from './StepHelp'

const STYLE_OPTIONS: { id: PlatformStyleMirror; label: string; hint: string }[] = [
  { id: 'af', label: 'AllFantasy default', hint: 'Balanced preset for this sport' },
  { id: 'espn', label: 'ESPN-style', hint: 'Closer to ESPN default scoring where available' },
  { id: 'yahoo', label: 'Yahoo-style', hint: 'Closer to Yahoo default scoring where available' },
]

export type PlatformStyleSelectorProps = {
  sport: string
  value: PlatformStyleMirror
  onChange: (style: PlatformStyleMirror) => void
  onResolvedVariant: (variantValue: string) => void
}

/**
 * Picks a concrete league variant from the registry using a familiar host as inspiration.
 */
export function PlatformStyleSelector({ sport, value, onChange, onResolvedVariant }: PlatformStyleSelectorProps) {
  const variants = useMemo(() => getVariantsForSport(sport), [sport])
  const safeValue = STYLE_OPTIONS.some((option) => option.id === value) ? value : 'af'

  const apply = (style: PlatformStyleMirror) => {
    onChange(style)
    const resolved = resolveVariantForPlatformStyle(sport, style, variants)
    onResolvedVariant(resolved)
  }

  return (
    <div className="space-y-4 rounded-2xl border border-cyan-400/15 bg-[#0a1228]/50 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-sm">
      <StepHeader
        title="Scoring style (preset)"
        description="Choose whose default flavor you want to start from. You can fine-tune the preset below."
        help={<>These shortcuts only change the starting preset — not your host login or data.</>}
        helpTitle="Platform styles"
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {STYLE_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => apply(opt.id)}
            className={`rounded-xl border px-2 py-2.5 text-left text-xs transition ${
              safeValue === opt.id
                ? 'border-cyan-300/50 bg-cyan-500/12 text-white shadow-[0_0_0_1px_rgba(0,255,220,0.1)_inset]'
                : 'border-white/10 bg-black/30 text-white/80 hover:border-white/18 hover:bg-black/40'
            }`}
          >
            <div className="font-semibold leading-tight">{opt.label}</div>
            <div className="mt-1 text-[11px] text-white/45 leading-snug">{opt.hint}</div>
          </button>
        ))}
      </div>
      <div className="space-y-1">
        <Label className="text-[11px] text-white/50">Active variant after shortcut</Label>
        <p className="text-sm text-cyan-100/90">
          {resolveVariantForPlatformStyle(sport, safeValue, variants)}
        </p>
      </div>
    </div>
  )
}
