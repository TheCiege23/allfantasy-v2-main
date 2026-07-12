'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Sparkles, X, Check, Edit3 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { normalizeLegacyManualCreateBody } from '@/lib/league-creation/normalizeCreateLeaguePayload'
import { trackMetaEventsFromResponse } from '@/lib/meta-client'

type QuickCreateSettings = {
  name: string
  sport: string
  leagueType: string
  draftType: string
  teamCount: number
  scoring: string
  isDynasty: boolean
  isSuperflex: boolean
  tradeReviewMode: string
  waiverType: string
  playoffTeams: number
  regularSeasonWeeks: number
  summary: string
}

const EXAMPLE_PROMPTS = [
  '12-team NFL PPR redraft league with FAAB waivers',
  'Casual 10-team NBA dynasty league for beginners',
  'Competitive 14-team NFL superflex with IDP',
  '8-team MLB best ball league, keep it simple',
  '20-player NFL survivor league with 4 tribes',
  '16-team keeper league, 3 keepers, snake draft',
]

export function QuickCreateModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [preferences, setPreferences] = useState('')
  const [loading, setLoading] = useState(false)
  const [settings, setSettings] = useState<QuickCreateSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  async function generate() {
    if (!preferences.trim()) return
    setLoading(true)
    setError(null)
    setSettings(null)
    try {
      const res = await fetch('/api/league/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error ?? 'Failed to generate')
        return
      }
      const data = await res.json()
      setSettings(data.settings)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  async function createLeague() {
    if (!settings) return
    setCreating(true)
    setError(null)
    try {
      const normalized = normalizeLegacyManualCreateBody({
        name: settings.name,
        sport: settings.sport,
        leagueType: settings.leagueType,
        draftType: settings.draftType,
        leagueSize: settings.teamCount,
        scoring: settings.scoring,
        isDynasty: settings.isDynasty,
        isSuperflex: settings.isSuperflex,
        platform: 'manual',
        settings: {
          trade_review_mode: settings.tradeReviewMode,
          waiver_type: settings.waiverType,
          playoff_teams: settings.playoffTeams,
          regular_season_weeks: settings.regularSeasonWeeks,
        },
      })
      if (process.env.NODE_ENV === 'development') {
        // Safe summary: no auth tokens; league name is user-visible in UI already.
        console.info('[quick-create] normalized create body', {
          sport: normalized.sport,
          leagueType: normalized.leagueType,
          draftType: normalized.draftType,
          leagueSize: normalized.leagueSize,
          scoring: normalized.scoring,
          isDynasty: normalized.isDynasty,
          leagueVariant: normalized.leagueVariant ?? null,
          hasScoringPresetId: Boolean(normalized.scoringPresetId),
        })
      }
      const res = await fetch('/api/league/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: normalized.name,
          sport: normalized.sport,
          leagueType: normalized.leagueType,
          draftType: normalized.draftType,
          leagueSize: normalized.leagueSize,
          scoring: normalized.scoring,
          isDynasty: normalized.isDynasty,
          isSuperflex: normalized.isSuperflex,
          ...(normalized.leagueVariant ? { leagueVariant: normalized.leagueVariant } : {}),
          ...(normalized.scoringPresetId ? { scoringPresetId: normalized.scoringPresetId } : {}),
          platform: normalized.platform,
          settings: normalized.settings,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error ?? 'Failed to create league')
        return
      }
      const data = await res.json()
      trackMetaEventsFromResponse(data)
      const leagueId = data.leagueId ?? data.id ?? data.league?.id
      onClose()
      if (leagueId) {
        router.push(`/league/${leagueId}`)
      } else {
        router.push('/dashboard')
      }
    } catch {
      setError('Network error')
    } finally {
      setCreating(false)
    }
  }

  function reset() {
    setSettings(null)
    setError(null)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[min(90vh,700px)] max-w-lg overflow-y-auto border border-white/10 bg-[#0a1220] text-white sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Sparkles className="h-5 w-5 text-cyan-400" />
            Guided Quick Create
          </DialogTitle>
        </DialogHeader>

        {!settings ? (
          <div className="space-y-4">
            <p className="text-xs text-white/50">
              Describe the league you want and Coach will prepare settings for your review.
            </p>

            <textarea
              value={preferences}
              onChange={(e) => setPreferences(e.target.value)}
              placeholder="e.g. 12-team NFL PPR redraft league with FAAB waivers and 6-team playoffs"
              className="h-24 w-full resize-none rounded-xl border border-white/[0.12] bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-cyan-500/40 focus:outline-none"
            />

            <div className="flex flex-wrap gap-1.5">
              {EXAMPLE_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPreferences(p)}
                  className="rounded-lg bg-white/[0.04] px-2 py-1 text-[10px] text-white/40 transition hover:bg-white/[0.08] hover:text-white/60"
                >
                  {p}
                </button>
              ))}
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              type="button"
              onClick={generate}
              disabled={loading || !preferences.trim()}
              className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-purple-500 py-3 text-[13px] font-bold text-black transition hover:opacity-90 disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating settings...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Sparkles className="h-4 w-4" /> Generate League
                </span>
              )}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Guided settings summary */}
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3">
              <p className="text-[13px] text-cyan-100">{settings.summary}</p>
            </div>

            {/* Settings Preview */}
            <div className="space-y-1 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
              <SettingRow label="Name" value={settings.name} />
              <SettingRow label="Sport" value={settings.sport} />
              <SettingRow label="Type" value={settings.leagueType} />
              <SettingRow label="Draft" value={settings.draftType} />
              <SettingRow label="Teams" value={String(settings.teamCount)} />
              <SettingRow label="Scoring" value={settings.scoring} />
              <SettingRow label="Waivers" value={settings.waiverType} />
              <SettingRow label="Trade Review" value={settings.tradeReviewMode} />
              <SettingRow label="Playoff Teams" value={String(settings.playoffTeams)} />
              <SettingRow label="Season" value={`${settings.regularSeasonWeeks} weeks`} />
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={reset}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/[0.12] py-2.5 text-[12px] font-semibold text-white/60 hover:bg-white/[0.04]"
              >
                <Edit3 className="h-3.5 w-3.5" /> Adjust
              </button>
              <button
                type="button"
                onClick={createLeague}
                disabled={creating}
                className="flex flex-[2] items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-500 py-2.5 text-[13px] font-bold text-black transition hover:opacity-90 disabled:opacity-50"
              >
                {creating ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</>
                ) : (
                  <><Check className="h-4 w-4" /> Create League</>
                )}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11px] text-white/40">{label}</span>
      <span className="text-[12px] font-medium text-white/80">{value}</span>
    </div>
  )
}
