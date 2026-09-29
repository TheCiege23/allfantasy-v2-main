'use client'

/**
 * app/league/[leagueId]/rate-commissioner/page.tsx
 * Commissioner rating page — accessible via chat link at end of season.
 * 5 questions with star ratings (1-5) + optional comment box.
 * AF themed: colorful, fun, full of life.
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Star, Send, CheckCircle, Trophy, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Question {
  id: string
  label: string
}

// ---------------------------------------------------------------------------
// Star Rating Component
// ---------------------------------------------------------------------------

function StarRating({
  value,
  onChange,
  disabled,
  color,
}: {
  value: number
  onChange: (v: number) => void
  disabled?: boolean
  color: string
}) {
  const [hover, setHover] = useState(0)

  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= (hover || value)
        return (
          <button
            key={star}
            type="button"
            disabled={disabled}
            onMouseEnter={() => !disabled && setHover(star)}
            onMouseLeave={() => setHover(0)}
            onClick={() => !disabled && onChange(star)}
            className={`transition-transform duration-150 ${
              disabled ? 'cursor-default' : 'cursor-pointer hover:scale-110'
            }`}
          >
            <Star
              className={`h-8 w-8 transition-colors ${
                filled
                  ? `${color} fill-current`
                  : 'text-white/15'
              }`}
            />
          </button>
        )
      })}
    </div>
  )
}

// Star colors per question — each question gets a unique vibe
const STAR_COLORS = [
  'text-amber-400',
  'text-cyan-400',
  'text-emerald-400',
  'text-violet-400',
  'text-pink-400',
]

// Gradient backgrounds per question
const CARD_GRADIENTS = [
  'from-amber-950/30 to-transparent border-amber-500/15',
  'from-cyan-950/30 to-transparent border-cyan-500/15',
  'from-emerald-950/30 to-transparent border-emerald-500/15',
  'from-violet-950/30 to-transparent border-violet-500/15',
  'from-pink-950/30 to-transparent border-pink-500/15',
]

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function RateCommissionerPage() {
  const params = useParams()
  const router = useRouter()
  const leagueId = params?.leagueId as string

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [questions, setQuestions] = useState<Question[]>([])
  const [season, setSeason] = useState(2025)
  const [leagueName, setLeagueName] = useState('')
  const [isCommissioner, setIsCommissioner] = useState(false)
  const [userSubmitted, setUserSubmitted] = useState(false)
  const [totalResponses, setTotalResponses] = useState(0)
  const [averages, setAverages] = useState<Record<string, number> | null>(null)

  const [ratings, setRatings] = useState<Record<string, number>>({})
  const [comment, setComment] = useState('')

  // Load
  useEffect(() => {
    if (!leagueId) return
    let active = true
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/commissioner-rating`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return
        if (data.error) { setError(data.error); return }
        setQuestions(data.questions ?? [])
        setSeason(data.season ?? 2025)
        setLeagueName(data.leagueName ?? '')
        setIsCommissioner(data.isCommissioner ?? false)
        setUserSubmitted(data.userSubmitted ?? false)
        setTotalResponses(data.totalResponses ?? 0)
        setAverages(data.averages ?? null)
        if (data.userSubmitted) setSubmitted(true)
      })
      .catch(() => { if (active) setError('Failed to load') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [leagueId])

  const handleRating = useCallback((questionId: string, value: number) => {
    setRatings((prev) => ({ ...prev, [questionId]: value }))
  }, [])

  const handleSubmit = useCallback(async () => {
    // Validate all questions rated
    for (const q of questions) {
      if (!ratings[q.id] || ratings[q.id] < 1) {
        setError(`Please rate all questions before submitting.`)
        return
      }
    }

    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/commissioner-rating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ratings, comment: comment.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to submit'); return }
      setSubmitted(true)
    } catch { setError('Request failed') }
    finally { setSubmitting(false) }
  }, [leagueId, questions, ratings, comment])

  const allRated = questions.every((q) => ratings[q.id] >= 1)

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0e1a]">
        <p className="text-white/50">Loading...</p>
      </div>
    )
  }

  // ===== SUBMITTED / RESULTS VIEW =====
  if (submitted || userSubmitted) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#0a0e1a] via-[#0d1526] to-[#0a0e1a] px-4 py-12">
        <div className="mx-auto max-w-lg">
          {/* Back link */}
          <Link
            href={`/league/${leagueId}`}
            className="mb-6 inline-flex items-center gap-1.5 text-[13px] font-semibold text-cyan-400 hover:text-cyan-300"
          >
            <ArrowLeft className="h-4 w-4" /> Back to League
          </Link>

          <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/30 to-cyan-950/20 p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20">
              <CheckCircle className="h-8 w-8 text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">Thank You!</h1>
            <p className="mt-2 text-[14px] text-white/50">
              Your rating for the {season} season has been submitted.
            </p>
            <p className="mt-1 text-[12px] text-white/30">
              {totalResponses} member{totalResponses !== 1 ? 's' : ''} have rated so far.
            </p>

            {/* Show averages if available */}
            {averages && (
              <div className="mt-6 space-y-2 text-left">
                <p className="text-[11px] font-bold uppercase tracking-wider text-white/30">Season Averages</p>
                {questions.map((q, i) => {
                  const avg = averages[q.id] ?? 0
                  return (
                    <div key={q.id} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2">
                      <span className="text-[12px] text-white/60">{q.label.split('?')[0].split('the commissioner')[0].trim()}</span>
                      <div className="flex items-center gap-1">
                        <Star className={`h-4 w-4 fill-current ${STAR_COLORS[i]}`} />
                        <span className="text-[13px] font-bold text-white">{avg.toFixed(1)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ===== COMMISSIONER VIEW =====
  if (isCommissioner) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#0a0e1a] via-[#0d1526] to-[#0a0e1a] px-4 py-12">
        <div className="mx-auto max-w-lg">
          <Link
            href={`/league/${leagueId}`}
            className="mb-6 inline-flex items-center gap-1.5 text-[13px] font-semibold text-cyan-400 hover:text-cyan-300"
          >
            <ArrowLeft className="h-4 w-4" /> Back to League
          </Link>

          <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-950/20 to-transparent p-8 text-center">
            <Trophy className="mx-auto mb-4 h-12 w-12 text-amber-400" />
            <h1 className="text-2xl font-bold text-white">Commissioner Ratings</h1>
            <p className="mt-2 text-[14px] text-white/50">
              {leagueName} — {season} Season
            </p>
            <p className="mt-4 text-[13px] text-white/40">
              {totalResponses} member{totalResponses !== 1 ? 's' : ''} have submitted ratings.
            </p>

            {averages && totalResponses > 0 && (
              <div className="mt-6 space-y-2 text-left">
                {questions.map((q, i) => {
                  const avg = averages[q.id] ?? 0
                  return (
                    <div key={q.id} className={`rounded-xl border bg-gradient-to-r p-3 ${CARD_GRADIENTS[i]}`}>
                      <p className="text-[12px] text-white/60">{q.label}</p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <Star key={s} className={`h-5 w-5 ${s <= Math.round(avg) ? `fill-current ${STAR_COLORS[i]}` : 'text-white/10'}`} />
                          ))}
                        </div>
                        <span className="text-[15px] font-bold text-white">{avg.toFixed(1)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {totalResponses === 0 && (
              <p className="mt-6 text-[12px] text-white/30">
                No ratings yet. Results will appear here once members submit their ratings.
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ===== RATING FORM =====
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0a0e1a] via-[#0d1526] to-[#0a0e1a] px-4 py-12">
      <div className="mx-auto max-w-lg">
        {/* Back link */}
        <Link
          href={`/league/${leagueId}`}
          className="mb-6 inline-flex items-center gap-1.5 text-[13px] font-semibold text-cyan-400 hover:text-cyan-300"
        >
          <ArrowLeft className="h-4 w-4" /> Back to League
        </Link>

        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/30 to-pink-500/30">
            <Star className="h-8 w-8 text-amber-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">Rate Your Commissioner</h1>
          <p className="mt-2 text-[14px] text-white/50">
            {leagueName} — {season} Season
          </p>
          <p className="mt-1 text-[12px] text-white/30">
            Your ratings are anonymous. Help improve the league experience!
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {/* Questions */}
        <div className="space-y-4">
          {questions.map((q, i) => (
            <div
              key={q.id}
              className={`rounded-xl border bg-gradient-to-r p-5 transition-all ${CARD_GRADIENTS[i]} ${
                ratings[q.id] ? 'shadow-lg' : ''
              }`}
            >
              <p className="mb-3 text-[14px] font-medium leading-relaxed text-white/80">
                {q.label}
              </p>
              <StarRating
                value={ratings[q.id] ?? 0}
                onChange={(v) => handleRating(q.id, v)}
                color={STAR_COLORS[i]}
              />
              {ratings[q.id] > 0 && (
                <p className="mt-2 text-[11px] text-white/30">
                  {ratings[q.id] === 5 ? 'Excellent!' : ratings[q.id] === 4 ? 'Great' : ratings[q.id] === 3 ? 'Average' : ratings[q.id] === 2 ? 'Below Average' : 'Poor'}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Optional comment */}
        <div className="mt-6 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">
            Additional Comments <span className="font-normal text-white/25">(optional)</span>
          </p>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Share any thoughts about the season, suggestions for improvement, or kudos..."
            className="w-full resize-none rounded-xl border border-white/15 bg-[#0d1526] px-4 py-3 text-[13px] text-white placeholder:text-white/20 focus:border-cyan-500/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
          />
          <p className="text-right text-[11px] text-white/20">{comment.length}/500</p>
        </div>

        {/* Submit */}
        <button
          type="button"
          disabled={submitting || !allRated}
          onClick={handleSubmit}
          className={`mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-[14px] font-bold transition ${
            allRated
              ? 'bg-gradient-to-r from-amber-500 to-pink-500 text-white shadow-lg shadow-amber-500/20 hover:from-amber-400 hover:to-pink-400'
              : 'bg-white/10 text-white/30 cursor-not-allowed'
          } disabled:opacity-50`}
        >
          <Send className="h-4 w-4" />
          {submitting ? 'Submitting...' : 'Submit Rating'}
        </button>

        {!allRated && (
          <p className="mt-2 text-center text-[11px] text-white/25">
            Rate all 5 questions to submit
          </p>
        )}
      </div>
    </div>
  )
}
