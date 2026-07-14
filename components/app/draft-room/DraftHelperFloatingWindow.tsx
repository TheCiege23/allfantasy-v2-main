'use client'

import { useRef, useEffect, useState } from 'react'
import { X, ChevronDown, ChevronRight, Sparkles, Zap, AlertCircle, Layers } from 'lucide-react'
import Draggable from 'react-draggable'
import { cn } from '@/lib/utils'
import type { DraftHelperFloatingWindowState } from '@/hooks/useDraftHelperFloatingState'
import { DraftHelperCopilot } from '@/components/app/draft-room/DraftHelperCopilot'
import { DraftHelperIntelligence } from '@/components/app/draft-room/DraftHelperIntelligence'
import type { DraftHelperPanelProps } from '@/components/app/draft-room/DraftHelperPanel'

interface DraftHelperFloatingWindowProps {
  visible: boolean
  onClose: () => void
  state: DraftHelperFloatingWindowState
  onPositionChange: (pos: { x: number; y: number }) => void
  onSizeChange: (size: { width: number; height: number }) => void
  onToggleSection: (section: keyof DraftHelperFloatingWindowState['expandedSections']) => void
  badgeCount: number
  // Props that can be passed through to child components
  copilotProps?: Partial<DraftHelperPanelProps> & {
    showAiOverlays?: boolean
    recommendationOverlay?: {
      valueDelta?: number | null
      stackAvailable?: boolean
      byeWeekConflict?: boolean
      safetyLevel?: 'safe' | 'upside' | null
    } | null
  }
  intelligenceProps?: {
    aiFeatureStatus?: DraftHelperPanelProps['aiFeatureStatus']
    sportsFeed?: DraftHelperPanelProps['sportsFeed']
    showAiOverlays?: boolean
    recommendationOverlay?: {
      label?: string | null
      confidencePct?: number | null
      stackAvailable?: boolean
      byeWeekConflict?: boolean
      safetyLevel?: 'safe' | 'upside' | null
    } | null
  }
}

interface Section {
  id: keyof DraftHelperFloatingWindowState['expandedSections']
  title: string
  icon: React.ReactNode
  content: React.ReactNode
}

export function DraftHelperFloatingWindow({
  visible,
  onClose,
  state,
  onPositionChange,
  onSizeChange,
  onToggleSection,
  badgeCount,
  copilotProps,
  intelligenceProps,
}: DraftHelperFloatingWindowProps) {
  const nodeRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!visible || !mounted) return null

  const sections: Section[] = [
    {
      id: 'copilot',
      title: 'DRAFT COPILOT',
      icon: <Sparkles className="w-4 h-4" />,
      content: copilotProps ? (
        <DraftHelperCopilot
          loading={copilotProps.loading ?? false}
          recommendation={copilotProps.recommendation ?? null}
          alternatives={copilotProps.alternatives ?? []}
          onRefresh={copilotProps.onRefresh ?? (() => {})}
          explanation={copilotProps.explanation ?? ''}
          evidence={copilotProps.evidence ?? []}
          caveats={copilotProps.caveats ?? []}
          round={copilotProps.round ?? 1}
          pick={copilotProps.pick ?? 1}
          sport={copilotProps.sport ?? 'NFL'}
          showAiOverlays={copilotProps.showAiOverlays ?? true}
          recommendationOverlay={copilotProps.recommendationOverlay ?? null}
        />
      ) : (
        <div className="text-sm text-gray-300 p-2">Copilot data loading...</div>
      ),
    },
    {
      id: 'warRoom',
      title: 'WAR ROOM (LIVE BOARD)',
      icon: <Zap className="w-4 h-4" />,
      content: <div className="text-sm text-gray-300 p-2">War room data Coming Soon</div>,
    },
    {
      id: 'intelligence',
      title: 'DRAFT INTELLIGENCE',
      icon: <AlertCircle className="w-4 h-4" />,
      content: (
        <DraftHelperIntelligence
          aiFeatureStatus={intelligenceProps?.aiFeatureStatus}
          sportsFeed={intelligenceProps?.sportsFeed}
          showAiOverlays={intelligenceProps?.showAiOverlays ?? true}
          recommendationOverlay={intelligenceProps?.recommendationOverlay ?? null}
        />
      ),
    },
    {
      id: 'fullWarRoom',
      title: 'FULL WAR ROOM (BUILD)',
      icon: <Layers className="w-4 h-4" />,
      content: <div className="text-sm text-gray-300 p-2">Full war room content Coming Soon</div>,
    },
  ]

  return (
    <Draggable
      nodeRef={nodeRef}
      defaultPosition={{ x: state.position.x, y: state.position.y }}
      onStop={(e, d) => {
        onPositionChange({ x: d.x, y: d.y })
      }}
    >
      <div
        ref={nodeRef}
        className={cn(
          'fixed z-30',
          'bg-gradient-to-b from-slate-900 to-slate-950',
          'border border-slate-700 rounded-lg shadow-2xl',
          'flex flex-col',
          'min-w-[350px] min-h-[300px]'
        )}
        style={{
          width: state.size.width,
          height: state.size.height,
        }}
      >
        {/* Header */}
        <div
          className={cn(
            'flex items-center justify-between',
            'px-4 py-3',
            'bg-gradient-to-r from-purple-900/50 to-purple-800/30',
            'border-b border-slate-700',
            'cursor-move',
            'rounded-t-lg'
          )}
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-400" />
            <h3 className="font-semibold text-white text-sm">Draft Helper</h3>
            {badgeCount > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-red-500/20 text-red-300 text-xs rounded-full border border-red-500/30">
                {badgeCount}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-1"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sections Container */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
          {sections.map((section) => (
            <div
              key={section.id}
              className="border border-slate-700 rounded-md bg-slate-800/50 overflow-hidden"
            >
              {/* Section Header */}
              <button
                onClick={() => onToggleSection(section.id)}
                className={cn(
                  'w-full px-3 py-2',
                  'flex items-center justify-between',
                  'hover:bg-slate-700/50 transition-colors',
                  'text-left'
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="text-slate-400 flex-shrink-0">{section.icon}</div>
                  <span className="text-xs font-semibold text-slate-300 truncate">{section.title}</span>
                </div>
                <div className="text-slate-500 flex-shrink-0">
                  {state.expandedSections[section.id] ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </div>
              </button>

              {/* Section Content */}
              {state.expandedSections[section.id] && (
                <div className="px-3 py-2 bg-slate-900/30 border-t border-slate-700 text-xs text-slate-400 max-h-48 overflow-y-auto">
                  {section.content}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-3 py-2 text-center border-t border-slate-700 bg-slate-900/50 text-xs text-slate-500 rounded-b-lg">
          Drag to move · Click sections to expand
        </div>
      </div>
    </Draggable>
  )
}
