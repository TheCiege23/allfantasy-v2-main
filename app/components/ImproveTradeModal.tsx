'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Sparkles, Copy, AlertCircle, Loader2, RefreshCw, Plus, Check, Search, Globe, Brain, Zap, ThumbsUp, ThumbsDown } from 'lucide-react'
import { toast } from 'sonner'
import { gtagEvent } from '@/lib/gtag'
import { FEEDBACK_REASONS } from '@/lib/feedback-reasons'
import { useEntitlements } from '@/hooks/useEntitlements'

type Suggestion = {
  title: string
  counter: string
  impact: string
  reasons: string[]
  sensitivityNote?: string | null
}

type ImproveTradeModalProps = {
  isOpen: boolean
  onClose: () => void
  originalTradeText: string
  leagueSize: number
  scoring: 'ppr' | 'half' | 'standard' | 'superflex'
  isDynasty: boolean
  currentResult: any
}

export default function ImproveTradeModal({
  isOpen,
  onClose,
  originalTradeText,
  leagueSize,
  scoring,
  isDynasty,
  currentResult,
}: ImproveTradeModalProps) {
  const [loading, setLoading] = useState(false)
  const [additionalLoading, setAdditionalLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const [userRoster, setUserRoster] = useState('')
  const [userContention, setUserContention] = useState<'win-now' | 'contender' | 'rebuild' | 'unknown'>('unknown')
  const [userRecord, setUserRecord] = useState('')
  const [leagueSettings, setLeagueSettings] = useState({
    starters: { qb: 1, rb: 2, wr: 3, te: 1, flex: 1, superflex: 0 },
    bench: 8,
    tePremium: false,
    superflex: false,
  })

  // Never nag an already-paying subscriber to "Upgrade to Pro" for a feature their plan already
  // includes — this free-tier cap only applies to non-Pro/Supreme accounts.
  const entitlements = useEntitlements()
  const alreadyHasPro = entitlements.hasPro || entitlements.hasSupreme
  const MAX_MORE_CLICKS = 3
  const RESET_AFTER_HOURS = 24
  const [moreCount, setMoreCount] = useState(0)
  const [lastResetTime, setLastResetTime] = useState<number | null>(null)
  const [useRealTimeNews, setUseRealTimeNews] = useState(true)
  const [thinkingPhase, setThinkingPhase] = useState(0)
  const [feedbackGiven, setFeedbackGiven] = useState<Set<string>>(new Set())
  const [selectedDownReason, setSelectedDownReason] = useState<string | null>(null)
  const downReasons = FEEDBACK_REASONS.map(r => r.label)

  useEffect(() => {
    if (!isOpen) return

    const savedSettings = localStorage.getItem('allfantasy_league_settings')
    if (savedSettings) try { setLeagueSettings(JSON.parse(savedSettings)) } catch {}

    const savedRoster = localStorage.getItem('allfantasy_user_roster')
    if (savedRoster) setUserRoster(savedRoster)

    const savedContention = localStorage.getItem('allfantasy_user_contention')
    if (savedContention) setUserContention(savedContention as any)

    const savedRecord = localStorage.getItem('allfantasy_user_record')
    if (savedRecord) setUserRecord(savedRecord)

    const now = Date.now()
    const storedCount = localStorage.getItem('improve_more_count')
    const storedTime = localStorage.getItem('improve_more_timestamp')
    let count = storedCount ? parseInt(storedCount, 10) : 0
    const time = storedTime ? parseInt(storedTime, 10) : 0
    if (!time || (now - time) >= RESET_AFTER_HOURS * 60 * 60 * 1000) {
      count = 0
      localStorage.setItem('improve_more_timestamp', now.toString())
      localStorage.setItem('improve_more_count', '0')
    }
    setMoreCount(count)
    setLastResetTime(time || now)

    setSuggestions([])
    setStreamText('')
    setError('')
    setFeedbackGiven(new Set())
    setSelectedDownReason(null)

    gtagEvent('improve_trade_modal_opened', {
      league_size: leagueSize,
      is_dynasty: isDynasty,
      scoring,
    })

    return () => {
      abortRef.current?.abort()
    }
  }, [isOpen, leagueSize, isDynasty, scoring])

  useEffect(() => {
    if (isOpen) {
      localStorage.setItem('allfantasy_league_settings', JSON.stringify(leagueSettings))
      localStorage.setItem('allfantasy_user_roster', userRoster)
      localStorage.setItem('allfantasy_user_contention', userContention)
      localStorage.setItem('allfantasy_user_record', userRecord)
    }
  }, [isOpen, leagueSettings, userRoster, userContention, userRecord])

  const generateSuggestions = useCallback(async (append = false) => {
    if (!originalTradeText || originalTradeText.trim().length < 5) {
      setError('Trade text is too short to improve.')
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    if (append) {
      setAdditionalLoading(true)
    } else {
      setLoading(true)
      setStreaming(true)
      setStreamText('')
      setSuggestions([])
    }
    setError('')

    gtagEvent('improve_trade_generation_started', {
      action: append ? 'generate_more' : 'initial_or_regenerate',
      league_size: leagueSize,
      is_dynasty: isDynasty,
      scoring,
      contention: userContention,
    })

    try {
      const res = await fetch('/api/instant/improve-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeText: originalTradeText,
          leagueSize,
          scoring,
          isDynasty,
          leagueSettings,
          userRoster: userRoster.trim() || undefined,
          userContentionWindow: userContention !== 'unknown' ? userContention : undefined,
          userRecord: userRecord || undefined,
          currentVerdict: currentResult?.verdict || 'unknown',
          currentFairness: currentResult?.values?.percentDiff || 0,
          useRealTimeNews,
          stream: true,
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        let data: any
        try { data = await res.json() } catch {}
        throw new Error(data?.error || 'Failed to generate suggestions')
      }

      const contentType = res.headers.get('content-type') || ''

      if (contentType.includes('text/event-stream') && res.body) {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let receivedSuggestions = false
        let hadError = false
        let streamDone = false

        while (!streamDone) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const payload = line.slice(6).trim()
            if (payload === '[DONE]') {
              streamDone = true
              break
            }

            try {
              const event = JSON.parse(payload)

              if (event.error) {
                setError(event.error)
                hadError = true
                streamDone = true
                break
              }

              if (!append && event.accumulated) {
                setStreamText(event.accumulated)
              }

              if (event.done && event.suggestions) {
                if (append) {
                  setSuggestions(prev => [...prev, ...event.suggestions])
                  toast.success('More suggestions added!')
                } else {
                  setSuggestions(event.suggestions)
                  toast.success('AI suggestions ready!')
                }
                gtagEvent('improve_trade_generation_completed', {
                  action: append ? 'generate_more' : 'initial_or_regenerate',
                  suggestion_count: event.suggestions.length,
                })
                receivedSuggestions = true
                streamDone = true
                break
              }
            } catch {
              setError('Failed to read AI response. Please try again.')
              hadError = true
              streamDone = true
              break
            }
          }
        }

        setStreaming(false)
        setLoading(false)
        setAdditionalLoading(false)
        if (!receivedSuggestions && !hadError) {
          setError('No suggestions received. Please try again.')
        }
      } else {
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        if (append) {
          setSuggestions(prev => [...prev, ...(data.suggestions || [])])
          if (data.suggestions?.length) toast.success('More suggestions added!')
        } else {
          setSuggestions(data.suggestions || [])
          if (data.suggestions?.length) toast.success('AI suggestions ready!')
        }
        setStreaming(false)
        setLoading(false)
        setAdditionalLoading(false)
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return
      setError(err.message || 'Could not generate improvements right now.')
      toast.error('Suggestion generation failed')
      setStreaming(false)
      setLoading(false)
      setAdditionalLoading(false)
    }
  }, [originalTradeText, leagueSize, scoring, isDynasty, currentResult, leagueSettings, userRoster, userContention, userRecord])

  const fetchSuggestions = useCallback(() => {
    generateSuggestions(false)
  }, [generateSuggestions])

  const generateMore = useCallback(() => {
    if (moreCount >= MAX_MORE_CLICKS && !alreadyHasPro) {
      gtagEvent('improve_trade_generate_more_limit_hit', {
        league_size: leagueSize,
        is_dynasty: isDynasty,
        scoring,
        suggestions_generated: suggestions.length,
        hours_until_reset: RESET_AFTER_HOURS,
      })
      toast.custom(
        (t) => (
          <div className="bg-gradient-to-r from-purple-900/95 to-indigo-900/95 border border-purple-500/60 text-white p-5 rounded-2xl shadow-2xl max-w-md mx-auto">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-lg mb-2">Unlock Unlimited Generations</h3>
                <p className="text-sm opacity-90 mb-3">
                  You've reached the free limit ({MAX_MORE_CLICKS} more per {RESET_AFTER_HOURS === 24 ? 'day' : `${RESET_AFTER_HOURS} hours`}).
                  Upgrade to Pro for unlimited AI improvements, roster context, and faster responses.
                </p>
                <button
                  onClick={() => {
                    window.open('/pricing', '_blank')
                    toast.dismiss(t)
                  }}
                  className="px-6 py-3 bg-purple-600 hover:bg-purple-500 rounded-xl font-semibold text-base transition-all shadow-lg"
                >
                  See Pro Plan →
                </button>
              </div>
              <button
                onClick={() => toast.dismiss(t)}
                className="text-gray-300 hover:text-white p-1 rounded-full hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        ),
        { duration: 12000, position: 'top-center' }
      )
      return
    }
    gtagEvent('improve_trade_generate_more_clicked', {
      current_suggestion_count: suggestions.length,
      more_count_this_session: moreCount + 1,
      league_size: leagueSize,
      is_dynasty: isDynasty,
      scoring,
    })
    generateSuggestions(true)
    const newCount = moreCount + 1
    setMoreCount(newCount)
    localStorage.setItem('improve_more_count', newCount.toString())
    if (moreCount === 0 && !lastResetTime) {
      const now = Date.now()
      localStorage.setItem('improve_more_timestamp', now.toString())
      setLastResetTime(now)
    }
  }, [generateSuggestions, moreCount, suggestions.length, leagueSize, isDynasty, scoring, lastResetTime, alreadyHasPro])

  const cancelRequest = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setLoading(false)
    setAdditionalLoading(false)
    setStreaming(false)
    setError('Generation cancelled.')
    toast.info('Generation cancelled')
    gtagEvent('improve_trade_generation_cancelled', { scoring, is_dynasty: isDynasty })
  }

  const copySuggestion = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Suggestion copied — paste into your league chat!')
    gtagEvent('improve_trade_suggestion_copied', { scoring, is_dynasty: isDynasty })
  }

  const submitFeedback = async (sug: Suggestion, vote: 'UP' | 'DOWN', reason?: string) => {
    const key = sug.title + sug.counter
    if (feedbackGiven.has(key)) return

    try {
      await fetch('/api/feedback/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeText: originalTradeText,
          suggestionTitle: sug.title,
          suggestionText: sug.counter,
          vote,
          reason: vote === 'DOWN' ? reason : null,
          leagueSize,
          isDynasty,
          scoring,
          userRoster: userRoster || undefined,
          userContention,
        }),
      })

      setFeedbackGiven((prev) => new Set([...prev, key]))
      gtagEvent('trade_suggestion_feedback', { vote, suggestion_title: sug.title, reason: vote === 'DOWN' ? reason : undefined, scoring, is_dynasty: isDynasty, league_size: leagueSize })
      toast.success(vote === 'UP' ? 'Thanks! Great suggestion.' : 'Thanks — we\'ll learn from this.')
    } catch {
      toast.error('Failed to save feedback')
    }
  }

  useEffect(() => {
    if (loading && streaming) {
      setThinkingPhase(0)
      const intervals = [0, 2000, 4500, 7500, 11000, 15000]
      const timers = intervals.map((delay, i) =>
        setTimeout(() => setThinkingPhase(i), delay)
      )
      return () => timers.forEach(clearTimeout)
    } else {
      setThinkingPhase(0)
    }
  }, [loading, streaming])

  useEffect(() => {
    if (!isOpen) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [isOpen, onClose])

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl shadow-2xl"
            style={{ background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between p-5 sm:p-6 rounded-t-3xl backdrop-blur-sm" style={{ borderBottom: '1px solid var(--border)', background: 'var(--panel)' }}>
              <div className="flex items-center gap-3">
                <Sparkles className="w-6 h-6 text-cyan-400" />
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Improve This Trade</h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-full transition-colors"
                style={{ color: 'var(--muted)' }}
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 sm:p-6 space-y-6">
              <div className="p-3 rounded-xl text-sm" style={{ background: 'var(--subtle-bg)', color: 'var(--muted)' }}>
                <span style={{ color: 'var(--muted2)' }}>Current trade:</span>{' '}
                <strong style={{ color: 'var(--text)' }}>
                  {originalTradeText.length > 100 ? originalTradeText.slice(0, 100) + '...' : originalTradeText}
                </strong>
                {currentResult?.verdict && (
                  <span className="ml-2 text-xs" style={{ color: 'var(--muted2)' }}>
                    — {currentResult.verdict}
                  </span>
                )}
              </div>

              {!loading && !streaming && suggestions.length === 0 && !error && (
                <div className="space-y-5">
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--muted)' }}>Your Current Roster (highly recommended)</label>
                    <textarea
                      value={userRoster}
                      onChange={(e) => setUserRoster(e.target.value)}
                      placeholder={'QB: Josh Allen, Patrick Mahomes\nRB: Bijan Robinson, Breece Hall...\nWR: Justin Jefferson, CeeDee Lamb...\nFAAB remaining: 87%'}
                      rows={4}
                      className="w-full rounded-xl p-3 text-xs outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/25 transition-all resize-y font-mono"
                      style={{ background: 'var(--panel2)', border: '1px solid var(--border)', color: 'var(--text)' }}
                    />
                    <p className="text-[9px] mt-1" style={{ color: 'var(--muted2)' }}>Paste your full roster or key players + FAAB. AI uses this for replacement-level value and needs analysis.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--muted)' }}>Contention Window</label>
                      <select
                        value={userContention}
                        onChange={(e) => setUserContention(e.target.value as any)}
                        className="w-full rounded-xl p-3 text-xs outline-none focus:border-cyan-400/60 transition-all"
                        style={{ background: 'var(--panel2)', border: '1px solid var(--border)', color: 'var(--text)' }}
                      >
                        <option value="unknown">Not sure</option>
                        <option value="win-now">Win-Now / Contender</option>
                        <option value="contender">Building Contender</option>
                        <option value="rebuild">Rebuild / Tank</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--muted)' }}>Your Record This Season</label>
                      <input
                        type="text"
                        value={userRecord}
                        onChange={(e) => setUserRecord(e.target.value)}
                        placeholder="e.g. 9-4 or 6-7"
                        className="w-full rounded-xl p-3 text-xs outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/25 transition-all"
                        style={{ background: 'var(--panel2)', border: '1px solid var(--border)', color: 'var(--text)' }}
                      />
                    </div>
                  </div>

                  <details className="group">
                    <summary className="cursor-pointer text-xs font-medium flex items-center gap-2" style={{ color: 'var(--muted)' }}>
                      Advanced League Settings
                      <span className="text-[9px]" style={{ color: 'var(--muted2)' }}>(saved automatically)</span>
                    </summary>
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                      <div>
                        <label className="block mb-1" style={{ color: 'var(--muted2)' }}>Bench Spots</label>
                        <input
                          type="number"
                          value={leagueSettings.bench}
                          onChange={(e) => setLeagueSettings({ ...leagueSettings, bench: parseInt(e.target.value) || 8 })}
                          className="w-full rounded-lg p-2 outline-none"
                          style={{ background: 'var(--panel2)', border: '1px solid var(--border)', color: 'var(--text)' }}
                        />
                      </div>
                      <div>
                        <label className="block mb-1" style={{ color: 'var(--muted2)' }}>TE Premium</label>
                        <label className="flex items-center gap-2 mt-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={leagueSettings.tePremium}
                            onChange={(e) => setLeagueSettings({ ...leagueSettings, tePremium: e.target.checked })}
                            className="w-4 h-4 accent-cyan-400"
                          />
                          <span style={{ color: 'var(--text)' }}>Yes</span>
                        </label>
                      </div>
                      <div>
                        <label className="block mb-1" style={{ color: 'var(--muted2)' }}>Superflex</label>
                        <label className="flex items-center gap-2 mt-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={leagueSettings.superflex}
                            onChange={(e) => setLeagueSettings({ ...leagueSettings, superflex: e.target.checked })}
                            className="w-4 h-4 accent-cyan-400"
                          />
                          <span style={{ color: 'var(--text)' }}>Yes</span>
                        </label>
                      </div>
                    </div>
                  </details>

                  <label className="flex items-center gap-3 cursor-pointer py-1">
                    <input
                      type="checkbox"
                      checked={useRealTimeNews}
                      onChange={(e) => setUseRealTimeNews(e.target.checked)}
                      className="w-4 h-4 accent-cyan-400"
                    />
                    <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                      Use real-time news, injuries & X sentiment
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-cyan-400/10 text-cyan-400 font-semibold">LIVE</span>
                  </label>

                  <button
                    onClick={fetchSuggestions}
                    className="w-full rounded-xl py-3.5 font-bold text-sm text-black
                               bg-gradient-to-r from-cyan-400 via-cyan-300 to-cyan-400 bg-[length:200%_auto]
                               shadow-[0_6px_24px_rgba(34,211,238,0.35)]
                               hover:shadow-[0_8px_32px_rgba(34,211,238,0.5)] hover:bg-right
                               active:scale-[0.985] flex items-center justify-center gap-3 transition-all duration-200"
                  >
                    <Sparkles className="w-5 h-5" />
                    Generate AI Counter-Offers
                  </button>
                </div>
              )}

              {error && (
                <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" style={{ color: 'var(--accent-red)' }} />
                  <div className="text-sm" style={{ color: 'var(--accent-red)' }}>{error}</div>
                </div>
              )}

              {loading && streaming ? (
                <div className="space-y-6 min-h-[320px] py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-cyan-400">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="text-sm font-semibold">Thinking with real-time data...</span>
                    </div>
                    <button
                      onClick={cancelRequest}
                      className="px-4 py-2 rounded-xl text-xs font-medium transition-all active:scale-[0.95]"
                      style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--accent-red, #ef4444)' }}
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="space-y-2.5 text-sm">
                    {[
                      { icon: Globe, label: 'Fetching league-size adjusted values from FantasyCalc', phase: 0 },
                      { icon: Brain, label: 'Analyzing your roster needs & contention window', phase: 1 },
                      { icon: Search, label: 'Searching X for latest player buzz & rookie hype', phase: 2 },
                      { icon: Zap, label: 'Checking injuries, signings & volatility', phase: 3 },
                      { icon: Sparkles, label: 'Cross-checking with Grok + GPT-4o strategic brain', phase: 4 },
                      { icon: Brain, label: 'Synthesizing personalized, honest counters...', phase: 5 },
                    ].map((step) => {
                      const isActive = thinkingPhase === step.phase
                      const isComplete = thinkingPhase > step.phase
                      const isPending = thinkingPhase < step.phase
                      const Icon = step.icon

                      return (
                        <motion.div
                          key={step.phase}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: isPending ? 0.35 : 1, x: 0 }}
                          transition={{ delay: step.phase * 0.08, duration: 0.3 }}
                          className="flex items-center gap-2.5 py-1"
                        >
                          {isComplete ? (
                            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : isActive ? (
                            <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
                          ) : (
                            <Icon className="w-4 h-4 shrink-0" style={{ color: 'var(--muted2)' }} />
                          )}
                          <span
                            className={`transition-colors duration-300 ${isActive ? 'text-cyan-300 font-medium' : ''}`}
                            style={{ color: isComplete ? 'var(--muted)' : isActive ? undefined : 'var(--muted2)' }}
                          >
                            {step.label}
                          </span>
                        </motion.div>
                      )
                    })}
                  </div>

                  {streamText && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="p-4 rounded-2xl font-mono text-xs overflow-hidden"
                      style={{ background: 'var(--subtle-bg)', border: '1px solid var(--border)', color: 'var(--muted)' }}
                    >
                      <div className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all">
                        {streamText}
                        <span className="animate-pulse">▊</span>
                      </div>
                    </motion.div>
                  )}
                </div>
              ) : suggestions.length > 0 ? (
                <div className="space-y-5">
                  {suggestions.map((sug, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-cyan-500/5 to-purple-500/5"
                      style={{ border: '1px solid var(--border)' }}
                    >
                      <div className="flex justify-between items-start mb-3 gap-3">
                        <h3 className="font-bold text-base sm:text-lg" style={{ color: 'var(--text)' }}>{sug.title}</h3>
                        {sug.impact && (
                          <span className="px-3 py-1 rounded-full text-[10px] font-semibold bg-emerald-500/20 shrink-0 whitespace-nowrap" style={{ color: 'var(--accent-emerald)' }}>
                            {sug.impact}
                          </span>
                        )}
                      </div>

                      {sug.counter && (
                        <div className="mb-4 p-3 rounded-xl text-sm font-mono whitespace-pre-line" style={{ background: 'var(--panel2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                          {sug.counter}
                        </div>
                      )}

                      <ul className="space-y-1.5 mb-4 text-sm">
                        {sug.reasons.map((point, j) => (
                          <li key={j} className="flex gap-2">
                            <span className="text-cyan-400 mt-0.5 shrink-0">•</span>
                            <span style={{ color: 'var(--muted)' }}>{point}</span>
                          </li>
                        ))}
                      </ul>

                      {sug.sensitivityNote && (
                        <div className="mb-3 px-3 py-2 rounded-lg text-xs italic flex items-start gap-2" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', color: 'var(--muted)' }}>
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'rgba(234,179,8,0.7)' }} />
                          {sug.sensitivityNote}
                        </div>
                      )}

                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => copySuggestion(sug.counter)}
                          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all active:scale-[0.97]"
                          style={{ background: 'var(--subtle-bg)', border: '1px solid var(--border)', color: 'var(--muted)' }}
                        >
                          <Copy className="w-3.5 h-3.5" />
                          Copy counter-offer
                        </button>
                      </div>

                      <div className="flex flex-col gap-3 mt-4 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                        <div className="flex gap-4 items-center">
                          <button
                            onClick={() => submitFeedback(sug, 'UP')}
                            disabled={feedbackGiven.has(sug.title + sug.counter)}
                            className="flex items-center gap-2 text-xs font-medium transition-all active:scale-95 text-emerald-400 hover:text-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <ThumbsUp className="w-4 h-4" />
                            Helpful / Accurate
                          </button>
                          <button
                            onClick={() => setSelectedDownReason(sug.title + sug.counter)}
                            disabled={feedbackGiven.has(sug.title + sug.counter)}
                            className="flex items-center gap-2 text-xs font-medium transition-all active:scale-95 text-red-400 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <ThumbsDown className="w-4 h-4" />
                            Not helpful
                          </button>
                          {feedbackGiven.has(sug.title + sug.counter) && (
                            <span className="text-xs ml-auto" style={{ color: 'var(--muted2)' }}>Thanks for the feedback!</span>
                          )}
                        </div>

                        <AnimatePresence>
                          {selectedDownReason === (sug.title + sug.counter) && !feedbackGiven.has(sug.title + sug.counter) && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="p-4 rounded-xl" style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                                <p className="text-sm font-medium mb-3" style={{ color: 'var(--muted)' }}>Why wasn&apos;t this helpful?</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {downReasons.map((reason) => (
                                    <button
                                      key={reason}
                                      onClick={() => {
                                        submitFeedback(sug, 'DOWN', reason)
                                        setSelectedDownReason(null)
                                      }}
                                      className="px-4 py-2.5 text-left text-xs font-medium rounded-lg transition-all active:scale-[0.97]"
                                      style={{ background: 'rgba(239, 68, 68, 0.12)', color: 'var(--text)' }}
                                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.22)')}
                                      onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.12)')}
                                    >
                                      {reason}
                                    </button>
                                  ))}
                                </div>
                                <button
                                  onClick={() => setSelectedDownReason(null)}
                                  className="mt-3 text-xs transition-colors"
                                  style={{ color: 'var(--muted2)' }}
                                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text)')}
                                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted2)')}
                                >
                                  Cancel
                                </button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  ))}

                  {additionalLoading && (
                    <div className="flex items-center justify-center gap-3 py-6">
                      <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
                      <span className="text-sm font-medium" style={{ color: 'var(--muted)' }}>
                        Generating more suggestions...
                      </span>
                      <button
                        onClick={cancelRequest}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-[0.95]"
                        style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--accent-red, #ef4444)' }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              ) : !error && !loading ? (
                <div className="text-center py-12" style={{ color: 'var(--muted2)' }}>
                  Fill in your context above and generate counter-offers.
                </div>
              ) : null}
            </div>

            <div className="sticky bottom-0 p-5 sm:p-6 flex flex-wrap justify-end gap-3 sm:gap-4 rounded-b-3xl backdrop-blur-sm" style={{ borderTop: '1px solid var(--border)', background: 'var(--panel)' }}>
              <button
                onClick={onClose}
                className="px-5 sm:px-6 py-3 rounded-xl text-sm sm:text-base font-medium transition-all"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}
              >
                Close
              </button>
              {!loading && !additionalLoading && suggestions.length > 0 && (
                <>
                  <button
                    onClick={fetchSuggestions}
                    className="px-5 sm:px-6 py-3 rounded-xl text-sm sm:text-base font-medium transition-all active:scale-95 flex items-center gap-2"
                    style={{ background: 'rgba(6,182,212,0.15)', border: '1px solid rgba(6,182,212,0.3)', color: 'var(--text)' }}
                  >
                    <RefreshCw className="w-4 h-4" />
                    Regenerate All
                  </button>
                  {moreCount < MAX_MORE_CLICKS ? (
                    <button
                      onClick={generateMore}
                      disabled={additionalLoading}
                      className="px-5 sm:px-6 py-3 rounded-xl text-sm sm:text-base font-medium transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2"
                      style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)', color: 'var(--text)' }}
                    >
                      <Plus className="w-4 h-4" />
                      {additionalLoading ? 'Adding...' : `More Ideas (${MAX_MORE_CLICKS - moreCount} left)`}
                    </button>
                  ) : (
                    <div
                      className="px-5 sm:px-6 py-3 rounded-xl text-sm sm:text-base flex items-center gap-2 cursor-not-allowed opacity-80"
                      style={{ background: 'var(--subtle-bg)', border: '1px solid var(--border)', color: 'var(--muted2)' }}
                    >
                      <Plus className="w-4 h-4 opacity-50" />
                      Limit reached —{' '}
                      <button
                        onClick={() => window.open('/pricing', '_blank')}
                        className="underline hover:opacity-80 transition ml-1"
                        style={{ color: 'var(--muted)' }}
                      >
                        Upgrade for unlimited
                      </button>
                    </div>
                  )}
                </>
              )}
              {!loading && !additionalLoading && error && (
                <button
                  onClick={fetchSuggestions}
                  className="px-5 sm:px-6 py-3 rounded-xl text-sm sm:text-base font-semibold text-black bg-gradient-to-r from-cyan-400 to-cyan-300 transition-all active:scale-95"
                >
                  Try Again
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
