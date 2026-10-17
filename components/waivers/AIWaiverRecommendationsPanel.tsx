'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, Sparkles } from 'lucide-react'
import { z } from 'zod'

const recommendationSchema = z.object({
  addPlayerId: z.string().min(1), addPlayerName: z.string().min(1),
  dropPlayerId: z.string().nullable().optional(), dropPlayerName: z.string().nullable().optional(),
  priority: z.number().int().min(1), suggestedFaabBid: z.number().finite().min(0).nullable().optional(),
  confidence: z.enum(['high', 'medium', 'low']), risk: z.enum(['high', 'medium', 'low']),
  reasoning: z.string(), tags: z.array(z.string()),
  deeperAnalysisPath: z.string().regex(/^\/(?!\/)/).optional(),
})

type Recommendation = {
  addPlayerId: string
  addPlayerName: string
  dropPlayerId: string | null
  dropPlayerName: string | null
  priority: number
  suggestedFaabBid: number | null
  confidence: 'high' | 'medium' | 'low'
  risk: 'high' | 'medium' | 'low'
  reasoning: string
  deeperAnalysisPath: string
  tags: string[]
}

type RecommendResponse = {
  ok?: boolean
  recommendations?: Recommendation[]
  generatedAt?: string
}

type LockedResponse = {
  error?: string
  message?: string
  upgradePath?: string
}

/*
 * Two skins, one panel. `default` is the /waiver-wire look, untouched. `core` is the /core Waivers
 * screen's: its own card, label, button and colour TOKENS — the Tailwind skin hard-codes a dark
 * palette (`text-white/65` on a 5% sky wash), so on the core shell's LIGHT theme its text was
 * white on white. Same markup, same test ids; only the classes differ.
 */
const SKIN_DEFAULT = {
  section: 'rounded-xl border border-sky-400/25 bg-sky-500/5 p-4',
  head: 'flex flex-wrap items-start justify-between gap-3',
  title: 'text-sm font-semibold text-sky-100',
  sub: 'mt-1 text-xs text-white/65',
  btn: 'inline-flex items-center gap-1.5 rounded-lg border border-sky-400/40 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-100 hover:bg-sky-500/20 disabled:opacity-50',
  locked: 'mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 p-3',
  lockedTitle: 'text-sm font-medium text-amber-100',
  lockedBody: 'mt-1 text-xs text-amber-100/85',
  lockedLink: 'mt-2 inline-flex rounded-md border border-amber-300/40 bg-amber-500/20 px-2.5 py-1 text-xs text-amber-100 hover:bg-amber-500/30',
  error: 'mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-200',
  results: 'mt-3 space-y-3',
  meta: 'flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/60',
  list: 'space-y-2',
  rec: 'rounded-lg border border-white/10 bg-black/25 p-3',
  recHead: 'flex flex-wrap items-center justify-between gap-2',
  recTitle: 'text-sm text-white',
  chips: 'flex flex-wrap items-center gap-2 text-[11px]',
  chipConf: 'rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-100',
  chipRisk: 'rounded bg-white/10 px-1.5 py-0.5 text-white/80',
  chipBid: 'rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-200',
  reason: 'mt-2 text-xs text-white/75',
  tags: 'mt-2 flex flex-wrap gap-1',
  tag: 'rounded bg-white/10 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-white/60',
  deeper: 'mt-2 inline-flex rounded-md border border-cyan-400/35 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-100 hover:bg-cyan-500/20',
} as const

const SKIN_CORE: Record<keyof typeof SKIN_DEFAULT, string> = {
  section: 'af-card af-wv-section af-wvai',
  head: 'af-wvai-head',
  title: 'af-label',
  sub: 'af-wvai-sub',
  btn: 'af-btn af-wvai-btn',
  locked: 'af-wvai-box',
  lockedTitle: 'af-wvai-box-title',
  lockedBody: 'af-wvai-sub',
  lockedLink: 'af-btn af-wvai-btn',
  error: 'af-wvai-error',
  results: 'af-wvai-results',
  meta: 'af-wvai-meta',
  list: 'af-wvai-list',
  rec: 'af-wvai-rec',
  recHead: 'af-wvai-rec-head',
  recTitle: 'af-wvai-rec-title',
  chips: 'af-wvai-chips',
  chipConf: 'af-wvai-chip',
  chipRisk: 'af-wvai-chip',
  chipBid: 'af-wvai-chip af-wvai-chip--bid',
  reason: 'af-wvai-reason',
  tags: 'af-wvai-chips',
  tag: 'af-wvai-tag',
  deeper: 'af-wvai-link',
}

export default function AIWaiverRecommendationsPanel(props: { leagueId: string; surface?: 'default' | 'core' }) {
  // Results, locks and pending requests belong to one league. Changing the
  // selected league starts a fresh panel rather than relabelling old advice.
  return <LeagueWaiverRecommendationsPanel key={props.leagueId} {...props} />
}

function LeagueWaiverRecommendationsPanel({
  leagueId,
  surface = 'default',
}: {
  leagueId: string
  /** `core` on the /core Waivers screen — see SKIN_CORE. */
  surface?: 'default' | 'core'
}) {
  const cx = surface === 'core' ? SKIN_CORE : SKIN_DEFAULT
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [locked, setLocked] = useState<LockedResponse | null>(null)
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [remindersEnabled, setRemindersEnabled] = useState(false)
  const mounted = useRef(true)
  const busy = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const hasResults = recommendations.length > 0

  const summary = useMemo(() => {
    if (!hasResults) return null
    const highConfidence = recommendations.filter((r) => r.confidence === 'high').length
    return `${recommendations.length} recommendation${recommendations.length === 1 ? '' : 's'} · ${highConfidence} high-confidence`
  }, [hasResults, recommendations])

  async function loadRecommendations() {
    if (busy.current) return
    busy.current = true
    setLoading(true)
    setError('')
    setLocked(null)
    try {
      const response = await fetch('/api/ai/waivers/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          mode: 'quick',
          includeFaab: true,
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as RecommendResponse & LockedResponse
      if (!mounted.current) return

      if (!response.ok) {
        if (payload?.error === 'AF_PRO_REQUIRED') {
          setLocked(payload)
          setRecommendations([])
          setGeneratedAt(null)
          return
        }
        setError(payload?.message || payload?.error || "Chimmy's waiver recommendations could not load.")
        return
      }

      if (payload?.ok !== true || !Array.isArray(payload.recommendations) ||
          !payload.recommendations.every((row: unknown) => recommendationSchema.safeParse(row).success)) {
        setError("Chimmy's waiver result could not be verified. Please try again.")
        return
      }
      setRecommendations(payload.recommendations)
      setGeneratedAt(payload.generatedAt ?? null)
    } catch {
      if (!mounted.current) return
      setError("Network error while loading Chimmy's waiver recommendations.")
    } finally {
      busy.current = false
      if (mounted.current) setLoading(false)
    }
  }

  return (
    <section className={cx.section} data-testid="ai-waiver-recommendations-panel">
      <div className={cx.head}>
        <div>
          <h2 className={cx.title}>Chimmy&apos;s Waiver Recommendations</h2>
          <p className={cx.sub}>
            Recommendation-only guidance for add/drop targets, FAAB bids, and risk-aware priorities.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadRecommendations()}
          disabled={loading}
          className={cx.btn}
          data-testid="ai-waiver-recommendations-load"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {loading ? 'Analyzing...' : hasResults ? "Refresh Chimmy's suggestions" : "Get Chimmy's suggestions"}
        </button>
      </div>

      {locked?.error === 'AF_PRO_REQUIRED' && (
        <div className={cx.locked} data-testid="ai-waiver-recommendations-locked">
          <p className={cx.lockedTitle}>Chimmy&apos;s waiver recommendations are an AF Pro feature.</p>
          <p className={cx.lockedBody}>
            Unlock AF Pro to get add/drop suggestions, FAAB bids, roster-fit analysis, and waiver deadline reminders.
          </p>
          <Link
            href={locked.upgradePath || '/pricing?plan=af-pro&feature=waiver-ai'}
            className={cx.lockedLink}
            data-testid="ai-waiver-recommendations-upgrade-link"
          >
            Unlock AF Pro
          </Link>
        </div>
      )}

      {error && (
        <p className={cx.error} data-testid="ai-waiver-recommendations-error">
          {error}
        </p>
      )}

      {hasResults && (
        <div className={cx.results} data-testid="ai-waiver-recommendations-results">
          <div className={cx.meta}>
            <span>{summary}</span>
            {generatedAt ? <span>Updated: {new Date(generatedAt).toLocaleString()}</span> : null}
          </div>

          <ul className={cx.list}>
            {recommendations.map((rec, index) => (
              <li
                key={`${rec.addPlayerId}-${index}`}
                className={cx.rec}
                data-testid={`ai-waiver-recommendation-${index + 1}`}
              >
                <div className={cx.recHead}>
                  <p className={cx.recTitle}>
                    #{rec.priority} Add <span className="font-semibold">{rec.addPlayerName}</span>
                    {rec.dropPlayerName ? <> · Drop <span className="font-semibold">{rec.dropPlayerName}</span></> : null}
                  </p>
                  <div className={cx.chips}>
                    <span className={cx.chipConf}>Confidence: {rec.confidence}</span>
                    <span className={cx.chipRisk}>Risk: {rec.risk}</span>
                    {rec.suggestedFaabBid != null ? (
                      <span className={cx.chipBid}>Chimmy&apos;s bid · FAAB: {rec.suggestedFaabBid}</span>
                    ) : null}
                  </div>
                </div>
                <p className={cx.reason}>{rec.reasoning}</p>
                {rec.tags?.length ? (
                  <div className={cx.tags}>
                    {rec.tags.map((tag) => (
                      <span key={`${rec.addPlayerId}-${tag}`} className={cx.tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                {rec.deeperAnalysisPath ? (
                  <Link
                    href={rec.deeperAnalysisPath}
                    className={cx.deeper}
                    data-testid={`ai-waiver-recommendation-chimmy-${index + 1}`}
                  >
                    Ask Chimmy for deeper analysis
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>

          {/*
            A placeholder that saves nothing (it says so in its own copy). Kept where it was; NOT shown
            on the core screen, where a checkbox that does nothing reads as a working control.
          */}
          {surface !== 'core' ? (
            <div className="rounded-lg border border-cyan-400/25 bg-cyan-500/5 p-3" data-testid="waiver-reminder-placeholder">
              <label className="inline-flex items-center gap-2 text-xs text-cyan-100/90">
                <input
                  type="checkbox"
                  checked={remindersEnabled}
                  onChange={(event) => setRemindersEnabled(event.target.checked)}
                  className="rounded border-cyan-300/40 bg-black/30"
                />
                Waiver deadline reminders
              </label>
              <p className="mt-1 text-[11px] text-cyan-100/70">Get reminded before waivers process. (Placeholder only in this phase.)</p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
