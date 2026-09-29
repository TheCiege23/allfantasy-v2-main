"use client"

import { useState } from "react"
import { Zap, TrendingUp, Shield, Sparkles } from "lucide-react"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"

type Rec = {
  nodeId: string
  matchup: string
  round: number
  safePick: string | null
  upsetPick: string | null
  safeConfidence: number
  insight: string
}

const ROUND_LABELS: Record<number, string> = {
  1: "R1",
  2: "R2",
  3: "Sweet 16",
  4: "Elite 8",
  5: "Final Four",
  6: "Championship",
}

function ProbBar({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', width: 68, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${value}%`, background: color }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color, width: 32, textAlign: 'right', flexShrink: 0 }}>{value}%</span>
    </div>
  )
}

export function PickAssistCard({ entryId }: { entryId: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recs, setRecs] = useState<Rec[]>([])
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  const { t } = useLanguage()

  async function runAssist() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/bracket/ai/pick-assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entryId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || "Failed to load AI assist")
        return
      }
      setRecs(data.recommendations || [])
    } catch {
      setError("Failed to load AI assist")
    } finally {
      setLoading(false)
    }
  }

  const upsetCount = recs.filter(r => {
    const conf = r.safeConfidence
    return conf < 65
  }).length

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(13,17,23,0.8)', border: '1px solid rgba(6,182,212,0.12)' }}>
      <div className="px-4 py-3 flex items-center justify-between" style={{ background: 'rgba(6,182,212,0.04)', borderBottom: '1px solid rgba(6,182,212,0.08)' }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(6,182,212,0.12)' }}>
            <Sparkles style={{ width: 14, height: 14, color: '#22d3ee' }} />
          </div>
          <div>
            <div className="text-sm font-semibold" style={{ color: '#e0f2fe' }}>
              {t("bracket.ai.pickAssist.title")}
            </div>
            <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
              {recs.length > 0
                ? t("bracket.ai.pickAssist.subtitleActive")
                : t("bracket.ai.pickAssist.subtitleIdle")}
            </div>
          </div>
        </div>
        <button
          onClick={runAssist}
          disabled={loading}
          className="text-xs rounded-lg px-3 py-1.5 font-semibold transition-all disabled:opacity-40"
          style={{ background: 'rgba(6,182,212,0.15)', color: '#22d3ee', border: '1px solid rgba(6,182,212,0.2)' }}
        >
          {loading
            ? t("bracket.ai.pickAssist.button.loading")
            : recs.length > 0
            ? t("bracket.ai.pickAssist.button.refresh")
            : t("bracket.ai.pickAssist.button.analyze")}
        </button>
      </div>

      {error && (
        <div className="px-4 py-2 text-xs" style={{ color: '#f87171', background: 'rgba(239,68,68,0.05)' }}>{error}</div>
      )}

      {recs.length === 0 && !loading && (
        <div className="p-4 text-center space-y-2">
          <div className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {t("bracket.ai.pickAssist.emptyHelper")}
          </div>
        </div>
      )}

      {loading && (
        <div className="p-6 text-center">
          <div className="inline-flex items-center gap-2 text-xs" style={{ color: 'rgba(6,182,212,0.6)' }}>
            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            Analyzing matchups...
          </div>
        </div>
      )}

      {recs.length > 0 && (
        <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
          {upsetCount > 0 && (
            <div className="px-4 py-2 flex items-center gap-2" style={{ background: 'rgba(168,85,247,0.04)' }}>
              <Zap style={{ width: 12, height: 12, color: '#c084fc' }} />
              <span className="text-[11px] font-semibold" style={{ color: '#c084fc' }}>
                {t("bracket.ai.pickAssist.upsetStrip")}
              </span>
            </div>
          )}

          {recs.slice(0, 6).map((r, idx) => {
            const teams = r.matchup.split(' vs ')
            const safeTeam = r.safePick || teams[0]
            const upsetTeam = r.upsetPick || teams[1]
            const upsetConf = 100 - r.safeConfidence
            const isUpsetWorthwhile = upsetConf >= 35
            const isExpanded = expandedIdx === idx

            return (
              <div
                key={r.nodeId}
                className="cursor-pointer transition-colors"
                onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                style={{ background: isExpanded ? 'rgba(255,255,255,0.02)' : undefined }}
              >
                <div className="px-4 py-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(251,146,60,0.1)', color: '#fb923c' }}>
                        {ROUND_LABELS[r.round] || `R${r.round}`}
                      </span>
                      <span className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>
                        {r.matchup}
                      </span>
                    </div>
                    {isUpsetWorthwhile && (
                      <Zap style={{ width: 10, height: 10, color: '#c084fc' }} />
                    )}
                  </div>

                  <div className="space-y-1">
                    <ProbBar value={r.safeConfidence} label={safeTeam} color="#22d3ee" />
                    <ProbBar value={upsetConf} label={upsetTeam} color={isUpsetWorthwhile ? '#c084fc' : 'rgba(255,255,255,0.2)'} />
                  </div>

                  {isExpanded && (
                    <div className="pt-1.5 space-y-2">
                      <div className="flex items-start gap-2 rounded-lg p-2" style={{ background: 'rgba(6,182,212,0.05)', border: '1px solid rgba(6,182,212,0.08)' }}>
                        <Shield style={{ width: 12, height: 12, color: '#22d3ee', flexShrink: 0, marginTop: 1 }} />
                        <div>
                          <div className="text-[11px] font-semibold" style={{ color: '#22d3ee' }}>Safe Pick: {r.safePick || 'TBD'}</div>
                          <div className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                            Higher seed advantage, {r.safeConfidence}% confidence
                          </div>
                        </div>
                      </div>

                      {isUpsetWorthwhile && (
                        <div className="flex items-start gap-2 rounded-lg p-2" style={{ background: 'rgba(168,85,247,0.05)', border: '1px solid rgba(168,85,247,0.08)' }}>
                          <TrendingUp style={{ width: 12, height: 12, color: '#c084fc', flexShrink: 0, marginTop: 1 }} />
                          <div>
                            <div className="text-[11px] font-semibold" style={{ color: '#c084fc' }}>Upset Dart: {r.upsetPick || 'TBD'}</div>
                            <div className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                              {upsetConf}% upset probability, high bracket differentiation
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.35)' }}>
                        {r.insight}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
