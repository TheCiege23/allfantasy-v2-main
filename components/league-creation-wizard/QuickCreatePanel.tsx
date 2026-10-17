'use client'

import { useState } from 'react'
import clsx from 'clsx'
import type { LeagueCreationWizardState, LeagueTypeId, DraftTypeId } from '@/lib/league-creation-wizard/types'

/**
 * Quick Create Panel — AI-powered league setup.
 *
 * Two modes:
 * 1. Quick Create buttons — one-click presets for common league types
 * 2. AI Prompt Box — describe what you want, AI configures everything
 *
 * The AI prompt is gated behind AF Commissioner subscription.
 * Quick Create presets are available to all users.
 */

type QuickCreatePreset = {
  id: string
  label: string
  emoji: string
  description: string
  sport: string
  leagueType: LeagueTypeId
  draftType: DraftTypeId
  teamCount: number
  color: string
}

const QUICK_PRESETS: QuickCreatePreset[] = [
  {
    id: 'nfl_redraft',
    label: 'NFL Redraft',
    emoji: '🏈',
    description: '12-team PPR snake draft',
    sport: 'NFL',
    leagueType: 'redraft',
    draftType: 'snake',
    teamCount: 12,
    color: 'border-cyan-400/30 bg-cyan-400/[0.04]',
  },
  {
    id: 'nfl_dynasty',
    label: 'NFL Dynasty',
    emoji: '👑',
    description: '12-team dynasty with taxi + rookie draft',
    sport: 'NFL',
    leagueType: 'dynasty',
    draftType: 'snake',
    teamCount: 12,
    color: 'border-purple-400/30 bg-purple-400/[0.04]',
  },
  {
    id: 'nfl_survivor',
    label: 'NFL Survivor',
    emoji: '🏝️',
    description: '16-team Survivor with tribes + idols',
    sport: 'NFL',
    leagueType: 'survivor',
    draftType: 'snake',
    teamCount: 16,
    color: 'border-amber-400/30 bg-amber-400/[0.04]',
  },
  {
    id: 'nba_redraft',
    label: 'NBA Redraft',
    emoji: '🏀',
    description: '10-team daily points league',
    sport: 'NBA',
    leagueType: 'redraft',
    draftType: 'snake',
    teamCount: 10,
    color: 'border-orange-400/30 bg-orange-400/[0.04]',
  },
  {
    id: 'nfl_bestball',
    label: 'NFL Best Ball',
    emoji: '🎯',
    description: '12-team best ball — no lineups',
    sport: 'NFL',
    leagueType: 'best_ball',
    draftType: 'snake',
    teamCount: 12,
    color: 'border-emerald-400/30 bg-emerald-400/[0.04]',
  },
  {
    id: 'nfl_guillotine',
    label: 'NFL Guillotine',
    emoji: '🔪',
    description: '17-team elimination league',
    sport: 'NFL',
    leagueType: 'guillotine',
    draftType: 'snake',
    teamCount: 17,
    color: 'border-red-400/30 bg-red-400/[0.04]',
  },
]

type AIPromptResult = {
  sport: string
  leagueType: LeagueTypeId
  draftType: DraftTypeId
  teamCount: number
  leagueName: string
  scoringFormat: string
  explanation: string
}

export function QuickCreatePanel({
  onApplyPreset,
  onApplyAIResult,
  hasAIAccess,
}: {
  onApplyPreset: (preset: QuickCreatePreset) => void
  onApplyAIResult: (result: AIPromptResult) => void
  hasAIAccess: boolean
}) {
  const [mode, setMode] = useState<'collapsed' | 'presets' | 'ai_prompt'>('collapsed')
  const [prompt, setPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<AIPromptResult | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  async function handleAIGenerate() {
    if (!prompt.trim()) return
    setAiLoading(true)
    setAiError(null)
    setAiResult(null)

    try {
      const res = await fetch('/api/league/ai-quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ prompt: prompt.trim() }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        setAiError((err as { error?: string }).error ?? 'AI setup failed')
        return
      }

      const data = (await res.json()) as { result: AIPromptResult }
      setAiResult(data.result)
    } catch {
      setAiError('Could not connect to AI. Try again.')
    } finally {
      setAiLoading(false)
    }
  }

  if (mode === 'collapsed') {
    return (
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setMode('presets')}
          className="flex-1 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] px-4 py-3 text-left transition hover:bg-cyan-400/[0.08]"
        >
          <p className="text-[13px] font-semibold text-cyan-300">Quick Create</p>
          <p className="mt-0.5 text-[11px] text-white/40">One-click league presets</p>
        </button>
        <button
          type="button"
          onClick={() => setMode('ai_prompt')}
          className={clsx(
            'flex-1 rounded-xl border px-4 py-3 text-left transition',
            hasAIAccess
              ? 'border-purple-400/20 bg-purple-400/[0.04] hover:bg-purple-400/[0.08]'
              : 'border-white/10 bg-white/[0.02] opacity-60',
          )}
        >
          <p className="text-[13px] font-semibold text-purple-300">
            AI Setup {!hasAIAccess && '🔒'}
          </p>
          <p className="mt-0.5 text-[11px] text-white/40">
            {hasAIAccess ? 'Describe your league, AI builds it' : 'Requires AF Commissioner'}
          </p>
        </button>
      </div>
    )
  }

  return (
    <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      {/* Header with back */}
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] font-semibold text-white">
          {mode === 'presets' ? '⚡ Quick Create' : '🤖 AI League Setup'}
        </p>
        <button
          type="button"
          onClick={() => { setMode('collapsed'); setAiResult(null); setAiError(null) }}
          className="text-[11px] text-white/40 hover:text-white/60"
        >
          Back to wizard
        </button>
      </div>

      {/* Quick Create Presets */}
      {mode === 'presets' && (
        <div className="grid gap-2 sm:grid-cols-2">
          {QUICK_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApplyPreset(preset)}
              className={clsx(
                'rounded-xl border px-3 py-3 text-left transition hover:scale-[1.01]',
                preset.color,
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">{preset.emoji}</span>
                <div>
                  <p className="text-[13px] font-semibold text-white">{preset.label}</p>
                  <p className="text-[11px] text-white/50">{preset.description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* AI Prompt Mode */}
      {mode === 'ai_prompt' && (
        <div className="space-y-3">
          {!hasAIAccess ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4 text-center">
              <p className="text-[13px] font-semibold text-amber-300">AF Commissioner Required</p>
              <p className="mt-1 text-[11px] text-white/50">
                Upgrade to AF Commissioner to let Chimmy set up your league automatically.
              </p>
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-[11px] text-white/50">
                  Describe your ideal league and Chimmy will configure it
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Example: I want a 10-team NFL dynasty league with superflex, IDP, and salary cap. Snake draft with 25 rounds. PPR scoring. 4 taxi slots."
                  rows={3}
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-purple-400/50"
                />
              </div>

              <button
                type="button"
                disabled={aiLoading || !prompt.trim()}
                onClick={() => void handleAIGenerate()}
                className="w-full rounded-xl bg-purple-500/20 px-4 py-2.5 text-[13px] font-semibold text-purple-200 transition hover:bg-purple-500/30 disabled:opacity-40"
              >
                {aiLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-purple-300 border-t-transparent" />
                    Chimmy is building your league...
                  </span>
                ) : (
                  '🤖 Generate League Settings'
                )}
              </button>

              {aiError && (
                <p className="text-[11px] text-red-400">{aiError}</p>
              )}

              {aiResult && (
                <div className="rounded-xl border border-purple-400/20 bg-purple-400/[0.04] p-4">
                  <p className="text-[12px] font-semibold text-purple-200">Chimmy suggests:</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                    <div><span className="text-white/40">Sport:</span> <span className="text-white">{aiResult.sport}</span></div>
                    <div><span className="text-white/40">Type:</span> <span className="text-white">{aiResult.leagueType}</span></div>
                    <div><span className="text-white/40">Draft:</span> <span className="text-white">{aiResult.draftType}</span></div>
                    <div><span className="text-white/40">Teams:</span> <span className="text-white">{aiResult.teamCount}</span></div>
                    <div><span className="text-white/40">Scoring:</span> <span className="text-white">{aiResult.scoringFormat}</span></div>
                    <div><span className="text-white/40">Name:</span> <span className="text-white">{aiResult.leagueName}</span></div>
                  </div>
                  <p className="mt-2 text-[11px] text-white/50">{aiResult.explanation}</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => onApplyAIResult(aiResult)}
                      className="flex-1 rounded-lg bg-purple-500/25 px-3 py-2 text-[12px] font-semibold text-purple-200 transition hover:bg-purple-500/35"
                    >
                      Apply & Continue
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAiResult(null); setPrompt('') }}
                      className="rounded-lg border border-white/10 px-3 py-2 text-[12px] text-white/50"
                    >
                      Try Again
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
