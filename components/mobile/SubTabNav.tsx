'use client'

import React, { useRef, useState, useEffect } from 'react'

interface SubTab {
  id: string
  label: string
  icon?: React.ReactNode
  badge?: string
}

interface SubTabNavProps {
  tabs: SubTab[]
  activeTab: string
  onChange: (id: string) => void
}

export default function SubTabNav({ tabs, activeTab, onChange }: SubTabNavProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollRight, setCanScrollRight] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const check = () => {
      setCanScrollRight(el.scrollWidth > el.clientWidth + el.scrollLeft + 4)
    }
    check()
    el.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return () => {
      el.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
    }
  }, [tabs])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const activeBtn = el.querySelector(`[data-tab-id="${activeTab}"]`) as HTMLElement
    if (activeBtn) {
      activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
  }, [activeTab])

  return (
    <div className="relative">
      <div ref={scrollRef} className="w-full overflow-x-auto scrollbar-hide -mx-1 px-1">
        <div className="flex gap-1 p-1 bg-black/20 rounded-xl min-w-max">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                data-tab-id={tab.id}
                onClick={() => onChange(tab.id)}
                className={`flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-medium transition-all duration-150 whitespace-nowrap touch-manipulation min-h-[36px] ${
                  isActive
                    ? 'bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-white border border-cyan-400/25'
                    : 'text-white/45 hover:text-white/70 hover:bg-white/5 active:scale-[0.97]'
                }`}
              >
                {tab.icon && <span className="flex-shrink-0">{tab.icon}</span>}
                <span>{tab.label}</span>
                {tab.badge && (
                  <span className={`px-1 py-0.5 rounded text-[8px] font-semibold uppercase ${
                    tab.badge === 'Chimmy'
                      ? 'bg-purple-500/20 text-purple-300/80'
                      : 'bg-white/10 text-white/50'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
      {canScrollRight && (
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-black/40 to-transparent pointer-events-none rounded-r-xl" />
      )}
    </div>
  )
}
