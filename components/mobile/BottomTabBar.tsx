'use client'

import React from 'react'
import { Home, ArrowLeftRight, Target, Bell, User } from 'lucide-react'

export type MainTab = 'home' | 'trade' | 'strategy' | 'alerts' | 'profile'

const TAB_CONFIG: Array<{
  id: MainTab
  label: string
  icon: React.ElementType
}> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'trade', label: 'Trade', icon: ArrowLeftRight },
  { id: 'strategy', label: 'Strategy', icon: Target },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'profile', label: 'Profile', icon: User },
]

interface BottomTabBarProps {
  activeTab: MainTab
  onChange: (tab: MainTab) => void
  alertCount?: number
}

export default function BottomTabBar({ activeTab, onChange, alertCount = 0 }: BottomTabBarProps) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-[100] bg-slate-950/95 backdrop-blur-xl border-t border-white/8 safe-area-bottom lg:hidden"
      role="tablist"
      aria-label="Main navigation"
    >
      <div className="flex items-stretch justify-around px-2 h-16">
        {TAB_CONFIG.map((tab) => {
          const isActive = activeTab === tab.id
          const Icon = tab.icon
          const showBadge = tab.id === 'alerts' && alertCount > 0

          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-label={tab.label}
              onClick={() => onChange(tab.id)}
              className="relative flex flex-col items-center justify-center gap-0.5 flex-1 min-w-[64px] touch-manipulation transition-all duration-200 active:scale-95"
            >
              {isActive && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-gradient-to-r from-cyan-400 to-purple-400" />
              )}

              <div className="relative">
                <Icon
                  className={`w-5 h-5 transition-colors duration-200 ${
                    isActive ? 'text-cyan-400' : 'text-white/40'
                  }`}
                />
                {showBadge && (
                  <span className="absolute -top-1 -right-1.5 min-w-[16px] h-4 flex items-center justify-center px-1 rounded-full bg-rose-500 text-[11px] font-bold text-white leading-none">
                    {alertCount > 99 ? '99+' : alertCount}
                  </span>
                )}
              </div>

              <span
                className={`text-[11px] font-medium transition-colors duration-200 ${
                  isActive ? 'text-cyan-300' : 'text-white/35'
                }`}
              >
                {tab.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
