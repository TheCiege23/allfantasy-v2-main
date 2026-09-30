'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { Sparkles, MessageSquare, HelpCircle, Loader2, AlertCircle } from 'lucide-react'
import type { SurvivorSummary } from './types'
import { SurvivorCommandHelp } from './SurvivorCommandHelp'
import { useAfSubGate } from '@/hooks/useAfSubGate'
import { postWithTokenConfirm } from '@/lib/tokens/clientTokenConfirm'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'

type SurvivorAIPanelType =
  | 'host_intro'
  | 'host_challenge'
  | 'host_merge'
  | 'host_council'
  | 'host_scroll'
  | 'host_jury'
  | 'tribe_help'
  | 'idol_help'
  | 'tribal_help'
  | 'exile_help'
  | 'bestball_help'

const TYPE_LABELS: Record<SurvivorAIPanelType, string> = {
  host_intro: 'Host: Intro post',
  host_challenge: 'Host: Challenge announcement',
  host_merge: 'Host: Merge announcement',
  host_council: 'Host: Tribal Council narration',
  host_scroll: 'Host: Scroll reveal wording',
  host_jury: 'Host: Jury / finale moderation',
  tribe_help: 'Helper: Tribe strategy & challenge coaching',
  idol_help: 'Helper: Idol & power advice',
  tribal_help: 'Helper: Tribal risk & vote exposure',
  exile_help: 'Helper: Exile strategy',
  bestball_help: 'Helper: Bestball tribe score & jury',
}

const HOST_TYPES: SurvivorAIPanelType[] = [
  'host_intro',
  'host_challenge',
  'host_merge',
  'host_council',
  'host_scroll',
  'host_jury',
]
const HELPER_TYPES: SurvivorAIPanelType[] = [
  'tribe_help',
  'idol_help',
  'tribal_help',
  'exile_help',
  'bestball_help',
]

/** Matches `/api/.../survivor/ai` — intro, scroll, and idol advice are not subscription-gated. */
const UNGATED_SURVIVOR_AI_TYPES: SurvivorAIPanelType[] = ['host_intro', 'host_scroll', 'idol_help']

function subscriptionFeatureForSurvivorAiType(t: SurvivorAIPanelType): SubscriptionFeatureId | null {
  if (UNGATED_SURVIVOR_AI_TYPES.includes(t)) return null
  if (['host_challenge', 'host_merge', 'host_council', 'host_jury'].includes(t)) {
    return 'commissioner_ai_narration'
  }
  return 'ai_chat'
}

export interface SurvivorAIPanelProps {
  leagueId: string
  summary: SurvivorSummary
  names: Record<string, string>
}

/**
 * AI Survivor Panel: Host posts, helper strategy, ask Chimmy. PROMPT 348.
 */
export function SurvivorAIPanel({ leagueId, summary }: SurvivorAIPanelProps) {
  const [type, setType] = useState<SurvivorAIPanelType>('tribe_help')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    deterministic: unknown
    narrative: string
    type: string
  } | null>(null)
  const { handleApiResponse } = useAfSubGate('ai_chat')

  const chatHref = summary.myTribeSource
    ? `/league/${leagueId}?tab=Chat&source=${encodeURIComponent(summary.myTribeSource)}`
    : `/league/${leagueId}?tab=Chat`

  const aiSubFeature = subscriptionFeatureForSurvivorAiType(type)

  const runAI = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      /*
       * 🛑 THIS PANEL COULD NEVER SPEND A TOKEN (fixed 2026-09-29). It posted without
       * `confirmTokenSpend`, the route defaults that to false, and the guard answers 409
       * `token_confirmation_required` — which `useAfSubGate` (402/403 only) let through as an error.
       * A user paying in tokens got an error on every gated action. Now the 409 becomes a question
       * that names the cost, and only a yes spends.
       */
      const { response: res, declined } = await postWithTokenConfirm(
        `/api/leagues/${encodeURIComponent(leagueId)}/survivor/ai`,
        { type, week: summary.currentWeek },
      )
      if (declined) return
      const subFeature = subscriptionFeatureForSurvivorAiType(type)
      if (subFeature) {
        if (!(await handleApiResponse(res, subFeature))) return
      } else if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        setError(
          typeof errBody.message === 'string'
            ? errBody.message
            : typeof errBody.error === 'string'
              ? errBody.error
              : `Error ${res.status}`,
        )
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.message ?? data.error ?? `Error ${res.status}`)
        return
      }
      setResult({
        deterministic: data.deterministic,
        narrative: data.narrative ?? '',
        type: data.type ?? type,
      })
    } catch {
      setError('Request failed')
    } finally {
      setLoading(false)
    }
  }, [handleApiResponse, leagueId, type, summary.currentWeek])

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-amber-500/20 bg-amber-950/10 p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Sparkles className="h-5 w-5 text-amber-400" />
          Host · Chimmy
        </h2>
        <p className="mb-4 text-sm text-white/70">
          Generate host posts or get strategy advice. Outcomes (elimination, votes, idols, immunity, exile return) are always decided by the game engine — Chimmy only narrates and advises.
        </p>

        <div className="mb-4">
          <label className="mb-2 block text-xs font-medium text-white/60">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as SurvivorAIPanelType)}
            className="w-full rounded-xl border border-white/20 bg-white/5 py-2 pl-3 pr-8 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          >
            <optgroup label="Host">
              {HOST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </optgroup>
            <optgroup label="Helper">
              {HELPER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        <p className="mb-3 text-[11px] leading-relaxed text-white/45">
          {aiSubFeature === null
            ? 'Intro, scroll, and idol coaching are included for all managers. The game engine still decides votes, idols, and elimination.'
            : aiSubFeature === 'commissioner_ai_narration'
              ? 'Host narration for commissioners uses Commissioner AI. Co-commissioners can use it too.'
              : 'Strategy helpers use your Chimmy subscription.'}
        </p>

        <button
          type="button"
          onClick={runAI}
          disabled={loading}
          className="mb-3 inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-2 text-sm text-amber-200 hover:bg-amber-950/50 disabled:opacity-50"
          data-testid="survivor-ai-generate-button"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Generate
        </button>

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-950/20 px-3 py-2 text-sm text-rose-200">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {result && (
          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
            <p className="whitespace-pre-wrap text-sm text-white/90">{result.narrative}</p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-white">
          <MessageSquare className="h-5 w-5 text-cyan-400" />
          Ask Chimmy in Chat
        </h2>
        <p className="mb-3 text-sm text-white/70">
          In league or tribe chat, ask for strategy, challenge tips, tribal risk, exile strategy, or recaps. Pass your league so Chimmy gets Survivor context. Command suggestions never bypass validation — the engine processes votes and idols.
        </p>
        <Link
          href={chatHref}
          className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-2 text-sm text-amber-200 hover:bg-amber-950/50"
        >
          <MessageSquare className="h-4 w-4" /> Open Chat
        </Link>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-white">
          <HelpCircle className="h-5 w-5 text-cyan-400" />
          What you can ask Chimmy
        </h2>
        <ul className="mb-4 space-y-1 text-sm text-white/70">
          <li>· Tribe strategy and who might be at risk</li>
          <li>· Challenge coaching and submission tips</li>
          <li>· Tribal Council risk explanation</li>
          <li>· Exile Island strategy and token advice</li>
          <li>· Recap and storyline summary</li>
        </ul>
        <SurvivorCommandHelp compact />
      </section>

      <Link
        href={`/league/${leagueId}?tab=Intelligence`}
        className="block rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/80 hover:bg-white/10"
      >
        Full AI Tools (Intelligence tab) →
      </Link>
    </div>
  )
}
