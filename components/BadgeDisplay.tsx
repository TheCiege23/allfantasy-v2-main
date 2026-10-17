'use client'

import React, { useState, useEffect } from 'react'
import { Award, Lock, Star } from 'lucide-react'

interface Badge {
  id?: string
  type: string
  name: string
  description: string
  tier: string
  xp: number
  icon: string
  earnedAt?: string
  locked?: boolean
}

const tierStyles: Record<string, string> = {
  bronze: 'from-amber-700/30 to-amber-900/20 border-amber-600/30',
  silver: 'from-slate-400/20 to-slate-600/10 border-slate-400/30',
  gold: 'from-yellow-500/20 to-amber-500/10 border-yellow-500/30',
  diamond: 'from-cyan-400/20 to-blue-500/10 border-cyan-400/30',
}

const tierTextColors: Record<string, string> = {
  bronze: 'text-amber-400',
  silver: 'text-slate-300',
  gold: 'text-yellow-400',
  diamond: 'text-cyan-300',
}

export default function BadgeDisplay({ username }: { username: string }) {
  const [badges, setBadges] = useState<Badge[]>([])
  const [available, setAvailable] = useState<Badge[]>([])
  const [totalXP, setTotalXP] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (!username) return

    const fetchBadges = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/legacy/badges?username=${encodeURIComponent(username)}&all=true`)
        if (res.ok) {
          const data = await res.json()
          setBadges(data.badges || [])
          setAvailable(data.available || [])
          setTotalXP(data.totalXP || 0)
        }
      } catch (err) {
        console.warn('Failed to fetch badges:', String(err))
      } finally {
        setLoading(false)
      }
    }

    fetchBadges()
  }, [username])

  if (loading) {
    return <div className="text-center py-4 text-white/40 text-sm">Loading badges...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award size={18} className="text-yellow-400" />
          <span className="text-sm font-semibold text-white">Achievements</span>
        </div>
        <div className="flex items-center gap-2">
          <Star size={14} className="text-yellow-400" />
          <span className="text-sm font-bold text-yellow-400">{totalXP} XP</span>
        </div>
      </div>

      {badges.length === 0 && (
        <div className="text-center py-4">
          <p className="text-white/40 text-sm">No badges earned yet</p>
          <p className="text-white/30 text-xs mt-1">Use AI tools to unlock achievements</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {badges.map(badge => (
          <div
            key={badge.id || badge.type}
            className={`p-3 rounded-xl bg-gradient-to-b ${tierStyles[badge.tier] || tierStyles.bronze} border text-center`}
          >
            <div className="text-2xl mb-1">{badge.icon}</div>
            <div className="text-xs font-semibold text-white truncate">{badge.name}</div>
            <div className={`text-[11px] font-bold uppercase ${tierTextColors[badge.tier] || 'text-white/50'}`}>
              {badge.tier}
            </div>
            <div className="text-[11px] text-white/40 mt-0.5">+{badge.xp} XP</div>
          </div>
        ))}

        {showAll && available.map(badge => (
          <div
            key={badge.type}
            className="p-3 rounded-xl bg-white/5 border border-white/10 text-center opacity-50"
          >
            <div className="text-2xl mb-1 grayscale">
              <Lock size={20} className="mx-auto text-white/30" />
            </div>
            <div className="text-xs font-semibold text-white/40 truncate">{badge.name}</div>
            <div className="text-[11px] text-white/30 uppercase">{badge.tier}</div>
            <div className="text-[11px] text-white/20 mt-0.5">+{badge.xp} XP</div>
          </div>
        ))}
      </div>

      {available.length > 0 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="w-full py-2 text-xs text-white/40 hover:text-white/60 text-center"
        >
          {showAll ? 'Hide locked badges' : `Show ${available.length} locked badges`}
        </button>
      )}
    </div>
  )
}
