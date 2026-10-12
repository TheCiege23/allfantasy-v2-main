'use client'

/**
 * Survivor league homepage mock — island shell with chat rail, hero, tabs, and workspace cards.
 * Uses static demo data; wire to `/api/leagues/[id]/survivor/summary` and real chat when promoting to production.
 */

import { useMemo, useState } from 'react'
import {
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Compass,
  Crown,
  Eye,
  Flame,
  Gem,
  MessageSquare,
  Moon,
  ScrollText,
  Search,
  Send,
  Settings,
  Shield,
  ShieldCheck,
  Skull,
  Sparkles,
  Trees,
  Trophy,
  Users,
  Vote,
  Zap,
  Link as LinkIcon,
} from 'lucide-react'

type DemoLeague = {
  id: number
  name: string
  phase: string
  players: string
  active: boolean
}

type DemoChatMessage = {
  id: number
  user: string
  role: string
  text: string
  pinned?: boolean
}

type TabDef = {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

export default function SurvivorLeagueHomepage() {
  const leagues = useMemo<DemoLeague[]>(
    () => [
      { id: 1, name: 'KB Survivor: Rooks vs Vets', phase: 'Tribe Phase', players: '20/20', active: true },
      { id: 2, name: 'Survivor: Merge Test', phase: 'Merge', players: '11/20', active: false },
      { id: 3, name: 'Survivor: Exile Variant', phase: 'Week 6', players: '18/20', active: false },
      { id: 4, name: 'Survivor: Jury Sandbox', phase: 'Jury', players: '8/20', active: false },
      { id: 5, name: 'Survivor: Finale Sim', phase: 'Final Council', players: '3/20', active: false },
    ],
    [],
  )

  const chatMessages = useMemo<DemoChatMessage[]>(
    () => [
      {
        id: 1,
        user: 'KingBuffalo',
        role: 'Host',
        text: 'Welcome to the island. Elimination Council opens after MNF and closes Tuesday at 5 PM ET. DM @chimmy with your vote if enabled.',
        pinned: true,
      },
      {
        id: 2,
        user: 'ConnorDraftsEm',
        role: 'Co-Host',
        text: "Tonight's mini-game is live. Tribe challenge: choose winner, O/U, and anytime TD before kickoff.",
      },
      {
        id: 3,
        user: 'AF Bot',
        role: 'System',
        text: 'Shrooms currently lead tribe score by 18.4 points. Individual immunity is still in play for the highest scorer on the losing tribe.',
      },
      {
        id: 4,
        user: 'TheCiege',
        role: 'Player',
        text: 'Is the immunity result revealed before or after votes are cast this week?',
      },
    ],
    [],
  )

  const tabs: TabDef[] = [
    { id: 'home', label: 'Home', icon: Trees },
    { id: 'draft', label: 'Draft', icon: ClipboardList },
    { id: 'roster', label: 'Roster', icon: Shield },
    { id: 'waivers', label: 'Waivers', icon: Zap },
    { id: 'tribal', label: 'Elimination Council', icon: Vote },
    { id: 'jury', label: 'Jury', icon: ScrollText },
    { id: 'exile', label: 'Exile Island', icon: Compass },
    { id: 'settings', label: 'Settings', icon: Settings },
  ]

  const [activeTab, setActiveTab] = useState('home')
  const [isRailCollapsed, setIsRailCollapsed] = useState(false)
  const [selectedLeague, setSelectedLeague] = useState(leagues[0]?.id ?? 1)
  const [message, setMessage] = useState('')

  const selectedLeagueData = leagues.find((l) => l.id === selectedLeague) ?? leagues[0]

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#05130f] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.14),transparent_22%),radial-gradient(circle_at_top_right,rgba(249,115,22,0.14),transparent_20%),radial-gradient(circle_at_bottom_left,rgba(20,184,166,0.10),transparent_18%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent_28%,rgba(0,0,0,0.28)_100%)] opacity-25" />
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[18%] top-10 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute right-[16%] top-24 h-72 w-72 rounded-full bg-orange-500/10 blur-3xl" />
        <div className="absolute bottom-8 left-[45%] h-64 w-64 rounded-full bg-teal-500/10 blur-3xl" />
      </div>

      <div className="relative z-10 flex h-screen w-full">
        <aside className="hidden w-[320px] shrink-0 flex-col border-r border-white/10 bg-black/25 backdrop-blur-xl lg:flex">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-orange-300/80">League Chat</p>
              <h2 className="mt-1 text-lg font-semibold">Island Channel</h2>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-2">
              <MessageSquare className="h-4 w-4 text-white/80" />
            </div>
          </div>

          <div className="border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70">
              <Search className="h-4 w-4 shrink-0" />
              <span>Search island chat</span>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`rounded-2xl border p-3 ${
                  msg.pinned ? 'border-orange-400/30 bg-orange-400/10' : 'border-white/10 bg-white/5'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
                  <span className="font-medium text-white/90">{msg.user}</span>
                  <span>•</span>
                  <span>{msg.role}</span>
                  {msg.pinned ? (
                    <>
                      <span>•</span>
                      <span className="text-orange-300">Pinned</span>
                    </>
                  ) : null}
                </div>
                <p className="mt-2 text-sm leading-6 text-white/85">{msg.text}</p>
              </div>
            ))}
          </div>

          <div className="border-t border-white/10 p-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-2">
              <div className="flex items-end gap-2">
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={2}
                  placeholder="Message the island..."
                  className="w-full resize-none bg-transparent px-2 py-1 text-sm text-white placeholder:text-white/40 focus:outline-none"
                />
                <button
                  type="button"
                  className="rounded-xl bg-orange-400 px-3 py-2 text-slate-950 transition hover:bg-orange-300"
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] px-4 py-4 sm:px-6 lg:px-8">
            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white/5 shadow-2xl shadow-black/30 backdrop-blur-xl">
              <div className="relative overflow-hidden border-b border-white/10">
                <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(34,197,94,0.18),rgba(249,115,22,0.16)_40%,rgba(13,148,136,0.15)_100%)]" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_28%,rgba(255,255,255,0.18),transparent_16%),radial-gradient(circle_at_82%_18%,rgba(255,255,255,0.10),transparent_18%)] opacity-35" />
                <div className="absolute inset-x-0 bottom-0 h-20 bg-[linear-gradient(180deg,transparent,rgba(5,19,15,0.75))]" />
                <div className="absolute bottom-8 left-8 hidden items-center gap-3 opacity-30 lg:flex">
                  <Flame className="h-10 w-10 text-orange-200" aria-hidden />
                  <Trees className="h-10 w-10 text-emerald-200" aria-hidden />
                  <Moon className="h-10 w-10 text-teal-200" aria-hidden />
                </div>

                <div className="relative grid gap-6 px-5 py-6 md:grid-cols-[1.2fr_1fr_auto] md:px-8 md:py-8">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.25em] text-orange-200/80">
                      <span className="rounded-full border border-orange-300/20 bg-orange-300/10 px-3 py-1">Survivor</span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Presented By KingBuffalo</span>
                    </div>
                    <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{selectedLeagueData?.name}</h1>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75 sm:text-base">
                      Outwit. Outplay. Outlast. Tribe warfare, hidden idols, exile secrets, and tribal votes are all wired
                      into a live fantasy island experience.
                    </p>

                    <div className="mt-5 flex flex-wrap gap-3 text-sm">
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                        <p className="text-white/50">Current Phase</p>
                        <p className="mt-1 font-medium">{selectedLeagueData?.phase}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                        <p className="text-white/50">Players Left</p>
                        <p className="mt-1 font-medium">{selectedLeagueData?.players}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                        <p className="text-white/50">Next Tribal</p>
                        <p className="mt-1 font-medium">Tue • 5:00 PM</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center gap-2 text-sm text-white/60">
                        <ShieldCheck className="h-4 w-4 text-emerald-300" />
                        <span>Immunity</span>
                      </div>
                      <p className="mt-2 text-xl font-semibold">Scorps</p>
                      <p className="mt-1 text-sm text-white/55">Winning tribe through Sunday slate</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center gap-2 text-sm text-white/60">
                        <Gem className="h-4 w-4 text-orange-300" />
                        <span>Active Twist</span>
                      </div>
                      <p className="mt-2 text-xl font-semibold">Exile Tokens</p>
                      <p className="mt-1 text-sm text-white/55">Token ladder is live this week</p>
                    </div>
                  </div>

                  <div className="flex justify-between gap-3 md:flex-col md:justify-start">
                    <button
                      type="button"
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-orange-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-orange-300"
                    >
                      <Vote className="h-4 w-4" />
                      Elimination Council
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/15"
                    >
                      <Compass className="h-4 w-4" />
                      Exile Island
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/15"
                    >
                      <Settings className="h-4 w-4" />
                      Settings
                    </button>
                  </div>
                </div>
              </div>

              <div className="border-b border-white/10 px-3 py-2 sm:px-5">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {tabs.map((tab) => {
                    const Icon = tab.icon
                    const isActive = activeTab === tab.id
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`inline-flex items-center gap-2 whitespace-nowrap rounded-2xl px-4 py-2.5 text-sm transition ${
                          isActive
                            ? 'bg-orange-400 font-semibold text-slate-950'
                            : 'border border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {tab.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[1.2fr_0.9fr]">
                <section className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-white/60">Players Remaining</span>
                        <Users className="h-4 w-4 text-emerald-300" />
                      </div>
                      <p className="mt-3 text-3xl font-semibold">13</p>
                      <p className="mt-2 text-sm text-white/60">2 tribes + exile + jury pipeline</p>
                    </div>
                    <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-white/60">Jury Count</span>
                        <ScrollText className="h-4 w-4 text-orange-300" />
                      </div>
                      <p className="mt-3 text-3xl font-semibold">4</p>
                      <p className="mt-2 text-sm text-white/60">Questions unlock at finale</p>
                    </div>
                    <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-white/60">Exile Leader</span>
                        <Trophy className="h-4 w-4 text-teal-300" />
                      </div>
                      <p className="mt-3 text-3xl font-semibold">3 Tokens</p>
                      <p className="mt-2 text-sm text-emerald-300">Return edge available</p>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-white/60">Island Overview</p>
                        <h3 className="mt-1 text-xl font-semibold">Live Survivor State</h3>
                      </div>
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-300">
                        Live
                      </span>
                    </div>

                    <div className="mt-5 grid gap-4 lg:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="flex items-center gap-2 text-sm text-white/60">
                          <Trees className="h-4 w-4 text-emerald-300" />
                          <span>Tribe Status</span>
                        </div>
                        <ul className="mt-4 space-y-2 text-sm text-white/80">
                          <li className="flex justify-between">
                            <span>Scorps</span>
                            <span className="text-emerald-300">Safe</span>
                          </li>
                          <li className="flex justify-between">
                            <span>Shrooms</span>
                            <span className="text-orange-300">At Risk</span>
                          </li>
                          <li className="flex justify-between">
                            <span>Tribe Chats</span>
                            <span>Built</span>
                          </li>
                          <li className="flex justify-between">
                            <span>Merge Countdown</span>
                            <span>2 Weeks</span>
                          </li>
                        </ul>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="flex items-center gap-2 text-sm text-white/60">
                          <CalendarDays className="h-4 w-4 text-orange-300" />
                          <span>Island Roadmap</span>
                        </div>
                        <div className="mt-4 space-y-3 text-sm">
                          {[
                            'Tonight • Mini-game lock before kickoff',
                            'After MNF • Tribal voting opens',
                            'Tuesday 5 PM • Votes lock via @chimmy',
                            'Tuesday 8 PM • Tribal reveal ceremony',
                            'Next Week • Exile token challenge resets',
                          ].map((item) => (
                            <div key={item} className="flex items-center gap-3">
                              <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-orange-300" />
                              <span className="text-white/80">{item}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-white/60">Survivor Workspace</p>
                        <h3 className="mt-1 text-xl font-semibold">Core Modules</h3>
                      </div>
                      <Eye className="h-5 w-5 text-white/40" aria-hidden />
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {(
                        [
                          ['Elimination Council', 'Private vote intake, idol validation, and reveal flow'],
                          ['Mini Games', 'Real-game challenge engine with randomizer support'],
                          ['Exile Island', 'Hidden token ladder and return path tracking'],
                          ['Jury Chamber', 'Questioning, speeches, and final vote flow'],
                        ] as const
                      ).map(([title, desc]) => (
                        <div key={title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                          <p className="font-medium">{title}</p>
                          <p className="mt-2 text-sm leading-6 text-white/60">{desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                <section className="space-y-4">
                  <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-white/60">Host Activity</p>
                        <h3 className="mt-1 text-xl font-semibold">Island Control Center</h3>
                      </div>
                      <Bell className="h-5 w-5 text-orange-300" />
                    </div>
                    <div className="mt-4 space-y-3">
                      {[
                        "1 hidden idol usage window is open for tonight's tribal",
                        'Mini-game submissions from both tribes are still incomplete',
                        'Jury room has 2 pending question drafts for the finale',
                        'Exile Island token board updates after SNF lock',
                      ].map((item, idx) => (
                        <div key={idx} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-white/60">Quick Actions</p>
                        <h3 className="mt-1 text-xl font-semibold">Commissioner Tools</h3>
                      </div>
                      <Sparkles className="h-5 w-5 text-emerald-300" />
                    </div>
                    <div className="mt-4 grid gap-3">
                      {(
                        [
                          { icon: Vote, label: 'Open Tribal Panel' },
                          { icon: Compass, label: 'Manage Exile Island' },
                          { icon: Gem, label: 'Advantages & Idols' },
                          { icon: LinkIcon, label: 'Share League Invite' },
                        ] as const
                      ).map(({ icon: Icon, label }) => (
                        <button
                          key={label}
                          type="button"
                          className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-white/80 transition hover:bg-white/10"
                        >
                          <span className="inline-flex items-center gap-2">
                            <Icon className="h-4 w-4 text-orange-300" />
                            {label}
                          </span>
                          <ChevronRight className="h-4 w-4 text-white/40" />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-white/60">Current Power Read</p>
                        <h3 className="mt-1 text-xl font-semibold">Island Pulse</h3>
                      </div>
                      <Crown className="h-5 w-5 text-teal-300" />
                    </div>
                    <div className="mt-4 space-y-3 text-sm text-white/80">
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <p className="font-medium text-white">Challenge Threat</p>
                        <p className="mt-1 text-white/60">Boston has the highest projected weekly ceiling.</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <p className="font-medium text-white">Social Risk</p>
                        <p className="mt-1 text-white/60">Low-activity players remain the easiest early targets.</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <p className="font-medium text-white">AI Note</p>
                        <p className="mt-1 text-white/60">
                          @chimmy can process votes, idol plays, and mini-game entries this week.
                        </p>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </main>

        <aside
          className={`hidden shrink-0 flex-col border-l border-white/10 bg-black/25 backdrop-blur-xl transition-all duration-300 xl:flex ${
            isRailCollapsed ? 'w-[72px]' : 'w-[300px]'
          }`}
        >
          <div className="flex items-center justify-between border-b border-white/10 p-4">
            {!isRailCollapsed ? (
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-white/50">My Leagues</p>
                <h2 className="mt-1 text-lg font-semibold">League Rail</h2>
              </div>
            ) : (
              <span className="sr-only">My Leagues</span>
            )}
            <button
              type="button"
              onClick={() => setIsRailCollapsed((prev) => !prev)}
              className="rounded-xl border border-white/10 bg-white/5 p-2 transition hover:bg-white/10"
              aria-label={isRailCollapsed ? 'Expand league rail' : 'Collapse league rail'}
            >
              {isRailCollapsed ? (
                <ChevronLeft className="h-4 w-4 text-white/80" />
              ) : (
                <ChevronRight className="h-4 w-4 text-white/80" />
              )}
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {leagues.map((league) => {
              const isActive = league.id === selectedLeague
              return (
                <button
                  key={league.id}
                  type="button"
                  onClick={() => setSelectedLeague(league.id)}
                  className={`w-full rounded-2xl border p-3 text-left transition ${
                    isActive ? 'border-orange-300/30 bg-orange-300/10' : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/10">
                      <Skull className={`h-5 w-5 ${isActive ? 'text-orange-300' : 'text-white/70'}`} />
                    </div>
                    {!isRailCollapsed ? (
                      <div className="min-w-0">
                        <p className="truncate font-medium">{league.name}</p>
                        <p className="mt-1 text-xs text-white/55">
                          {league.phase} • {league.players}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </button>
              )
            })}
          </div>
        </aside>
      </div>
    </div>
  )
}
