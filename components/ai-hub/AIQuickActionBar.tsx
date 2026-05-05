'use client'

import React from 'react'
import Link from 'next/link'
import { MessageCircle, ArrowLeftRight, ClipboardList, Target, Zap } from 'lucide-react'
import { AIProductLayer } from '@/lib/ai-product-layer'

const QUICK_ACTIONS = [
  {
    id: 'ask-chimmy',
    label: 'Ask Chimmy',
    href: () => AIProductLayer.chimmy.getChatHref({ source: 'quick_action' }),
    icon: MessageCircle,
  },
  {
    id: 'compare-trade',
    label: 'Compare Trade',
    href: () => AIProductLayer.routes.getHrefForFeature('trade_analyzer', { source: 'quick_action' }),
    icon: ArrowLeftRight,
  },
  {
    id: 'waiver-targets',
    label: 'Find Waiver Targets',
    href: () => AIProductLayer.routes.getHrefForFeature('waiver_ai', { source: 'quick_action' }),
    icon: ClipboardList,
  },
  {
    id: 'draft-advice',
    label: 'Draft Advice',
    href: () => AIProductLayer.routes.getHrefForFeature('draft_helper', { source: 'quick_action' }),
    icon: Target,
  },
  {
    id: 'explain-matchup',
    label: 'Explain Matchup',
    href: () => AIProductLayer.chimmy.getChatHrefWithPrompt('Explain my matchup', { source: 'quick_action', insightType: 'matchup' }),
    icon: Zap,
  },
]

export interface AIQuickActionBarProps {
  className?: string
}

/**
 * Quick action links: Ask Chimmy, Compare Trade, Find Waiver Targets, Draft Advice, Explain Matchup.
 * Every item is a real Link with href (no dead buttons).
 */
export default function AIQuickActionBar({ className = '' }: AIQuickActionBarProps) {
  return (
    <div className={`flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center ${className}`}>
      <span className="shrink-0 text-xs font-medium text-white/50">Quick actions</span>
      <div className="scrollbar-none -mx-1 flex flex-nowrap gap-2 overflow-x-auto px-1 pb-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:pb-0 [-webkit-overflow-scrolling:touch]">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon
          const href = action.href()
          return (
            <Link
              key={action.id}
              href={href}
              data-quick-action={action.id}
              data-testid={`ai-quick-action-${action.id}`}
              className="inline-flex shrink-0 touch-manipulation items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-xs font-medium text-white/80 transition hover:border-white/25 hover:bg-white/10 hover:text-white sm:py-2"
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {action.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
