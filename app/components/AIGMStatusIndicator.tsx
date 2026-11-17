'use client'

import { useState, useEffect, useCallback } from 'react'

interface PreAnalysisStatus {
  status: 'ready' | 'analyzing' | 'pending'
  estimatedTime?: number
  message: string
  cache?: {
    leagueSettings: {
      isDynasty: boolean
      isSuperFlex: boolean
      scoringType: string
      teamCount: number
    }
    userTradingProfile: {
      totalTrades: number
      winRate: number
      tradingStyle: {
        youthVsProduction: number
        consolidationVsDepth: number
        picksVsPlayers: number
      }
    }
    managerProfiles: Array<{
      managerName: string
      teamSituation: string
      tradingActivity: number
    }>
    rosterNeeds: {
      strengths: string[]
      weaknesses: string[]
      recommendations: string[]
    }
    lastUpdated: string
  }
}

interface AIGMStatusIndicatorProps {
  username: string
  leagueId: string
  onReady?: (cache: PreAnalysisStatus['cache']) => void
  compact?: boolean
}

export default function AIGMStatusIndicator({ 
  username, 
  leagueId, 
  onReady,
  compact = false 
}: AIGMStatusIndicatorProps) {
  const [status, setStatus] = useState<PreAnalysisStatus | null>(null)
  const [, setIsLoading] = useState(true)
  const [progress, setProgress] = useState(0)

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/legacy/pre-analysis?username=${encodeURIComponent(username)}&leagueId=${encodeURIComponent(leagueId)}`)
      if (res.ok) {
        const data = await res.json()
        setStatus(data)
        
        if (data.status === 'ready' && data.cache && onReady) {
          onReady(data.cache)
        }
        
        return data.status
      }
    } catch (error) {
      console.error('Failed to check pre-analysis status:', error)
    }
    return null
  }, [username, leagueId, onReady])

  const triggerAnalysis = useCallback(async () => {
    try {
      fetch('/api/legacy/pre-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, leagueId, background: true }),
      }).catch(() => {})
    } catch (error) {
      console.error('Failed to trigger pre-analysis:', error)
    }
  }, [username, leagueId])

  useEffect(() => {
    if (!username || !leagueId) return

    const init = async () => {
      setIsLoading(true)
      const currentStatus = await checkStatus()
      
      if (currentStatus === 'pending') {
        await triggerAnalysis()
        setProgress(0)
        
        const progressInterval = setInterval(() => {
          setProgress(prev => Math.min(prev + 5, 95))
        }, 1000)
        
        const pollInterval = setInterval(async () => {
          const newStatus = await checkStatus()
          if (newStatus === 'ready') {
            clearInterval(pollInterval)
            clearInterval(progressInterval)
            setProgress(100)
          }
        }, 3000)
        
        return () => {
          clearInterval(pollInterval)
          clearInterval(progressInterval)
        }
      } else if (currentStatus === 'analyzing') {
        setProgress(30)
        
        const pollInterval = setInterval(async () => {
          const newStatus = await checkStatus()
          setProgress(prev => Math.min(prev + 10, 95))
          if (newStatus === 'ready') {
            clearInterval(pollInterval)
            setProgress(100)
          }
        }, 3000)
        
        return () => clearInterval(pollInterval)
      }
      
      setIsLoading(false)
    }

    init()
  }, [username, leagueId, checkStatus, triggerAnalysis])

  if (!status) return null

  if (compact && status.status === 'ready') {
    return (
      <div className="flex items-center gap-2 text-sm text-green-400">
        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span>AI GM Ready</span>
      </div>
    )
  }

  if (status.status === 'ready') {
    return (
      <div className="bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/30 rounded-xl p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-500/30 flex items-center justify-center text-xl">
            🧠
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-green-400 font-semibold">AI GM Ready</span>
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            </div>
            <p className="text-sm text-white/70">
              {status.cache?.userTradingProfile?.totalTrades 
                ? `Analyzed ${status.cache.userTradingProfile.totalTrades} of your trades • ${Math.round(status.cache.userTradingProfile.winRate * 100)}% win rate`
                : 'League data loaded and ready for trade analysis'
              }
            </p>
          </div>
        </div>
        
        {status.cache?.rosterNeeds && status.cache.rosterNeeds.recommendations.length > 0 && (
          <div className="mt-3 pt-3 border-t border-green-500/20">
            <p className="text-xs text-white/60 mb-2">Quick insights from your AI GM:</p>
            <div className="flex flex-wrap gap-2">
              {status.cache.rosterNeeds.weaknesses.map((pos, i) => (
                <span key={i} className="px-2 py-1 bg-red-500/20 text-red-300 text-xs rounded-lg">
                  Need {pos}
                </span>
              ))}
              {status.cache.rosterNeeds.strengths.map((pos, i) => (
                <span key={i} className="px-2 py-1 bg-green-500/20 text-green-300 text-xs rounded-lg">
                  Strong at {pos}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (status.status === 'analyzing' || status.status === 'pending') {
    return (
      <div className="bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border border-cyan-500/30 rounded-xl p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/30 flex items-center justify-center text-xl animate-pulse">
            🔍
          </div>
          <div className="flex-1">
            <span className="text-cyan-400 font-semibold">AI GM Gathering Intelligence</span>
            <p className="text-sm text-white/70">
              {status.estimatedTime ? `~${status.estimatedTime} seconds remaining` : 'Analyzing your league...'}
            </p>
          </div>
        </div>
        
        <div className="space-y-2">
          <div className="h-2 bg-black/30 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-cyan-500 to-purple-500 transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className={`flex items-center gap-1.5 ${progress > 10 ? 'text-green-400' : 'text-white/40'}`}>
              {progress > 10 ? '✓' : '○'} League settings
            </div>
            <div className={`flex items-center gap-1.5 ${progress > 30 ? 'text-green-400' : 'text-white/40'}`}>
              {progress > 30 ? '✓' : '○'} Trade history
            </div>
            <div className={`flex items-center gap-1.5 ${progress > 50 ? 'text-green-400' : 'text-white/40'}`}>
              {progress > 50 ? '✓' : '○'} Manager profiles
            </div>
            <div className={`flex items-center gap-1.5 ${progress > 70 ? 'text-green-400' : 'text-white/40'}`}>
              {progress > 70 ? '✓' : '○'} Market values
            </div>
          </div>
        </div>
        
        <p className="mt-3 text-xs text-white/50 italic">
          {status.message}
        </p>
      </div>
    )
  }

  return null
}
