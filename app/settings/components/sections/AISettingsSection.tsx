'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

type SubscriptionTier = 'free' | 'af_pro' | 'af_commissioner'

type AIToggle = {
  id: string
  label: string
  description: string
  tier: 'af_pro' | 'af_commissioner'
  category: 'draft' | 'roster' | 'trade' | 'social' | 'content' | 'assistant'
}

const AI_TOGGLES: AIToggle[] = [
  // AF Pro Features
  { id: 'ai_draft_helper', label: 'Draft Helper', description: 'AI player recommendations during draft', tier: 'af_pro', category: 'draft' },
  { id: 'ai_autopick', label: 'AI Autopick', description: 'Intelligent autopick when away from draft', tier: 'af_pro', category: 'draft' },
  { id: 'ai_queue_builder', label: 'Queue Builder', description: 'AI-suggested draft queue order', tier: 'af_pro', category: 'draft' },
  { id: 'ai_start_sit', label: 'Start/Sit Advisor', description: 'Weekly lineup recommendations', tier: 'af_pro', category: 'roster' },
  { id: 'ai_lineup_optimizer', label: 'Lineup Optimizer', description: 'Optimal lineup based on matchups + projections', tier: 'af_pro', category: 'roster' },
  { id: 'ai_waiver_assistant', label: 'Waiver Assistant', description: 'Best waiver adds and drop suggestions', tier: 'af_pro', category: 'roster' },
  { id: 'ai_trade_analyzer', label: 'Trade Analyzer', description: 'AI trade fairness evaluation + counteroffers', tier: 'af_pro', category: 'trade' },
  { id: 'ai_matchup_insights', label: 'Matchup Insights', description: 'Win probability and key player analysis', tier: 'af_pro', category: 'roster' },
  { id: 'ai_player_insights', label: 'Player Insights', description: 'Performance trends and advanced stats', tier: 'af_pro', category: 'roster' },
  { id: 'ai_chimmy_advanced', label: 'Chimmy Advanced Mode', description: 'Full AI assistant with deep analysis', tier: 'af_pro', category: 'assistant' },

  // AF Commissioner Features
  { id: 'ai_power_rankings', label: 'Power Rankings', description: 'AI-generated weekly league power rankings', tier: 'af_commissioner', category: 'content' },
  { id: 'ai_weekly_recap', label: 'Weekly Recaps', description: 'AI-generated matchup recaps and storylines', tier: 'af_commissioner', category: 'content' },
  { id: 'ai_league_storyteller', label: 'League Storyteller', description: 'Narrative-driven league updates', tier: 'af_commissioner', category: 'content' },
  { id: 'ai_commissioner_tools', label: 'Commissioner AI Tools', description: 'Inactive detection, rule suggestions, dispute help', tier: 'af_commissioner', category: 'social' },
  { id: 'ai_collusion_detection', label: 'Collusion Detection', description: 'AI-flagged suspicious trades and behavior', tier: 'af_commissioner', category: 'social' },
  { id: 'ai_draft_grade', label: 'Draft Grades', description: 'Post-draft AI analysis and grades', tier: 'af_commissioner', category: 'draft' },
  { id: 'ai_managers', label: 'AI Managers', description: 'Up to 4 AI-controlled teams for drafts + orphan teams', tier: 'af_commissioner', category: 'draft' },
  { id: 'ai_social_content', label: 'Social Content', description: 'AI-generated shareable posts and recap cards', tier: 'af_commissioner', category: 'content' },
]

const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  draft: { label: 'Draft', icon: '📋' },
  roster: { label: 'Roster & Lineup', icon: '📊' },
  trade: { label: 'Trades', icon: '🔄' },
  social: { label: 'Social & Moderation', icon: '🛡️' },
  content: { label: 'Content & Recaps', icon: '📝' },
  assistant: { label: 'AI Assistant', icon: '🤖' },
}

export function AISettingsSection() {
  const [tier, setTier] = useState<SubscriptionTier>('free')
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const togglesRef = useRef<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/user/me', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { subscriptionTier?: string; aiSettings?: Record<string, boolean> } | null) => {
        if (d?.subscriptionTier) setTier(d.subscriptionTier as SubscriptionTier)
        if (d?.aiSettings) {
          setToggles(d.aiSettings)
          togglesRef.current = d.aiSettings
        }
      })
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [])

  async function handleToggle(id: string, value: boolean) {
    const nextToggles = { ...togglesRef.current, [id]: value }
    togglesRef.current = nextToggles
    setToggles(nextToggles)
    await fetch('/api/user/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ aiSettings: nextToggles }),
    }).catch(() => null)
  }

  const categories = [...new Set(AI_TOGGLES.map((t) => t.category))]

  return (
    <div className="space-y-6">
      {/* Subscription status */}
      <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--panel2)' }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>AI Features</p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
              Manage your AI-powered features and Chimmy assistant settings.
            </p>
          </div>
          <span
            className={clsx(
              'rounded-lg px-3 py-1 text-[11px] font-bold',
              tier === 'af_commissioner' ? 'bg-purple-500/15 text-purple-300' :
              tier === 'af_pro' ? 'bg-violet-500/15 text-violet-300' :
              'bg-white/10 text-white/50',
            )}
          >
            {tier === 'af_commissioner' ? 'AF Commissioner' : tier === 'af_pro' ? 'AF Pro' : 'Free'}
          </span>
        </div>

        {tier === 'free' && (
          <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3">
            <p className="text-xs text-amber-300">
              Upgrade to AF Pro for personal AI features or AF Commissioner for league-wide AI tools.
            </p>
          </div>
        )}
      </div>

      {/* AI Pro Features */}
      <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--panel2)' }}>
        <p className="mb-1 text-sm font-semibold text-violet-300">AF Pro Features</p>
        <p className="mb-4 text-xs" style={{ color: 'var(--muted)' }}>Personal AI tools for your teams</p>

        {categories.map((cat) => {
          const catToggles = AI_TOGGLES.filter((t) => t.category === cat && t.tier === 'af_pro')
          if (catToggles.length === 0) return null
          const catInfo = CATEGORY_LABELS[cat]
          return (
            <div key={cat} className="mb-4 last:mb-0">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted2)' }}>
                {catInfo?.icon} {catInfo?.label}
              </p>
              {catToggles.map((toggle) => {
                const hasAccess = tier === 'af_pro' || tier === 'af_commissioner'
                return (
                  <AIToggleRow
                    key={toggle.id}
                    toggle={toggle}
                    enabled={toggles[toggle.id] ?? true}
                    hasAccess={hasAccess}
                    onToggle={(v) => handleToggle(toggle.id, v)}
                  />
                )
              })}
            </div>
          )
        })}
      </div>

      {/* AF Commissioner Features */}
      <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--panel2)' }}>
        <p className="mb-1 text-sm font-semibold text-purple-300">AF Commissioner Features</p>
        <p className="mb-4 text-xs" style={{ color: 'var(--muted)' }}>League-wide AI tools for commissioners</p>

        {categories.map((cat) => {
          const catToggles = AI_TOGGLES.filter((t) => t.category === cat && t.tier === 'af_commissioner')
          if (catToggles.length === 0) return null
          const catInfo = CATEGORY_LABELS[cat]
          return (
            <div key={cat} className="mb-4 last:mb-0">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted2)' }}>
                {catInfo?.icon} {catInfo?.label}
              </p>
              {catToggles.map((toggle) => {
                const hasAccess = tier === 'af_commissioner'
                return (
                  <AIToggleRow
                    key={toggle.id}
                    toggle={toggle}
                    enabled={toggles[toggle.id] ?? true}
                    hasAccess={hasAccess}
                    onToggle={(v) => handleToggle(toggle.id, v)}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AIToggleRow({
  toggle,
  enabled,
  hasAccess,
  onToggle,
}: {
  toggle: AIToggle
  enabled: boolean
  hasAccess: boolean
  onToggle: (v: boolean) => void
}) {
  return (
    <div
      className={clsx(
        'flex items-center justify-between gap-4 border-b py-2.5 last:border-0',
        !hasAccess && 'opacity-50',
      )}
      style={{ borderColor: 'var(--border-subtle, rgba(255,255,255,0.05))' }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm" style={{ color: 'var(--text)' }}>{toggle.label}</span>
          {!hasAccess && <span className="text-[9px] font-bold text-amber-300">🔒 {toggle.tier === 'af_pro' ? 'PRO' : 'COMMISSIONER'}</span>}
        </div>
        <p className="text-[11px]" style={{ color: 'var(--muted)' }}>{toggle.description}</p>
      </div>
      <label className="relative inline-flex shrink-0 cursor-pointer items-center">
        <input
          type="checkbox"
          checked={hasAccess ? enabled : false}
          onChange={(e) => hasAccess && onToggle(e.target.checked)}
          disabled={!hasAccess}
          className="peer sr-only"
        />
        <div className="peer h-5 w-9 rounded-full bg-white/10 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white/40 after:transition-all peer-checked:bg-violet-500/50 peer-checked:after:translate-x-full peer-checked:after:bg-violet-200 peer-disabled:cursor-not-allowed peer-disabled:opacity-40" />
      </label>
    </div>
  )
}
