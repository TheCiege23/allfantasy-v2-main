'use client'

import { CheckCircle2, Lock } from 'lucide-react'
import Link from 'next/link'
import clsx from 'clsx'
import { useEntitlements } from '@/hooks/useEntitlements'

// ─── Feature catalogue ───────────────────────────────────────────────────────

type AIFeature = {
  id: string
  label: string
  description: string
  tier: 'af_pro' | 'af_commissioner'
  category: 'draft' | 'roster' | 'trade' | 'social' | 'content' | 'assistant'
}

const AI_FEATURES: AIFeature[] = [
  // ── AF Pro
  { id: 'ai_draft_helper',      label: 'Draft Helper',        description: 'AI player recommendations during draft',                  tier: 'af_pro',          category: 'draft'     },
  { id: 'ai_autopick',          label: 'AI Autopick',         description: 'Intelligent autopick when away from draft',               tier: 'af_pro',          category: 'draft'     },
  { id: 'ai_queue_builder',     label: 'Queue Builder',       description: 'AI-suggested draft queue order',                          tier: 'af_pro',          category: 'draft'     },
  { id: 'ai_start_sit',         label: 'Start/Sit Advisor',   description: 'Weekly lineup recommendations',                           tier: 'af_pro',          category: 'roster'    },
  { id: 'ai_lineup_optimizer',  label: 'Lineup Optimizer',    description: 'Optimal lineup based on matchups + projections',          tier: 'af_pro',          category: 'roster'    },
  { id: 'ai_waiver_assistant',  label: 'Waiver Assistant',    description: 'Best waiver adds and drop suggestions',                   tier: 'af_pro',          category: 'roster'    },
  { id: 'ai_trade_analyzer',    label: 'Trade Analyzer',      description: 'AI trade fairness evaluation + counteroffers',            tier: 'af_pro',          category: 'trade'     },
  { id: 'ai_matchup_insights',  label: 'Matchup Insights',    description: 'Win probability and key player analysis',                 tier: 'af_pro',          category: 'roster'    },
  { id: 'ai_player_insights',   label: 'Player Insights',     description: 'Performance trends and advanced stats',                   tier: 'af_pro',          category: 'roster'    },
  { id: 'ai_chimmy_advanced',   label: 'Chimmy Advanced Mode',description: 'Full AI assistant with deep analysis',                    tier: 'af_pro',          category: 'assistant' },
  // ── AF Commissioner
  { id: 'ai_draft_grade',       label: 'Draft Grades',        description: 'Post-draft AI analysis and grades',                      tier: 'af_commissioner', category: 'draft'     },
  { id: 'ai_managers',          label: 'AI Managers',         description: 'Up to 4 AI-controlled teams for drafts + orphan teams',  tier: 'af_commissioner', category: 'draft'     },
  { id: 'ai_power_rankings',    label: 'Power Rankings',      description: 'AI-generated weekly league power rankings',               tier: 'af_commissioner', category: 'content'   },
  { id: 'ai_weekly_recap',      label: 'Weekly Recaps',       description: 'AI-generated matchup recaps and storylines',              tier: 'af_commissioner', category: 'content'   },
  { id: 'ai_league_storyteller',label: 'League Storyteller',  description: 'Narrative-driven league updates',                        tier: 'af_commissioner', category: 'content'   },
  { id: 'ai_social_content',    label: 'Social Content',      description: 'AI-generated shareable posts and recap cards',            tier: 'af_commissioner', category: 'content'   },
  { id: 'ai_commissioner_tools',label: 'Commissioner AI Tools',description: 'Inactive detection, rule suggestions, dispute help',    tier: 'af_commissioner', category: 'social'    },
  { id: 'ai_collusion_detection',label: 'Collusion Detection',description: 'AI-flagged suspicious trades and behavior',               tier: 'af_commissioner', category: 'social'    },
]

const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  draft:     { label: 'Draft',               icon: '📋' },
  roster:    { label: 'Roster & Lineup',      icon: '📊' },
  trade:     { label: 'Trades',              icon: '🔄' },
  social:    { label: 'Social & Moderation', icon: '🛡️' },
  content:   { label: 'Content & Recaps',    icon: '📝' },
  assistant: { label: 'AI Assistant',        icon: '🤖' },
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AISettingsSection() {
  const ents = useEntitlements()

  if (ents.loading) {
    return (
      <div
        className="animate-pulse h-32 rounded-xl"
        style={{ background: 'var(--panel2)' }}
        aria-label="Loading AI features…"
      />
    )
  }

  // Derive access flags from real entitlement data
  const hasProFeatures         = ents.hasPro || ents.hasCommissioner || ents.hasAllAccess || ents.hasSupreme
  const hasCommissionerFeatures = ents.hasCommissioner || ents.hasAllAccess || ents.hasSupreme

  const tierBadge = ents.hasSupreme
    ? { label: 'AF Supreme',      cls: 'bg-yellow-500/15 text-yellow-300' }
    : ents.hasAllAccess
      ? { label: 'AF All-Access', cls: 'bg-cyan-500/15 text-cyan-300' }
      : ents.hasCommissioner
        ? { label: 'AF Commissioner', cls: 'bg-purple-500/15 text-purple-300' }
        : ents.hasPro
          ? { label: 'AF Pro',    cls: 'bg-sky-500/15 text-sky-300' }
          : { label: 'Free',      cls: 'bg-white/10 text-white/50' }

  const categories = [...new Set(AI_FEATURES.map((f) => f.category))]

  return (
    <div className="space-y-6">

      {/* ── Header card ──────────────────────────────────────────────────── */}
      <div
        className="rounded-xl border p-4"
        style={{ borderColor: 'var(--border)', background: 'var(--panel2)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>AI Features</p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
              AI features activate automatically based on your subscription plan.
              No manual configuration required.
            </p>
          </div>
          <span className={clsx('shrink-0 rounded-lg px-3 py-1 text-[11px] font-bold', tierBadge.cls)}>
            {tierBadge.label}
          </span>
        </div>

        {!ents.hasAnyPaid && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3">
            <p className="text-xs text-amber-300">
              Upgrade to AF Pro for personal AI features, or AF Commissioner for league-wide AI tools.
            </p>
            <Link
              href="/pricing"
              className="shrink-0 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/30"
            >
              View plans →
            </Link>
          </div>
        )}
      </div>

      {/* ── AF Pro Features ──────────────────────────────────────────────── */}
      <div
        className="rounded-xl border p-4"
        style={{ borderColor: 'var(--border)', background: 'var(--panel2)' }}
      >
        <p className="mb-0.5 text-sm font-semibold text-cyan-300">AF Pro Features</p>
        <p className="mb-4 text-xs" style={{ color: 'var(--muted)' }}>Personal AI tools for your teams</p>

        {categories.map((cat) => {
          const items = AI_FEATURES.filter((f) => f.category === cat && f.tier === 'af_pro')
          if (items.length === 0) return null
          const meta = CATEGORY_LABELS[cat]
          return (
            <div key={cat} className="mb-4 last:mb-0">
              <p
                className="mb-2 text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--muted2)' }}
              >
                {meta?.icon} {meta?.label}
              </p>
              {items.map((feature) => (
                <AIFeatureRow key={feature.id} feature={feature} unlocked={hasProFeatures} />
              ))}
            </div>
          )
        })}
      </div>

      {/* ── AF Commissioner Features ─────────────────────────────────────── */}
      <div
        className="rounded-xl border p-4"
        style={{ borderColor: 'var(--border)', background: 'var(--panel2)' }}
      >
        <p className="mb-0.5 text-sm font-semibold text-purple-300">AF Commissioner Features</p>
        <p className="mb-4 text-xs" style={{ color: 'var(--muted)' }}>League-wide AI tools for commissioners</p>

        {categories.map((cat) => {
          const items = AI_FEATURES.filter((f) => f.category === cat && f.tier === 'af_commissioner')
          if (items.length === 0) return null
          const meta = CATEGORY_LABELS[cat]
          return (
            <div key={cat} className="mb-4 last:mb-0">
              <p
                className="mb-2 text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--muted2)' }}
              >
                {meta?.icon} {meta?.label}
              </p>
              {items.map((feature) => (
                <AIFeatureRow key={feature.id} feature={feature} unlocked={hasCommissionerFeatures} />
              ))}
            </div>
          )
        })}
      </div>

    </div>
  )
}

// ─── Row component ────────────────────────────────────────────────────────────

function AIFeatureRow({
  feature,
  unlocked,
}: {
  feature: AIFeature
  unlocked: boolean
}) {
  return (
    <div
      className={clsx(
        'flex items-center justify-between gap-4 border-b py-2.5 last:border-0',
        !unlocked && 'opacity-50',
      )}
      style={{ borderColor: 'var(--border-subtle, rgba(255,255,255,0.05))' }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm" style={{ color: 'var(--text)' }}>{feature.label}</span>
          {!unlocked && (
            <span className="text-[9px] font-bold text-amber-300">
              🔒 {feature.tier === 'af_pro' ? 'PRO' : 'COMMISSIONER'}
            </span>
          )}
        </div>
        <p className="text-[11px]" style={{ color: 'var(--muted)' }}>{feature.description}</p>
      </div>

      {/* Status indicator — no interactive toggle; features are plan-managed */}
      {unlocked ? (
        <CheckCircle2
          className="h-4 w-4 shrink-0 text-emerald-400"
          aria-label="Included in your plan"
        />
      ) : (
        <Lock
          className="h-4 w-4 shrink-0 text-white/20"
          aria-label="Requires plan upgrade"
        />
      )}
    </div>
  )
}
