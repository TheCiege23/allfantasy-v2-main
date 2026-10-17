'use client'

import { useState } from 'react'

type Tab = 'players' | 'queue' | 'roster' | 'chat' | 'ai' | 'search'

type Props = {
  tab: Tab
  onTabChange?: (t: Tab) => void
  queueSlot: React.ReactNode
  rosterSlot: React.ReactNode
  chatSlot: React.ReactNode
  /** AI Pick Assistant panel (DraftAISidePanel or similar) */
  aiSlot?: React.ReactNode
  /** Player search / browse panel */
  searchSlot?: React.ReactNode
  /** Player pool / available players panel */
  playersSlot?: React.ReactNode
  /** Whether AI features are enabled for this draft */
  aiEnabled?: boolean
  /** Notification badge count for AI alerts */
  aiAlertCount?: number
}

const TAB_CONFIG: Array<{
  key: Tab
  label: string
  icon?: string
  requiresAI?: boolean
}> = [
  { key: 'players', label: 'Players' },
  { key: 'queue', label: 'Queue' },
  { key: 'roster', label: 'Roster' },
  { key: 'chat', label: 'Chat' },
  { key: 'ai', label: 'AI', icon: '✨', requiresAI: true },
  { key: 'search', label: 'Search', icon: '🔍' },
]

export function DraftRightPanel({
  tab,
  onTabChange,
  queueSlot,
  rosterSlot,
  chatSlot,
  aiSlot,
  searchSlot,
  playersSlot,
  aiEnabled = true,
  aiAlertCount = 0,
}: Props) {
  const [internal, setInternal] = useState<Tab>('queue')
  const active = onTabChange ? tab : internal
  const set = onTabChange ?? ((t: Tab) => setInternal(t))

  // Filter tabs based on available slots and AI enabled
  const visibleTabs = TAB_CONFIG.filter((t) => {
    if (t.requiresAI && !aiEnabled) return false
    if (t.key === 'players' && !playersSlot) return false
    if (t.key === 'search' && !searchSlot) return false
    return true
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col border-l border-white/[0.08] bg-[#0f1521]">
      {/* Tab Bar */}
      <div className="flex shrink-0 border-b border-white/[0.08] overflow-x-auto">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => set(t.key)}
            className={`relative flex-1 min-w-0 px-2 py-2 text-[11px] font-bold uppercase tracking-wide whitespace-nowrap transition-colors ${
              active === t.key
                ? 'border-b-2 border-[#00d4aa] text-[#00d4aa]'
                : 'text-white/45 hover:text-white/65'
            }`}
          >
            <span className="flex items-center justify-center gap-1">
              {t.icon && <span className="text-[11px]">{t.icon}</span>}
              {t.label}
              {/* AI alert badge */}
              {t.key === 'ai' && aiAlertCount > 0 && (
                <span className="absolute -top-0.5 right-1 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-red-500 text-[11px] font-bold text-white px-0.5">
                  {aiAlertCount > 9 ? '9+' : aiAlertCount}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      {/* Panel Content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {active === 'players' && playersSlot}
        {active === 'queue' && queueSlot}
        {active === 'roster' && rosterSlot}
        {active === 'chat' && chatSlot}
        {active === 'ai' && (aiSlot ?? <DefaultAIPanel />)}
        {active === 'search' && (searchSlot ?? <DefaultSearchPanel />)}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Default AI Panel (shown when no custom aiSlot is provided)
// ---------------------------------------------------------------------------

function DefaultAIPanel() {
  return (
    <div className="flex flex-col h-full">
      {/* AI Features Header */}
      <div className="p-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">Draft AI Assistant</span>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#00d4aa]/15 text-[#00d4aa] border border-[#00d4aa]/25 font-medium">
            LIVE
          </span>
        </div>
        <p className="text-[11px] text-white/40 mt-0.5">Real-time picks, ADP, alerts & strategy</p>
      </div>

      {/* AI Feature Sections */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* AI Best Pick */}
        <AIFeatureCard
          icon="🎯"
          title="AI Best Pick"
          description="Get the top recommendation based on your roster needs, ADP value, and league context."
          accentColor="#00d4aa"
          badge="Pick Assistant"
        />

        {/* AI ADP Analysis */}
        <AIFeatureCard
          icon="📊"
          title="AI ADP Insights"
          description="See where players are being drafted vs their AI-computed value. Find steals and avoid reaches."
          accentColor="#3b82f6"
          badge="ADP Engine"
        />

        {/* Tier Break Alerts */}
        <AIFeatureCard
          icon="🔥"
          title="Tier Break Alerts"
          description="Get notified when a tier break occurs — the moment the best available player separates from the pack."
          accentColor="#ef4444"
          badge="Alerts"
        />

        {/* Positional Run Detection */}
        <AIFeatureCard
          icon="🏃"
          title="Positional Run Detection"
          description="AI detects when a positional run starts so you can decide: join the run or exploit the value elsewhere."
          accentColor="#f59e0b"
          badge="Runs"
        />

        {/* Stack Opportunities */}
        <AIFeatureCard
          icon="📈"
          title="Stack Opportunities"
          description="Identify QB-WR or QB-TE stack targets still on the board based on your roster."
          accentColor="#8b5cf6"
          badge="Stacks"
        />

        {/* AI Chat */}
        <AIFeatureCard
          icon="💬"
          title="Ask Chimmy"
          description="Chat with Chimmy about draft strategy, player comparisons, or your next move."
          accentColor="#06b6d4"
          badge="Chimmy Chat"
        />

        {/* Draft Notifications */}
        <AIFeatureCard
          icon="🔔"
          title="Smart Notifications"
          description="Get alerts when your queue players are picked, when it's your turn, and when value falls."
          accentColor="#f97316"
          badge="Notifications"
        />

        {/* Auto-Pick Strategy */}
        <AIFeatureCard
          icon="🤖"
          title="Auto-Pick Settings"
          description="Configure how the AI drafts when you're away: value-first, need-first, or balanced."
          accentColor="#64748b"
          badge="Autopick"
        />
      </div>
    </div>
  )
}

function AIFeatureCard({
  icon,
  title,
  description,
  accentColor,
  badge,
}: {
  icon: string
  title: string
  description: string
  accentColor: string
  badge: string
}) {
  return (
    <div
      className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 hover:bg-white/[0.04] transition-colors cursor-pointer"
      style={{ borderLeftColor: accentColor, borderLeftWidth: '3px' }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm">{icon}</span>
        <span className="text-xs font-semibold text-white">{title}</span>
        <span
          className="text-[11px] px-1.5 py-0.5 rounded font-medium ml-auto"
          style={{
            backgroundColor: `${accentColor}15`,
            color: accentColor,
            borderColor: `${accentColor}40`,
            borderWidth: '1px',
          }}
        >
          {badge}
        </span>
      </div>
      <p className="text-[11px] text-white/40 leading-relaxed">{description}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Default Search Panel
// ---------------------------------------------------------------------------

function DefaultSearchPanel() {
  const [query, setQuery] = useState('')

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-white/[0.06]">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search players by name, position, team..."
            className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-[#00d4aa]/50 focus:ring-1 focus:ring-[#00d4aa]/25"
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 text-xs">🔍</span>
        </div>

        {/* Quick position filters */}
        <div className="flex gap-1 mt-2 overflow-x-auto pb-0.5">
          {['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'IDP'].map((pos) => (
            <button
              key={pos}
              className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.05] text-white/50 hover:bg-white/[0.10] hover:text-white/70 transition-colors whitespace-nowrap"
            >
              {pos}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {query.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-white/30 text-xs">Type a player name to search</p>
            <p className="text-white/20 text-[11px] mt-1">Or use position filters above</p>
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-white/30 text-xs">Searching for &quot;{query}&quot;...</p>
          </div>
        )}
      </div>
    </div>
  )
}

export { QueuePanel } from './QueuePanel'
export { RosterPanel } from './RosterPanel'
export { DraftChatPanel } from './DraftChatPanel'
