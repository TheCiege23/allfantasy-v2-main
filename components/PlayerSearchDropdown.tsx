'use client'

import React, { useState, useRef, useEffect } from 'react'
import PlayerBadge from '@/components/PlayerBadge'

type PlayerOption = {
  id: string
  name: string
  pos: string
  team?: string
  slot?: string
  isIdp?: boolean
}

interface PlayerSearchDropdownProps {
  players: PlayerOption[]
  onSelect: (player: PlayerOption) => void
  placeholder?: string
  accent?: 'cyan' | 'rose' | 'purple'
}

export default function PlayerSearchDropdown({
  players,
  onSelect,
  placeholder = 'Search for a player...',
  accent = 'cyan',
}: PlayerSearchDropdownProps) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const accentColors = {
    cyan: 'focus:border-cyan-400/60 focus:ring-cyan-400/20',
    rose: 'focus:border-rose-400/60 focus:ring-rose-400/20',
    purple: 'focus:border-purple-400/60 focus:ring-purple-400/20',
  }

  const filtered = query.trim()
    ? players
        .filter((p) =>
          p.name.toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, 12)
    : players.slice(0, 12)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (player: PlayerOption) => {
    onSelect(player)
    setQuery('')
    setIsOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setIsOpen(true)
        }}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder}
        className={`w-full px-4 py-3 bg-black/30 border border-white/10 rounded-2xl text-sm text-white focus:outline-none focus:ring-2 transition ${accentColors[accent]}`}
      />

      {isOpen && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-xl bg-[#1a1a2e] border border-white/10 shadow-2xl">
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleSelect(p)}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.06] transition text-left group"
            >
              <PlayerBadge
                name={p.name}
                sleeperId={p.id}
                position={p.pos}
                team={p.team}
                size="sm"
                showSlot={false}
              />
              {p.slot && (
                <span className="ml-auto text-[11px] text-white/30 group-hover:text-white/50 transition flex-shrink-0">
                  {p.slot}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {isOpen && query.trim() && filtered.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-xl bg-[#1a1a2e] border border-white/10 shadow-2xl p-4 text-center text-sm text-white/40">
          No players found
        </div>
      )}
    </div>
  )
}
