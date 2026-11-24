'use client'

/**
 * IDP scoring style card for league home. Explains balanced vs tackle-heavy vs big-play-heavy.
 */

import { useState } from 'react'
import { Shield, BookOpen, MessageSquare } from 'lucide-react'
import { IDP_SCORING_PRESET_LABELS } from '@/lib/idp/IDPScoringPresets'

const SCORING_TIPS: Record<string, string> = {
  balanced: 'Tackles, sacks, and turnovers all matter. Every-down LBs and versatile DBs have strong value.',
  tackle_heavy: 'Solo and assist tackles dominate. Prioritize high-snap LBs and safeties with tackle volume.',
  big_play_heavy: 'Sacks, INTs, and TDs spike value. Edge rushers and ball-hawking DBs get a premium.',
}

interface IdpConfig {
  scoringPreset: string
  positionMode?: string
  rosterPreset?: string
}

interface Props {
  leagueId: string
  config: IdpConfig | null
  loading?: boolean
  onAskChimmy?: () => void
}

export function IdpScoringStyleCard({ leagueId, config, loading, onAskChimmy }: Props) {
  const [educatorOpen, setEducatorOpen] = useState(false)
  const [narrative, setNarrative] = useState<string | null>(null)
  const [loadingNarrative, setLoadingNarrative] = useState(false)

  const fetchEducator = async () => {
    setLoadingNarrative(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/idp/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'league_educator' }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.narrative) setNarrative(data.narrative)
      setEducatorOpen(true)
    } finally {
      setLoadingNarrative(false)
    }
  }

  if (loading) return <div className="rounded-xl border border-[var(--line)] bg-[var(--chip)] p-4 text-sm text-[var(--muted)]">Loading IDP settings…</div>
  if (!config) return null

  const label = IDP_SCORING_PRESET_LABELS[config.scoringPreset] ?? config.scoringPreset
  const tip = SCORING_TIPS[config.scoringPreset] ?? SCORING_TIPS.balanced

  return (
    <div className="rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)] p-4">
      <div className="flex items-center gap-2 text-[var(--accent)]">
        <Shield className="h-5 w-5 shrink-0" />
        <h3 className="font-medium">IDP scoring: {label}</h3>
      </div>
      <p className="mt-2 text-sm text-[var(--text)]">{tip}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={fetchEducator}
          disabled={loadingNarrative}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--chip)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--chip)]"
        >
          <BookOpen className="h-3.5 w-3.5" />
          {loadingNarrative ? 'Loading…' : 'Learn more'}
        </button>
        {onAskChimmy && (
          <button
            type="button"
            onClick={onAskChimmy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line2)] bg-[var(--warn-soft)] px-3 py-1.5 text-xs font-medium text-[var(--warn)] hover:bg-[var(--warn-soft)]"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Ask Chimmy about IDP
          </button>
        )}
      </div>
      {educatorOpen && narrative && (
        <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-3 text-sm text-[var(--text)]">
          {narrative}
          <button
            type="button"
            onClick={() => setEducatorOpen(false)}
            className="mt-2 text-xs text-[var(--accent)] hover:underline"
          >
            Close
          </button>
        </div>
      )}
    </div>
  )
}
