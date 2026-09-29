'use client'

import React from 'react'
import type { MainTab } from './BottomTabBar'

interface MobileSectionHeaderProps {
  mainTab: MainTab
  username?: string
}

const sectionInfo: Record<MainTab, { title: string; subtitle: string }> = {
  home: { title: 'Home', subtitle: 'Your career overview' },
  trade: { title: 'Trade Center', subtitle: 'AI-powered trade tools' },
  strategy: { title: 'Strategy', subtitle: 'Plan your season' },
  alerts: { title: 'Alerts', subtitle: 'Market timing signals' },
  profile: { title: 'Profile', subtitle: 'Chat, share & settings' },
}

export default function MobileSectionHeader({ mainTab, username }: MobileSectionHeaderProps) {
  const info = sectionInfo[mainTab]

  return (
    <div className="lg:hidden mb-4 flex items-center justify-between">
      <div>
        <h2 className="text-lg font-bold text-white">{info.title}</h2>
        <p className="text-[11px] text-white/40">{info.subtitle}</p>
      </div>
      {username && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/8">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center text-[11px] font-bold text-white">
            {username.charAt(0).toUpperCase()}
          </div>
          <span className="text-xs text-white/60 max-w-[80px] truncate">{username}</span>
        </div>
      )}
    </div>
  )
}
