'use client'

/**
 * Waiver targets + Chimmy AI list via POST /api/idp/ai waiver_targets.
 */

import { useState } from 'react'
import { useAfSubGate } from '@/hooks/useAfSubGate'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { IDPWaiverTarget } from '@/lib/idp/ai/idpChimmy'

export function IDPWaiverSection({ leagueId, week }: { leagueId: string; week: number }) {
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [targets, setTargets] = useState<IDPWaiverTarget[] | null>(null)
  const { handleApiResponse } = useAfSubGate('commissioner_idp_analysis')

  const loadAi = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/idp/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ leagueId, week, action: 'waiver_targets', limit: 5 }),
      })
      if (!(await handleApiResponse(res))) return
      const data = (await res.json().catch(() => [])) as IDPWaiverTarget[]
      if (Array.isArray(data)) {
        setTargets(data)
        setLoaded(true)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Waiver wire</h3>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => void loadAi()}
          className="gap-1.5 border-cyan-500/30 text-cyan-100 hover:bg-cyan-950/40"
          data-testid="idp-waiver-ai-targets"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {loading ? 'Loading…' : 'AI Targets'}
        </Button>
      </div>
      {targets?.length ? (
        <ul className="mt-3 space-y-2 text-sm" data-testid="idp-waiver-targets">
          {targets.map((t) => (
            <li key={`${t.rank}-${t.name}`} className="rounded-lg border border-white/8 bg-black/15 px-3 py-2">
              <span className="font-medium text-white">
                {t.rank}. {t.name} ({t.position}
                {t.team ? `, ${t.team}` : ''})
              </span>
              <p className="mt-1 text-xs text-white/70">{t.reasoning}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-white/60" data-testid="idp-waiver-empty">
          {loaded
            ? 'No IDP waiver targets stood out this week.'
            : 'Tap AI Targets for personalized IDP waiver ideas from Chimmy.'}
        </p>
      )}
    </div>
  )
}
