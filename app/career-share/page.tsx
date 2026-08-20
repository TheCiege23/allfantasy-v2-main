'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import { LandingToolVisitTracker } from '@/components/landing/LandingToolVisitTracker'
import EngagementEventTracker from '@/components/engagement/EngagementEventTracker'

type ShareType = 'legacy' | 'trade' | 'rankings' | 'exposure' | 'waiver'
type ShareStyle = 'clean' | 'funny' | 'hype' | 'balanced' | 'humble' | 'trash_talk'
type SharePlatform = 'x' | 'tiktok' | 'instagram' | 'threads'

interface ShareResult {
  ok: boolean
  share_text: string
  caption: string
  alt_captions: string[]
  hashtags: string[]
  platform: SharePlatform
  style: ShareStyle
  rate_limit: { remaining: number; retryAfterSec: number }
}

interface DynastyReport {
  overallOutlook: string
  topDynastyAssets: { name: string; reason: string; dynastyTier: string }[]
  biggestRisks: { name: string; reason: string; severity: string }[]
  projected3YearRank: string
  confidenceScore: number
  contenderOrRebuilder: string
  keyRecommendations: string[]
  windowStatus: string
  shareText: string
}

interface RewardStatus {
  totalEarned: number
  unredeemedTokens: number
  canShareToday: boolean
}

interface LeagueOption {
  id: string
  name: string
  platform: string
  sport: string
  scoring: string
  teamCount: number
  isDynasty: boolean
}

interface RankSnapshot {
  careerTier: number
  careerTierName: string
  careerLevel: number
  careerXp: string
  aiReportGrade: string | null
  aiScore: number | null
  aiInsight: string
}

interface RankResponse {
  imported: boolean
  rank: RankSnapshot | null
  legacyUsername?: string | null
}

const SHARE_TABS: Array<{ type: ShareType; icon: string; label: string }> = [
  { type: 'legacy', icon: '🏆', label: 'My Ranking' },
  { type: 'trade', icon: '⚔️', label: 'Trade' },
  { type: 'rankings', icon: '📊', label: 'League Rank' },
  { type: 'exposure', icon: '📈', label: 'Player Stock' },
  { type: 'waiver', icon: '💧', label: 'Waiver Pick' },
]

const STYLE_OPTIONS: Array<{ value: ShareStyle; label: string }> = [
  { value: 'balanced', label: '⚖️ Balanced' },
  { value: 'hype', label: '🔥 Hype' },
  { value: 'funny', label: '😂 Funny' },
  { value: 'humble', label: '🙏 Humble' },
  { value: 'trash_talk', label: '💬 Trash Talk' },
  { value: 'clean', label: '✨ Clean' },
]

const PLATFORM_OPTIONS: Array<{ value: SharePlatform; label: string; limit: string }> = [
  { value: 'x', label: '𝕏 X / Twitter', limit: '280 chars' },
  { value: 'instagram', label: '📸 Instagram', limit: '2200 chars' },
  { value: 'tiktok', label: '🎵 TikTok', limit: '150 chars' },
  { value: 'threads', label: '🧵 Threads', limit: '500 chars' },
]

function formatWindowStatus(status: string | undefined) {
  return String(status ?? '')
    .replace(/_/g, ' ')
    .trim()
}

function LoginRequiredState() {
  return (
    <div className="min-h-screen bg-[#07071a] text-white">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <div className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-8 text-center">
          <div className="text-xs font-bold uppercase tracking-[0.3em] text-violet-300">Career Share</div>
          <h1 className="mt-4 text-3xl font-black">Sign in to build share-ready posts</h1>
          <p className="mt-3 text-sm leading-6 text-white/55">
            Generate Grok-powered captions, load your dynasty report, and earn reward tokens after sharing.
          </p>
          <Link
            href="/login?callbackUrl=%2Fcareer-share"
            className="mt-6 inline-flex rounded-2xl border border-violet-500/30 bg-violet-500/10 px-5 py-3 text-sm font-bold text-violet-200 hover:bg-violet-500/20"
          >
            Go to Login
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function CareerSharePage() {
  const { data: session, status } = useSession()

  const [activeType, setActiveType] = useState<ShareType>('legacy')
  const [style, setStyle] = useState<ShareStyle>('balanced')
  const [platform, setPlatform] = useState<SharePlatform>('x')
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ShareResult | null>(null)
  const [activeCaption, setActiveCaption] = useState('')
  const [report, setReport] = useState<DynastyReport | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportExpanded, setReportExpanded] = useState(true)
  const [rewards, setRewards] = useState<RewardStatus | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rateLimitSecs, setRateLimitSecs] = useState(0)

  const [tradeGiveList, setTradeGiveList] = useState<string[]>(['', ''])
  const [tradeGetList, setTradeGetList] = useState<string[]>(['', ''])
  const [tradeGrade, setTradeGrade] = useState('')
  const [tradeVerdict, setTradeVerdict] = useState('')
  const [tradeFormat, setTradeFormat] = useState('Dynasty')

  const [leagueName, setLeagueName] = useState('')
  const [myRank, setMyRank] = useState<number>(1)
  const [totalTeams, setTotalTeams] = useState<number>(12)
  const [rosterValue, setRosterValue] = useState('')
  const [outlook, setOutlook] = useState('')

  const [playerName, setPlayerName] = useState('')
  const [ownershipPct, setOwnershipPct] = useState<number>(0)
  const [leaguesOwned, setLeaguesOwned] = useState<number>(0)
  const [totalLeagues, setTotalLeagues] = useState<number>(0)
  const [signal, setSignal] = useState('Hold')

  const [waiverPlayer, setWaiverPlayer] = useState('')
  const [recommendation, setRecommendation] = useState('Add')
  const [faabPct, setFaabPct] = useState<number>(0)
  const [waiverReason, setWaiverReason] = useState('')

  const [leagues, setLeagues] = useState<LeagueOption[]>([])
  const [selectedLeagueId, setSelectedLeagueId] = useState('')
  const [rankData, setRankData] = useState<RankSnapshot | null>(null)
  const [rankImported, setRankImported] = useState(false)
  const [legacyUsername, setLegacyUsername] = useState<string | null>(null)

  const rateLimitIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const currentLeague = useMemo(
    () => leagues.find((league) => league.id === selectedLeagueId) ?? null,
    [leagues, selectedLeagueId]
  )

  const platformMeta = useMemo(
    () => PLATFORM_OPTIONS.find((entry) => entry.value === platform) ?? PLATFORM_OPTIONS[0],
    [platform]
  )

  const startRateLimitCountdown = useCallback((seconds: number) => {
    if (rateLimitIntervalRef.current) {
      clearInterval(rateLimitIntervalRef.current)
      rateLimitIntervalRef.current = null
    }

    setRateLimitSecs(seconds)

    rateLimitIntervalRef.current = setInterval(() => {
      setRateLimitSecs((current) => {
        if (current <= 1) {
          if (rateLimitIntervalRef.current) {
            clearInterval(rateLimitIntervalRef.current)
            rateLimitIntervalRef.current = null
          }
          return 0
        }
        return current - 1
      })
    }, 1000)
  }, [])

  useEffect(() => {
    return () => {
      if (rateLimitIntervalRef.current) {
        clearInterval(rateLimitIntervalRef.current)
      }
    }
  }, [])

  const loadRewards = useCallback(async () => {
    try {
      const res = await fetch('/api/legacy/share-reward', { cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as Partial<RewardStatus>
      if (typeof data.totalEarned === 'number' && typeof data.unredeemedTokens === 'number' && typeof data.canShareToday === 'boolean') {
        setRewards({
          totalEarned: data.totalEarned,
          unredeemedTokens: data.unredeemedTokens,
          canShareToday: data.canShareToday,
        })
      }
    } catch {
      // Reward status is a convenience layer; fail silently.
    }
  }, [])

  const claimReward = useCallback(async () => {
    if (!result) return

    try {
      await fetch('/api/legacy/share-reward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId: selectedLeagueId || undefined,
          shareType: activeType,
          shareContent: {
            caption: activeCaption,
            hashtags: result.hashtags,
            shareText: result.share_text,
          },
          platform,
        }),
      })
      await loadRewards()
    } catch {
      // Non-fatal. Sharing should still succeed even if token sync fails.
    }
  }, [activeCaption, activeType, loadRewards, platform, result, selectedLeagueId])

  const copyCaption = useCallback(async () => {
    if (!result) return

    const text = [activeCaption, ...result.hashtags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))]
      .filter(Boolean)
      .join('\n')

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
      await claimReward()
    } catch {
      setError('Could not copy the caption to your clipboard.')
    }
  }, [activeCaption, claimReward, result])

  const loadDynastyReport = useCallback(async () => {
    setReportLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/legacy/ai-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedLeagueId ? { leagueId: selectedLeagueId } : {}),
      })
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; report?: DynastyReport; error?: string }
      if (data.success && data.report) {
        setReport(data.report)
        setReportExpanded(true)
      } else {
        throw new Error(data.error ?? 'Report failed')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Report failed')
    } finally {
      setReportLoading(false)
    }
  }, [selectedLeagueId])

  const generate = useCallback(async () => {
    if (!username.trim() || loading) return

    if (activeType === 'trade') {
      const giving = tradeGiveList.filter((entry) => entry.trim())
      const getting = tradeGetList.filter((entry) => entry.trim())
      if (giving.length === 0 || getting.length === 0) {
        setError('Add at least one player on each side of the trade.')
        return
      }
    }

    if (activeType === 'exposure' && !playerName.trim()) {
      setError('Add a player name for the Player Stock share.')
      return
    }

    if (activeType === 'waiver' && !waiverPlayer.trim()) {
      setError('Add a player name for the Waiver Pick share.')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    const body: Record<string, unknown> = {
      sleeper_username: username.trim(),
      share_type: activeType,
      style,
      platform,
    }

    if (activeType === 'legacy' && rankData) {
      body.ranking_preview = {
        career: {
          xp: Number(rankData.careerXp),
          level: rankData.careerLevel,
          tier: rankData.careerTier,
          tier_name: rankData.careerTierName,
        },
      }
    }

    if (activeType === 'trade') {
      body.trade_data = {
        side_a: tradeGiveList.map((entry) => entry.trim()).filter(Boolean),
        side_b: tradeGetList.map((entry) => entry.trim()).filter(Boolean),
        grade: tradeGrade || undefined,
        verdict: tradeVerdict || undefined,
        league_type: tradeFormat,
      }
    }

    if (activeType === 'rankings') {
      body.rankings_data = {
        league_name: leagueName || currentLeague?.name || undefined,
        rank: myRank,
        total_teams: totalTeams,
        roster_value: rosterValue || undefined,
        outlook: outlook || undefined,
      }
    }

    if (activeType === 'exposure') {
      body.exposure_data = {
        player_name: playerName.trim(),
        ownership_pct: ownershipPct,
        leagues_owned: leaguesOwned,
        total_leagues: totalLeagues,
        signal,
      }
    }

    if (activeType === 'waiver') {
      body.waiver_data = {
        player_name: waiverPlayer.trim(),
        recommendation,
        faab_pct: faabPct,
        reason: waiverReason || undefined,
      }
    }

    try {
      const res = await fetch('/api/legacy/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as Partial<ShareResult> & {
        ok?: boolean
        error?: string
        rate_limit?: { retryAfterSec?: number; remaining?: number }
      }

      if (res.status === 429) {
        const secs = data.rate_limit?.retryAfterSec ?? 60
        startRateLimitCountdown(secs)
        throw new Error(`Rate limited. Try again in ${secs}s.`)
      }

      if (!res.ok || !data.ok || !data.caption || !Array.isArray(data.alt_captions) || !Array.isArray(data.hashtags) || !data.platform || !data.style || !data.share_text || !data.rate_limit) {
        throw new Error(data.error ?? 'Generation failed')
      }

      const nextResult: ShareResult = {
        ok: true,
        caption: data.caption,
        alt_captions: data.alt_captions,
        hashtags: data.hashtags,
        platform: data.platform,
        style: data.style,
        share_text: data.share_text,
        rate_limit: {
          remaining: data.rate_limit.remaining ?? 0,
          retryAfterSec: data.rate_limit.retryAfterSec ?? 0,
        },
      }

      setResult(nextResult)
      setActiveCaption(nextResult.caption)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setLoading(false)
    }
  }, [
    activeType,
    currentLeague?.name,
    faabPct,
    loading,
    myRank,
    outlook,
    ownershipPct,
    platform,
    playerName,
    rankData,
    recommendation,
    rosterValue,
    signal,
    startRateLimitCountdown,
    style,
    totalLeagues,
    totalTeams,
    tradeFormat,
    tradeGetList,
    tradeGiveList,
    tradeGrade,
    tradeVerdict,
    username,
    waiverPlayer,
    waiverReason,
    leaguesOwned,
    leagueName,
  ])

  useEffect(() => {
    if (status !== 'authenticated') return

    let cancelled = false

    async function loadContext() {
      try {
        const [rankRes, leaguesRes] = await Promise.all([
          fetch('/api/user/rank', { cache: 'no-store' }),
          fetch('/api/league/list', { cache: 'no-store' }),
        ])

        const rankPayload = (await rankRes.json().catch(() => ({}))) as RankResponse
        const leaguePayload = (await leaguesRes.json().catch(() => ({}))) as {
          leagues?: Array<{
            id?: string
            name?: string
            platform?: string
            sport?: string
            sport_type?: string
            scoring?: string
            leagueSize?: number
            isDynasty?: boolean
          }>
        }

        if (cancelled) return

        if (rankRes.ok) {
          setRankImported(Boolean(rankPayload.imported && rankPayload.rank))
          setRankData(rankPayload.rank ?? null)
          setLegacyUsername(rankPayload.legacyUsername ?? null)
        }

        if (leaguesRes.ok && Array.isArray(leaguePayload.leagues)) {
          const mapped = leaguePayload.leagues
            .map((league) => {
              if (!league.id || !league.name) return null
              return {
                id: league.id,
                name: league.name,
                platform: league.platform ?? 'sleeper',
                sport: league.sport_type ?? league.sport ?? 'NFL',
                scoring: league.scoring ?? 'standard',
                teamCount: league.leagueSize ?? 12,
                isDynasty: league.isDynasty === true,
              } satisfies LeagueOption
            })
            .filter((league): league is LeagueOption => league != null)

          setLeagues(mapped)
          if (!selectedLeagueId && mapped.length > 0) {
            setSelectedLeagueId(mapped[0].id)
          }
        }
      } catch {
        // Optional context only.
      }
    }

    void loadContext()
    void loadRewards()

    return () => {
      cancelled = true
    }
  }, [loadRewards, selectedLeagueId, status])

  useEffect(() => {
    if (username.trim()) return
    const fallback =
      legacyUsername?.trim() ||
      session?.user?.name?.trim() ||
      session?.user?.email?.split('@')[0]?.trim() ||
      ''
    if (fallback) setUsername(fallback)
  }, [legacyUsername, session?.user?.email, session?.user?.name, username])

  useEffect(() => {
    if (!currentLeague) return
    if (activeType === 'rankings' && !leagueName.trim()) {
      setLeagueName(currentLeague.name)
      setTotalTeams(currentLeague.teamCount || 12)
      if (!outlook.trim() && currentLeague.isDynasty) {
        setOutlook('Dynasty contender')
      }
    }
  }, [activeType, currentLeague, leagueName, outlook])

  if (status === 'loading') {
    return <div className="min-h-screen bg-[#07071a]" />
  }

  if (status === 'unauthenticated') {
    return <LoginRequiredState />
  }

  return (
    <>
      <LandingToolVisitTracker path="/career-share" toolName="Career Share" />
      <EngagementEventTracker
        eventType="ai_used"
        oncePerDayKey="tool_career_share"
        meta={{ product: 'legacy' }}
      />

      <div className="min-h-screen bg-[#07071a] text-white">
        <div className="sticky top-0 z-20 border-b border-white/6 bg-[#07071a]/90 backdrop-blur-xl">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <div>
              <div className="mb-0.5 text-xs font-bold uppercase tracking-widest text-violet-400">🚀 AI-Powered</div>
              <h1 className="text-xl font-black text-white">Career Share</h1>
              <p className="mt-0.5 text-xs text-white/40">
                Generate AI captions for any fantasy moment. Earn tokens for sharing.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/tools-hub"
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-white/60 hover:border-white/20 hover:text-white"
              >
                Back to Tools Hub
              </Link>
              {rewards ? (
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-center">
                    <div className="text-lg font-black text-yellow-400">{rewards.unredeemedTokens}</div>
                    <div className="text-[10px] uppercase tracking-wide text-yellow-400/60">Tokens</div>
                  </div>
                  {!rewards.canShareToday ? <div className="text-[11px] text-white/30">✓ Token earned today</div> : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {SHARE_TABS.map((tab) => (
              <button
                key={tab.type}
                type="button"
                onClick={() => {
                  setActiveType(tab.type)
                  setResult(null)
                  setError(null)
                }}
                className={`shrink-0 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-bold transition-all ${
                  activeType === tab.type
                    ? 'bg-gradient-to-r from-violet-500 to-cyan-500 text-white shadow-lg'
                    : 'bg-white/6 text-white/50 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="mr-2">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mx-auto max-w-5xl px-4 pb-10 sm:px-6">
          <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            <div className="space-y-4">
              {leagues.length > 0 ? (
                <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-5">
                  <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-white/40">
                    League Context
                  </label>
                  <select
                    value={selectedLeagueId}
                    onChange={(event) => setSelectedLeagueId(event.target.value)}
                    className="w-full rounded-xl border border-white/8 bg-[#0a0a1a] px-3 py-2 text-sm text-white focus:border-cyan-500/40 focus:outline-none"
                  >
                    <option value="">No specific league</option>
                    {leagues.map((league) => (
                      <option key={league.id} value={league.id}>
                        {league.name} · {league.platform} · {league.sport}
                      </option>
                    ))}
                  </select>
                  {currentLeague ? (
                    <p className="mt-2 text-[11px] leading-relaxed text-white/35">
                      {currentLeague.teamCount} teams · {currentLeague.scoring} · {currentLeague.isDynasty ? 'Dynasty' : 'Redraft'}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-5">
                <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-white/40">
                  Sleeper Username
                </label>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="your_username"
                  className="w-full border-b border-white/10 bg-transparent pb-1 text-sm text-white placeholder:text-white/20 focus:outline-none"
                />
                <p className="mt-2 text-[11px] leading-relaxed text-white/30">
                  This is used inside the generated caption prompt. You can overwrite the auto-filled value anytime.
                </p>
              </div>

              {activeType === 'legacy' ? (
                <div className="space-y-4 rounded-2xl border border-white/8 bg-[#0c0c1e] p-5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Career Data (optional)</p>
                  <p className="text-[11px] leading-relaxed text-white/30">
                    Pull in your AI dynasty report and ranking snapshot. If you skip this, Grok still creates a general career-share caption.
                  </p>

                  {rankImported && rankData ? (
                    <div className="rounded-xl bg-white/3 p-3 text-[11px] text-white/60">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="font-bold text-white/80">{rankData.careerTierName}</span>
                        <span className="text-violet-300">Level {rankData.careerLevel}</span>
                      </div>
                      <div>
                        {Number(rankData.careerXp).toLocaleString()} XP
                        {rankData.aiReportGrade ? ` · AI Grade ${rankData.aiReportGrade}` : ''}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl bg-white/3 p-3 text-[11px] text-white/45">
                      No imported legacy rank found yet. You can still generate a generic career-share caption.
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => void loadDynastyReport()}
                    disabled={reportLoading}
                    className="w-full rounded-xl border border-violet-500/30 py-2 text-xs font-bold text-violet-400 transition-all hover:bg-violet-500/10 disabled:opacity-40"
                  >
                    {reportLoading ? '⏳ Loading dynasty report...' : '⚡ Load My Dynasty Report'}
                  </button>

                  {report ? (
                    <div className="rounded-xl bg-white/3 p-3 text-[11px] text-white/60">
                      <div className="mb-1 font-bold text-white/80">{formatWindowStatus(report.windowStatus)}</div>
                      <div>{report.overallOutlook.slice(0, 120)}...</div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {activeType === 'trade' ? (
                <div className="space-y-4 rounded-2xl border border-white/8 bg-[#0c0c1e] p-5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Trade Details</p>

                  <div>
                    <label className="mb-1.5 block text-[10px] text-white/40">You Give</label>
                    {tradeGiveList.map((value, index) => (
                      <input
                        key={`give-${index}`}
                        value={value}
                        onChange={(event) =>
                          setTradeGiveList((current) => current.map((entry, entryIndex) => (entryIndex === index ? event.target.value : entry)))
                        }
                        placeholder={`Player ${index + 1}`}
                        className="mb-1.5 w-full rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs text-white placeholder:text-white/20 focus:border-red-500/50 focus:outline-none"
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => setTradeGiveList((current) => [...current, ''])}
                      className="text-[10px] text-white/30 hover:text-white/60"
                    >
                      + Add player
                    </button>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[10px] text-white/40">You Get</label>
                    {tradeGetList.map((value, index) => (
                      <input
                        key={`get-${index}`}
                        value={value}
                        onChange={(event) =>
                          setTradeGetList((current) => current.map((entry, entryIndex) => (entryIndex === index ? event.target.value : entry)))
                        }
                        placeholder={`Player ${index + 1}`}
                        className="mb-1.5 w-full rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs text-white placeholder:text-white/20 focus:border-green-500/50 focus:outline-none"
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => setTradeGetList((current) => [...current, ''])}
                      className="text-[10px] text-white/30 hover:text-white/60"
                    >
                      + Add player
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[10px] text-white/40">AI Grade</label>
                      <input
                        value={tradeGrade}
                        onChange={(event) => setTradeGrade(event.target.value)}
                        placeholder="A, B+, etc"
                        className="w-full rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] text-white/40">Format</label>
                      <select
                        value={tradeFormat}
                        onChange={(event) => setTradeFormat(event.target.value)}
                        className="w-full rounded-xl border border-white/8 bg-[#0c0c1e] px-3 py-2 text-xs text-white focus:outline-none"
                      >
                        {['Dynasty', 'Redraft', 'Keeper'].map((format) => (
                          <option key={format} value={format}>
                            {format}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-[10px] text-white/40">Verdict</label>
                    <input
                      value={tradeVerdict}
                      onChange={(event) => setTradeVerdict(event.target.value)}
                      placeholder="Smash accept, fair deal, pass, etc."
                      className="w-full rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none"
                    />
                  </div>
                </div>
              ) : null}

              {activeType === 'rankings' ? (
                <div className="space-y-3 rounded-2xl border border-white/8 bg-[#0c0c1e] p-5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">League Standing</p>
                  <input
                    value={leagueName}
                    onChange={(event) => setLeagueName(event.target.value)}
                    placeholder="League name"
                    className="w-full rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[10px] text-white/40">My Rank</label>
                      <input
                        type="number"
                        min={1}
                        value={myRank}
                        onChange={(event) => setMyRank(Math.max(1, Number(event.target.value) || 1))}
                        className="w-full rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs text-white focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] text-white/40">Total Teams</label>
                      <input
                        type="number"
                        min={2}
                        value={totalTeams}
                        onChange={(event) => setTotalTeams(Math.max(2, Number(event.target.value) || 2))}
                        className="w-full rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs text-white focus:outline-none"
                      />
                    </div>
                  </div>
                  <input
                    value={rosterValue}
                    onChange={(event) => setRosterValue(event.target.value)}
                    placeholder="Roster value (e.g. 52,400)"
                    className="w-full rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none"
                  />
                  <input
                    value={outlook}
                    onChange={(event) => setOutlook(event.target.value)}
                    placeholder="AI outlook (e.g. Contender)"
                    className="w-full rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none"
                  />
                </div>
              ) : null}

              {activeType === 'exposure' ? (
                <div className="space-y-3 rounded-2xl border border-white/8 bg-[#0c0c1e] p-5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Player Stock</p>
                  <input
                    value={playerName}
                    onChange={(event) => setPlayerName(event.target.value)}
                    placeholder="Player name"
                    className="w-full rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="mb-1 block text-[10px] text-white/40">Owned %</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={ownershipPct}
                        onChange={(event) => setOwnershipPct(Math.max(0, Math.min(100, Number(event.target.value) || 0)))}
                        className="w-full rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs text-white focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] text-white/40">Owned in</label>
                      <input
                        type="number"
                        min={0}
                        value={leaguesOwned}
                        onChange={(event) => setLeaguesOwned(Math.max(0, Number(event.target.value) || 0))}
                        className="w-full rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs text-white focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] text-white/40">of</label>
                      <input
                        type="number"
                        min={1}
                        value={totalLeagues}
                        onChange={(event) => setTotalLeagues(Math.max(1, Number(event.target.value) || 1))}
                        className="w-full rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs text-white focus:outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[10px] text-white/40">Signal</label>
                    <div className="flex flex-wrap gap-2">
                      {['Buy', 'Hold', 'Sell', 'Buy Low', 'Sell High'].map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setSignal(option)}
                          className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                            signal === option ? 'bg-cyan-500 text-black' : 'bg-white/6 text-white/50 hover:bg-white/10'
                          }`}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {activeType === 'waiver' ? (
                <div className="space-y-3 rounded-2xl border border-white/8 bg-[#0c0c1e] p-5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Waiver Pick</p>
                  <input
                    value={waiverPlayer}
                    onChange={(event) => setWaiverPlayer(event.target.value)}
                    placeholder="Player name"
                    className="w-full rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[10px] text-white/40">Action</label>
                      <select
                        value={recommendation}
                        onChange={(event) => setRecommendation(event.target.value)}
                        className="w-full rounded-xl border border-white/8 bg-[#0c0c1e] px-3 py-2 text-xs text-white focus:outline-none"
                      >
                        {['Add', 'Drop', 'Stream', 'Stash', 'Start', 'Sit'].map((action) => (
                          <option key={action} value={action}>
                            {action}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] text-white/40">FAAB %</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={faabPct}
                        onChange={(event) => setFaabPct(Math.max(0, Math.min(100, Number(event.target.value) || 0)))}
                        className="w-full rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs text-white focus:outline-none"
                      />
                    </div>
                  </div>
                  <textarea
                    value={waiverReason}
                    onChange={(event) => setWaiverReason(event.target.value)}
                    rows={3}
                    placeholder="Why pick up this player?"
                    className="w-full resize-none rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none"
                  />
                </div>
              ) : null}

              <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-5">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-white/40">Caption Style</p>
                <div className="grid grid-cols-2 gap-2">
                  {STYLE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setStyle(option.value)}
                      className={`rounded-xl py-2 text-xs font-bold transition-all ${
                        style === option.value
                          ? 'border border-violet-500/40 bg-violet-500/20 text-violet-300'
                          : 'bg-white/4 text-white/50 hover:bg-white/8'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-5">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-white/40">Platform</p>
                <div className="grid grid-cols-2 gap-2">
                  {PLATFORM_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setPlatform(option.value)}
                      className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                        platform === option.value
                          ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                          : 'border-white/8 bg-white/3 text-white/50 hover:border-white/20 hover:text-white'
                      }`}
                    >
                      <div className="text-xs font-bold">{option.label}</div>
                      <div className="mt-0.5 text-[9px] opacity-50">{option.limit}</div>
                    </button>
                  ))}
                </div>
              </div>

              {error ? (
                <div className="flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-300">
                  ⚠️ {error}
                  <button type="button" onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">
                    ✕
                  </button>
                </div>
              ) : null}

              {rateLimitSecs > 0 ? (
                <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4 text-center text-xs text-yellow-300">
                  ⏱ Rate limited — try again in {rateLimitSecs}s
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => void generate()}
                disabled={!username.trim() || loading || rateLimitSecs > 0}
                className="w-full rounded-2xl py-4 text-sm font-black transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30"
                style={{
                  background: 'linear-gradient(135deg, #7c3aed, #0891b2)',
                  boxShadow: !username.trim() || loading ? 'none' : '0 8px 32px rgba(124,58,237,0.35)',
                }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10" />
                    </svg>
                    Generating with Grok...
                  </span>
                ) : (
                  '✨ Generate Caption'
                )}
              </button>
            </div>

            <div className="space-y-5">
              {activeType === 'legacy' || report || reportLoading ? (
                <div className="rounded-2xl border border-cyan-500/20 bg-[#0c0c1e]">
                  <button
                    type="button"
                    onClick={() => setReportExpanded((current) => !current)}
                    className="flex w-full items-center justify-between gap-3 p-5 text-left"
                  >
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">🤖 Dynasty AI Report</p>
                      <p className="mt-1 text-xs text-white/35">
                        Loads separately from caption generation so your share flow stays fast.
                      </p>
                    </div>
                    {reportExpanded ? <ChevronUp className="h-4 w-4 text-white/45" /> : <ChevronDown className="h-4 w-4 text-white/45" />}
                  </button>

                  {reportExpanded ? (
                    <div className="border-t border-white/6 px-5 pb-5 pt-4">
                      {!report && !reportLoading ? (
                        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-4 text-sm text-white/45">
                          Load your dynasty report from the left panel to add an AI-backed career snapshot here.
                        </div>
                      ) : null}

                      {reportLoading ? (
                        <div className="rounded-xl border border-white/8 bg-white/[0.03] p-5 text-sm text-white/50">
                          Loading your dynasty report...
                        </div>
                      ) : null}

                      {report ? (
                        <div className="space-y-4">
                          <p className="text-sm leading-relaxed text-white/70">{report.overallOutlook}</p>

                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-xl border px-3 py-1.5 text-xs font-black ${
                                report.windowStatus === 'READY_TO_COMPETE'
                                  ? 'border-green-500/30 bg-green-500/20 text-green-300'
                                  : report.windowStatus === 'REBUILDING'
                                    ? 'border-blue-500/30 bg-blue-500/20 text-blue-300'
                                    : 'border-yellow-500/30 bg-yellow-500/20 text-yellow-300'
                              }`}
                            >
                              {formatWindowStatus(report.windowStatus)}
                            </span>
                            <span className="text-xs text-white/40">Confidence: {report.confidenceScore}/100</span>
                            {report.projected3YearRank ? (
                              <span className="text-xs text-white/40">3-Year Outlook: {report.projected3YearRank}</span>
                            ) : null}
                          </div>

                          {report.topDynastyAssets.length > 0 ? (
                            <div>
                              <p className="mb-2 text-[10px] uppercase tracking-widest text-white/30">Top Dynasty Assets</p>
                              <div className="space-y-2">
                                {report.topDynastyAssets.slice(0, 3).map((asset) => (
                                  <div key={`${asset.name}-${asset.dynastyTier}`} className="rounded-xl bg-white/3 px-3 py-3">
                                    <div className="flex items-center gap-2">
                                      <span className="rounded-lg bg-cyan-500/10 px-2 py-0.5 text-[10px] font-black uppercase text-cyan-300">
                                        {asset.dynastyTier}
                                      </span>
                                      <span className="text-xs font-semibold text-white/85">{asset.name}</span>
                                    </div>
                                    <p className="mt-2 text-xs leading-5 text-white/55">{asset.reason}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {report.keyRecommendations.length > 0 ? (
                            <div>
                              <p className="mb-2 text-[10px] uppercase tracking-widest text-white/30">Key Moves</p>
                              <div className="space-y-2">
                                {report.keyRecommendations.map((recommendationItem, index) => (
                                  <div key={`${recommendationItem}-${index}`} className="flex gap-2 text-xs text-white/60">
                                    <span className="mt-1 text-cyan-400">→</span>
                                    <span>{recommendationItem}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {!result && !loading ? (
                <div className="rounded-3xl border border-dashed border-white/15 bg-transparent p-12 text-center">
                  <div className="mb-4 text-5xl">🚀</div>
                  <h3 className="mb-2 text-lg font-bold text-white">Share Your Fantasy Story</h3>
                  <p className="mx-auto max-w-sm text-sm text-white/40">
                    Choose a share type, fill in your details, and let Grok AI write the perfect caption for any platform.
                  </p>
                  <div className="mx-auto mt-6 grid max-w-xs grid-cols-2 gap-3 text-xs text-white/30">
                    <div className="flex items-center gap-2">
                      <span>🏆</span>
                      <span>Career rank captions</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>⚔️</span>
                      <span>Trade debate posts</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>📊</span>
                      <span>League standing flex</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>📈</span>
                      <span>Player stock takes</span>
                    </div>
                  </div>
                </div>
              ) : null}

              {loading ? (
                <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-8 text-center">
                  <div className="mb-6 flex items-center justify-center gap-1.5">
                    {[0, 1, 2].map((index) => (
                      <div
                        key={index}
                        className="h-2 w-2 animate-bounce rounded-full bg-violet-500"
                        style={{ animationDelay: `${index * 150}ms` }}
                      />
                    ))}
                  </div>
                  <p className="text-sm text-white/60">Grok is writing your caption...</p>
                </div>
              ) : null}

              {result ? (
                <>
                  <div className="overflow-hidden rounded-3xl border border-violet-500/30 bg-[#0c0c1e]">
                    <div className="h-0.5 w-full bg-gradient-to-r from-violet-500 via-cyan-500 to-violet-500" />
                    <div className="p-6">
                      <div className="mb-4 flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-violet-400">Generated Caption</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-white/30">
                            {activeCaption.length}/{platformMeta.limit}
                          </span>
                          {result.rate_limit.remaining > 0 ? (
                            <span className="text-[10px] text-white/25">{result.rate_limit.remaining} left</span>
                          ) : null}
                        </div>
                      </div>

                      <textarea
                        value={activeCaption}
                        onChange={(event) => setActiveCaption(event.target.value)}
                        rows={5}
                        className="mb-4 w-full resize-none rounded-xl border border-white/8 bg-white/4 px-4 py-3 text-sm leading-relaxed text-white focus:border-violet-500/40 focus:outline-none"
                      />

                      {result.hashtags.length > 0 ? (
                        <div className="mb-5 flex flex-wrap gap-1.5">
                          {result.hashtags.map((hashtag, index) => (
                            <span
                              key={`${hashtag}-${index}`}
                              className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-400"
                            >
                              {hashtag.startsWith('#') ? hashtag : `#${hashtag}`}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => void copyCaption()}
                          className="flex-1 rounded-xl py-3 text-sm font-bold transition-all"
                          style={{
                            background: copied ? '#10b981' : 'linear-gradient(135deg, #7c3aed, #0891b2)',
                            color: 'white',
                          }}
                        >
                          {copied ? '✓ Copied! Token earned 🎉' : '📋 Copy Caption'}
                        </button>

                        {platform === 'x' ? (
                          <a
                            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent([activeCaption, ...result.hashtags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))].join('\n'))}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => void claimReward()}
                            className="rounded-xl bg-white/8 px-4 py-3 text-sm font-bold text-white/70 transition-all hover:bg-white/15 hover:text-white"
                          >
                            Post to 𝕏
                          </a>
                        ) : (
                          <div className="flex items-center rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/45">
                            Copy first, then paste into {platformMeta.label}.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {result.alt_captions.length > 0 ? (
                    <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-5">
                      <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-white/30">Alternate Captions</p>
                      <div className="space-y-3">
                        {result.alt_captions.map((caption, index) => (
                          <button
                            key={`${caption}-${index}`}
                            type="button"
                            onClick={() => setActiveCaption(caption)}
                            className={`w-full rounded-xl border px-4 py-3 text-left text-xs leading-relaxed transition-all ${
                              activeCaption === caption
                                ? 'border-violet-500/40 bg-violet-500/10 text-white'
                                : 'border-white/8 bg-white/2 text-white/60 hover:border-white/20 hover:text-white'
                            }`}
                          >
                            {caption}
                          </button>
                        ))}
                      </div>
                      <p className="mt-2 text-[10px] text-white/25">Click any caption to switch to it</p>
                    </div>
                  ) : null}

                  {rewards ? (
                    <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/5 p-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-yellow-400">🎁 Share Tokens</p>
                          <p className="text-xs text-white/40">Copy or share your caption to earn 1 free AI token per day</p>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-black text-yellow-400">{rewards.unredeemedTokens}</div>
                          <div className="text-[10px] text-yellow-400/60">available</div>
                        </div>
                      </div>
                      {!rewards.canShareToday ? (
                        <p className="mt-3 flex items-center gap-1 text-[11px] text-green-400">
                          ✓ You already earned your token for today — come back tomorrow!
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}

              {!result && rewards ? (
                <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/5 p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-yellow-400">🎁 Share Tokens</p>
                      <p className="text-xs text-white/40">Generate and share a caption to add to your reward balance.</p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-black text-yellow-400">{rewards.unredeemedTokens}</div>
                      <div className="text-[10px] text-yellow-400/60">available</div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-white/35">
                    <Sparkles className="h-3.5 w-3.5 text-yellow-300" />
                    <span>Total earned: {rewards.totalEarned}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
