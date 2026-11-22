'use client'

import React, { useMemo } from 'react'
import ChimmyQuickPrompts from './ChimmyQuickPrompts'
import { getChimmyIntentChips } from '@/lib/chimmy-chat/intent-chips'
import type { ChimmyAIAnalyticsIngressEvent } from '@/lib/chimmy-chat/analytics-events'
import type { ChimmyAssistantMode } from '@/lib/chimmy-chat/assistant-mode'

type ChimmyIntentChipsProps = {
  enabled: boolean
  hasUserMessage: boolean
  leagueId?: string | null
  leagueName?: string | null
  surface: ChimmyAIAnalyticsIngressEvent['surface']
  assistantMode: ChimmyAssistantMode
  source?: string | null
  maxVisible?: number
  onSendPrompt: (prompt: string) => void | Promise<void>
  onTrackEvent?: (event: Omit<ChimmyAIAnalyticsIngressEvent, 'user_id'>) => void | Promise<void>
}

export default function ChimmyIntentChips({
  enabled,
  hasUserMessage,
  leagueId,
  leagueName,
  surface,
  assistantMode,
  source,
  maxVisible = 7,
  onSendPrompt,
  onTrackEvent,
}: ChimmyIntentChipsProps) {
  const chips = useMemo(() => getChimmyIntentChips({ leagueName, source }), [leagueName, source])

  if (!enabled || hasUserMessage || chips.length === 0) return null

  return React.createElement(ChimmyQuickPrompts, {
    chips,
    maxVisible,
    onSelect: (chip) => {
      void onSendPrompt(chip.prompt)

      if (!onTrackEvent) return

      void onTrackEvent({
        event_name: 'chip_click',
        league_id: leagueId ?? null,
        surface,
        mode: assistantMode,
        topic:
          chip.category === 'trade' ||
          chip.category === 'start_sit' ||
          chip.category === 'waiver' ||
          chip.category === 'injury' ||
          chip.category === 'general' ||
          chip.category === 'draft' ||
          chip.category === 'commissioner'
            ? chip.category
            : undefined,
        action: 'intent_chip_selected',
        timestamp: new Date().toISOString(),
        metadata: {
          chipId: chip.id,
          chipLabel: chip.label,
          chipTopic: chip.category ?? null,
          surface,
          assistantMode,
          source: source ?? null,
        },
      })
    },
  })
}
