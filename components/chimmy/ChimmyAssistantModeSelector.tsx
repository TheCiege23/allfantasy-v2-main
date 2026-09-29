'use client'

import { BarChart3, Crown, Shield, TrendingUp, Zap } from 'lucide-react'
import {
  CHIMMY_ASSISTANT_MODE_VALUES,
  type ChimmyAssistantMode,
} from '@/lib/chimmy-chat/assistant-mode'

type ChimmyAssistantModeSelectorProps = {
  enabled: boolean
  value: ChimmyAssistantMode
  onChange: (nextMode: ChimmyAssistantMode) => void
}

const MODE_CONFIG: Record<
  ChimmyAssistantMode,
  { icon: React.ComponentType<{ className?: string }>; label: string; description: string }
> = {
  fast_take: {
    icon: Zap,
    label: 'Fast Take',
    description: 'Quick verdict',
  },
  deep_analysis: {
    icon: BarChart3,
    label: 'Deep Analysis',
    description: 'Full breakdown',
  },
  commissioner_view: {
    icon: Shield,
    label: 'Commissioner',
    description: 'League ops lens',
  },
  dynasty_lens: {
    icon: Crown,
    label: 'Dynasty',
    description: 'Long-term view',
  },
  dfs_upside: {
    icon: TrendingUp,
    label: 'DFS/Upside',
    description: 'Ceiling plays',
  },
}

export default function ChimmyAssistantModeSelector({
  enabled,
  value,
  onChange,
}: ChimmyAssistantModeSelectorProps) {
  if (!enabled) return null

  return (
    <div
      className="flex flex-col gap-1.5"
      data-testid="chimmy-assistant-mode-wrap"
    >
      <span className="text-[11px] uppercase tracking-wide text-white/45">Assistant mode</span>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-5">
        {CHIMMY_ASSISTANT_MODE_VALUES.map((mode) => {
          const cfg = MODE_CONFIG[mode]
          const Icon = cfg.icon
          const isActive = mode === value
          return (
            <button
              key={mode}
              type="button"
              data-testid={`chimmy-mode-pill-${mode}`}
              onClick={() => onChange(mode)}
              className={[
                'flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-center transition-all duration-150',
                isActive
                  ? 'border-cyan-500 bg-cyan-500/10 text-cyan-100'
                  : 'border-white/10 bg-white/[0.04] text-white/55 hover:bg-white/[0.07] hover:text-white/75',
              ].join(' ')}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="text-[11px] font-semibold leading-tight">{cfg.label}</span>
              <span className="text-[11px] leading-tight opacity-70">{cfg.description}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
