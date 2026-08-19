'use client'

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Settings,
  Play,
  RotateCcw,
  Search,
  ChevronDown,
  Clock,
  Shuffle,
  X,
  GripVertical,
  Zap,
  MessageCircle,
  Users,
  ListOrdered,
  LayoutGrid,
  User,
  Maximize2,
  Minimize2,
  Lock,
} from 'lucide-react'
import { getPositionFilterOptionsForSport } from '@/lib/draft-room'

interface DraftRoomProps {
  leagueName: string
  username: string
  leagues: Array<{ league_id: string; name: string; team_count?: number; sport?: string; league_type?: string }>
  selectedLeagueId: string
  onLeagueChange: (id: string) => void
  draftType: 'rookie' | 'vet' | 'both'
  onDraftTypeChange: (v: 'rookie' | 'vet' | 'both') => void
  draftRounds: number
  onDraftRoundsChange: (v: number) => void
  secondsPerPick: number
  onSecondsPerPickChange: (v: number) => void
  draftFormat: 'snake' | 'linear' | 'auction'
  onDraftFormatChange: (v: 'snake' | 'linear' | 'auction') => void
  enable3RR: boolean
  onEnable3RRChange: (v: boolean) => void
  draftStartedAt: number | null
  onStartDraft: () => void
  onResetDraft: () => void
  timerNow: number
  managers: Array<{ id: string; displayName: string; avatar?: string; draftSlot?: number | null }>
  onRandomizeOrder: () => void
  draftPicks: Array<{ overall: number; round: number; slot: number; manager: string; playerName: string; position: string; pickedAt: string }>
  onMakePick: (player: { name: string; position: string; team?: string | null }) => void
  availablePlayers: Array<{ name: string; position: string; team?: string | null; adp?: number }>
  nflPoolLoading: boolean
  rosterSlots?: string[]
  onAiPick?: (managerName: string, teamRoster: any[], available: any[]) => Promise<{ playerName: string; position: string; team: string; reasoning: string } | null>
  onAiDmSuggestion?: (teamRoster: any[], available: any[], round: number, pick: number) => Promise<{ suggestions: any[]; aiInsight: string } | null>
  importedRosters?: Record<string, Array<{ playerId: string; name: string; position: string; team: string }>>
  tradedPicks?: Array<{ season: string; round: number; originalRosterId: number; previousOwner: string; newOwner: string }>
  isRookieDraft?: boolean
  isDynasty?: boolean
  isSF?: boolean
  aiAutoPickMode?: 'off' | 'bpa' | 'needs'
  onAiAutoPickModeChange?: (mode: 'off' | 'bpa' | 'needs') => void
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
  leagueType?: 'redraft' | 'dynasty'
  onLeagueTypeChange?: (v: 'redraft' | 'dynasty') => void
  draftOrderMode?: 'randomize' | 'manual'
  onDraftOrderModeChange?: (v: 'randomize' | 'manual') => void
  onManualOrderChange?: (managerId: string, newSlot: number) => void
  aiAutoQueue?: boolean
  onAiAutoQueueChange?: (v: boolean) => void
  onAiTradePropose?: (fromManager: string, toManager: string, give: string[], receive: string[]) => Promise<{ accepted: boolean; reasoning: string } | null>
  onSleeperImport?: (leagueId: string) => Promise<{ success: boolean; leagueName?: string; teamCount?: number; error?: string }>
  sleeperImportLoading?: boolean
  /** Sport for position filters (NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER). Defaults to NFL. */
  sport?: string
}

const POS_DOT: Record<string, string> = {
  QB: '#ef4444',
  RB: '#10b981',
  WR: '#3b82f6',
  TE: '#f59e0b',
  K: '#a855f7',
  DEF: '#92400e',
  FLEX: '#6366f1',
}

const POS_BG: Record<string, string> = {
  QB: 'rgba(239,68,68,0.15)',
  RB: 'rgba(16,185,129,0.15)',
  WR: 'rgba(59,130,246,0.15)',
  TE: 'rgba(245,158,11,0.15)',
  K: 'rgba(168,85,247,0.15)',
  DEF: 'rgba(146,64,14,0.15)',
  FLEX: 'rgba(99,102,241,0.15)',
}

const POS_TEXT: Record<string, string> = {
  QB: '#fca5a5',
  RB: '#6ee7b7',
  WR: '#93c5fd',
  TE: '#fcd34d',
  K: '#c4b5fd',
  DEF: '#d97706',
  FLEX: '#a5b4fc',
}

const DEFAULT_ROSTER_SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'K', 'DEF']

type MobileTab = 'board' | 'players' | 'myteam'

export default function DraftRoom(props: DraftRoomProps) {
  const {
    leagueName,
    username,
    leagues,
    selectedLeagueId,
    onLeagueChange,
    draftType,
    onDraftTypeChange,
    draftRounds,
    onDraftRoundsChange,
    secondsPerPick,
    onSecondsPerPickChange,
    draftFormat,
    onDraftFormatChange,
    enable3RR,
    onEnable3RRChange,
    draftStartedAt,
    onStartDraft,
    onResetDraft,
    timerNow,
    managers,
    onRandomizeOrder,
    draftPicks,
    onMakePick,
    availablePlayers,
    nflPoolLoading,
    rosterSlots,
    onAiPick,
    onAiDmSuggestion,
    importedRosters,
    tradedPicks,
    isRookieDraft = false,
    isDynasty = false,
    isSF = false,
    aiAutoPickMode = 'off',
    onAiAutoPickModeChange,
    isFullscreen = false,
    onToggleFullscreen,
    leagueType = 'dynasty',
    onLeagueTypeChange,
    draftOrderMode = 'randomize',
    onDraftOrderModeChange,
    onManualOrderChange,
    aiAutoQueue = false,
    onAiAutoQueueChange,
    onAiTradePropose,
    onSleeperImport,
    sleeperImportLoading = false,
  } = props

  const [searchQuery, setSearchQuery] = useState('')
  const [posFilter, setPosFilter] = useState<string>('All')
  const [showDrafted, setShowDrafted] = useState(false)
  const [rookiesOnly, setRookiesOnly] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mobileTab, setMobileTab] = useState<MobileTab>('board')
  const [queue, setQueue] = useState<Array<{ name: string; position: string; team?: string | null }>>([])
  const [tradeProposals, setTradeProposals] = useState<Array<{ id: string; from: string; to: string; give: string[]; receive: string[]; status: 'pending' | 'accepted' | 'declined'; reasoning?: string }>>([])
  const [chatMessages, setChatMessages] = useState<Array<{ from: string; text: string; isPrivate?: boolean; tradeProposal?: { id: string; from: string; to: string; give: string[]; receive: string[]; status: 'pending' | 'accepted' | 'declined'; reasoning?: string } }>>([])
  const [chatInput, setChatInput] = useState('')
  const [showCurrentRoster, setShowCurrentRoster] = useState(false)
  const [aiSuggestionCooldown, setAiSuggestionCooldown] = useState(false)
  const [sleeperImportId, setSleeperImportId] = useState('')
  const [sleeperImportResult, setSleeperImportResult] = useState<{ success: boolean; message: string } | null>(null)

  const settingsRef = useRef<HTMLDivElement>(null)
  const boardScrollRef = useRef<HTMLDivElement>(null)
  const lastTradeProposalPick = useRef<number>(0)

  const slots = rosterSlots && rosterSlots.length > 0 ? rosterSlots : DEFAULT_ROSTER_SLOTS

  const teamCount = managers.length || 12
  const totalPicks = draftRounds * teamCount
  const currentOverall = draftPicks.length + 1
  const draftComplete = draftPicks.length >= totalPicks
  const isDraftStarted = draftStartedAt !== null

  const sortedManagers = useMemo(() => {
    return [...managers].sort((a, b) => {
      const slotA = a.draftSlot ?? 999
      const slotB = b.draftSlot ?? 999
      return slotA - slotB
    })
  }, [managers])

  const getPickManager = useCallback((overall: number): { managerId: string; managerName: string; slot: number } => {
    const round = Math.ceil(overall / teamCount)
    let slotInRound = ((overall - 1) % teamCount)
    const isSnakeRound = draftFormat === 'snake' && round % 2 === 0
    const is3rrRound = enable3RR && round >= 3 && round % 2 === 1
    if (isSnakeRound || is3rrRound) {
      slotInRound = teamCount - 1 - slotInRound
    }
    const mgr = sortedManagers[slotInRound]
    return {
      managerId: mgr?.id || '',
      managerName: mgr?.displayName || `Team ${slotInRound + 1}`,
      slot: slotInRound,
    }
  }, [teamCount, draftFormat, enable3RR, sortedManagers])

  const currentPickInfo = useMemo(() => {
    if (draftComplete || !isDraftStarted) return null
    return getPickManager(currentOverall)
  }, [currentOverall, draftComplete, isDraftStarted, getPickManager])

  const isUserTurn = currentPickInfo?.managerName === username

  const lastPickTime = useMemo(() => {
    if (draftPicks.length === 0) return draftStartedAt || 0
    const last = draftPicks[draftPicks.length - 1]
    return new Date(last.pickedAt).getTime()
  }, [draftPicks, draftStartedAt])

  const timeRemaining = useMemo(() => {
    if (!isDraftStarted || draftComplete) return secondsPerPick
    const elapsed = Math.floor((timerNow - lastPickTime) / 1000)
    return Math.max(0, secondsPerPick - elapsed)
  }, [isDraftStarted, draftComplete, timerNow, lastPickTime, secondsPerPick])

  const draftedNames = useMemo(() => new Set(draftPicks.map(p => p.playerName)), [draftPicks])

  const filteredPlayers = useMemo(() => {
    let players = availablePlayers
    if (!showDrafted) {
      players = players.filter(p => !draftedNames.has(p.name))
    }
    if (posFilter !== 'All') {
      if (posFilter === 'FLEX') {
        players = players.filter(p => ['RB', 'WR', 'TE'].includes(p.position))
      } else {
        players = players.filter(p => p.position === posFilter)
      }
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      players = players.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.team && p.team.toLowerCase().includes(q)) ||
        p.position.toLowerCase().includes(q)
      )
    }
    return players
  }, [availablePlayers, showDrafted, draftedNames, posFilter, searchQuery])

  const myPicks = useMemo(() => {
    return draftPicks.filter(p => p.manager === username)
  }, [draftPicks, username])

  const rosterDisplay = useMemo(() => {
    const filled: Array<{ slot: string; player: typeof myPicks[0] | null }> = slots.map(s => ({ slot: s, player: null }))
    const used = new Set<number>()

    for (const pick of myPicks) {
      const pos = pick.position
      let idx = filled.findIndex((f, i) => !used.has(i) && f.player === null && f.slot === pos)
      if (idx === -1 && ['RB', 'WR', 'TE'].includes(pos)) {
        idx = filled.findIndex((f, i) => !used.has(i) && f.player === null && f.slot === 'FLEX')
      }
      if (idx === -1) {
        idx = filled.findIndex((f, i) => !used.has(i) && f.player === null)
      }
      if (idx !== -1) {
        filled[idx].player = pick
        used.add(idx)
      }
    }
    return filled
  }, [myPicks, slots])

  const posSlotCounts = useMemo(() => {
    const total: Record<string, number> = {}
    const filledCount: Record<string, number> = {}
    for (const s of slots) {
      total[s] = (total[s] || 0) + 1
      filledCount[s] = 0
    }
    for (const r of rosterDisplay) {
      if (r.player) {
        filledCount[r.slot] = (filledCount[r.slot] || 0) + 1
      }
    }
    return { total, filled: filledCount }
  }, [slots, rosterDisplay])

  const positionFilterOptions = useMemo(() => {
    const unique = Array.from(new Set(slots))
    return [{ value: 'All', label: 'All' }, ...unique.map(s => ({ value: s, label: s }))]
  }, [slots])

  useEffect(() => {
    if (aiAutoPickMode === 'off' || !isUserTurn || !isDraftStarted || draftComplete) return
    const undraftedPlayers = availablePlayers.filter(p => !draftedNames.has(p.name))
    if (undraftedPlayers.length === 0) return

    const queuePick = queue.find(q => !draftedNames.has(q.name))
    if (queuePick) {
      const timer = setTimeout(() => {
        onMakePick({ name: queuePick.name, position: queuePick.position, team: queuePick.team })
        setQueue(prev => prev.filter(q => q.name !== queuePick.name))
      }, 500)
      return () => clearTimeout(timer)
    }

    if (aiAutoPickMode === 'bpa') {
      const topPlayer = undraftedPlayers[0]
      if (topPlayer) {
        const timer = setTimeout(() => {
          onMakePick({ name: topPlayer.name, position: topPlayer.position, team: topPlayer.team })
        }, 500)
        return () => clearTimeout(timer)
      }
    }

    if (aiAutoPickMode === 'needs' && onAiPick) {
      const timer = setTimeout(async () => {
        const myRoster = draftPicks
          .filter(p => p.manager === username)
          .map(p => ({ position: p.position }))
        const importedMyRoster = importedRosters?.[username] || []
        const fullRoster = [...importedMyRoster.map(p => ({ position: p.position })), ...myRoster]
        try {
          const result = await onAiPick(username, fullRoster, undraftedPlayers)
          if (result) {
            onMakePick({ name: result.playerName, position: result.position, team: result.team })
            setChatMessages(prev => [...prev, { from: '🤖 Chimmy', text: `Auto-picked ${result.playerName}: ${result.reasoning}` }])
          }
        } catch {
          const fallback = undraftedPlayers[0]
          if (fallback) onMakePick({ name: fallback.name, position: fallback.position, team: fallback.team })
        }
      }, 600)
      return () => clearTimeout(timer)
    }
  }, [aiAutoPickMode, isUserTurn, isDraftStarted, draftComplete, availablePlayers, draftedNames, onMakePick, queue, onAiPick, draftPicks, username, importedRosters])

  useEffect(() => {
    if (!isDraftStarted || draftComplete || isUserTurn || !onAiPick) return
    if (!currentPickInfo) return

    const timer = setTimeout(async () => {
      const managerRoster = draftPicks
        .filter(p => p.manager === currentPickInfo.managerName)
        .map(p => ({ position: p.position }))

      const importedRoster = importedRosters?.[currentPickInfo.managerName] || []
      const fullRoster = [...importedRoster.map(p => ({ position: p.position })), ...managerRoster]

      const undraftedPlayers = availablePlayers.filter(p => !draftedNames.has(p.name))

      try {
        const result = await onAiPick(currentPickInfo.managerName, fullRoster, undraftedPlayers)
        if (result) {
          onMakePick({ name: result.playerName, position: result.position, team: result.team })
          setChatMessages(prev => [...prev, { from: '🤖 Chimmy', text: `${currentPickInfo.managerName} picks ${result.playerName}: ${result.reasoning}` }])
        }
      } catch {
        const fallback = undraftedPlayers[0]
        if (fallback) onMakePick({ name: fallback.name, position: fallback.position, team: fallback.team })
      }
    }, 1200 + Math.random() * 800)

    return () => clearTimeout(timer)
  }, [isDraftStarted, draftComplete, isUserTurn, currentPickInfo, onAiPick, draftPicks, availablePlayers, draftedNames, onMakePick, importedRosters])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!isDraftStarted || draftComplete || !onAiDmSuggestion || aiSuggestionCooldown) return
    if (!currentPickInfo) return

    let picksUntilUserTurn = 0
    let found = false
    for (let i = currentOverall; i <= Math.min(currentOverall + teamCount * 2, totalPicks); i++) {
      const info = getPickManager(i)
      if (info.managerName === username) {
        found = true
        break
      }
      picksUntilUserTurn++
    }
    if (!found || picksUntilUserTurn > 3) return

    const timer = setTimeout(async () => {
      const myRoster = draftPicks
        .filter(p => p.manager === username)
        .map(p => ({ position: p.position }))
      const importedMyRoster = importedRosters?.[username] || []
      const fullRoster = [...importedMyRoster.map(p => ({ position: p.position })), ...myRoster]
      const undraftedPlayers = availablePlayers.filter(p => !draftedNames.has(p.name))
      const round = Math.ceil(currentOverall / teamCount)
      const pick = ((currentOverall - 1) % teamCount) + 1
      try {
        const result = await onAiDmSuggestion(fullRoster, undraftedPlayers, round, pick)
        if (result) {
          const msgs = result.suggestions.map((s: any) => ({
            from: '🔒 Private',
            text: `${s.type === 'need' ? '🎯' : s.type === 'bpa' ? '⭐' : '💰'} ${s.player} (${s.position}) - ${s.reason}`,
            isPrivate: true,
          }))
          if (result.aiInsight) {
            msgs.push({ from: '🔒 Private', text: result.aiInsight, isPrivate: true })
          }
          setChatMessages(prev => [...prev, ...msgs])

          if (aiAutoQueue && result.suggestions) {
            const newQueueItems = result.suggestions
              .map((s: any) => {
                const player = availablePlayers.find(p => p.name === s.player && !draftedNames.has(p.name))
                return player ? { name: player.name, position: player.position, team: player.team } : null
              })
              .filter((p: any): p is NonNullable<typeof p> => p !== null)
            setQueue(prev => {
              const existingNames = new Set(prev.map(q => q.name))
              const toAdd = newQueueItems.filter((p: any) => !existingNames.has(p.name))
              return [...prev, ...toAdd]
            })
          }
        }
      } catch {}
      setAiSuggestionCooldown(true)
      setTimeout(() => setAiSuggestionCooldown(false), 30000)
    }, 2000)

    return () => clearTimeout(timer)
  }, [isDraftStarted, draftComplete, onAiDmSuggestion, aiSuggestionCooldown, currentPickInfo, currentOverall, teamCount, totalPicks, getPickManager, username, draftPicks, importedRosters, availablePlayers, draftedNames, aiAutoQueue])

  useEffect(() => {
    if (!isDraftStarted || draftComplete || !onAiTradePropose) return
    const currentRound = Math.ceil(currentOverall / teamCount)
    if (currentRound < 2) return
    const picksSinceRound2 = currentOverall - (2 * teamCount)
    if (picksSinceRound2 <= 0 || picksSinceRound2 % 5 !== 0) return
    if (lastTradeProposalPick.current >= currentOverall) return
    lastTradeProposalPick.current = currentOverall

    const otherManagers = managers.filter(m => m.displayName !== username)
    if (otherManagers.length === 0) return
    const randomManager = otherManagers[Math.floor(Math.random() * otherManagers.length)]

    const myRoster = draftPicks.filter(p => p.manager === username).map(p => p.playerName)
    const theirRoster = draftPicks.filter(p => p.manager === randomManager.displayName).map(p => p.playerName)
    if (myRoster.length < 2 || theirRoster.length < 2) return

    const give = [myRoster[Math.floor(Math.random() * myRoster.length)]]
    const receive = [theirRoster[Math.floor(Math.random() * theirRoster.length)]]

    const proposalId = `trade-${currentOverall}-${Date.now()}`
    const proposal = {
      id: proposalId,
      from: randomManager.displayName,
      to: username,
      give: receive,
      receive: give,
      status: 'pending' as const,
    }
    setTradeProposals(prev => [...prev, proposal])
    setChatMessages(prev => [...prev, {
      from: '🤖 Trade Bot',
      text: `${randomManager.displayName} proposes a trade!`,
      tradeProposal: proposal,
    }])
  }, [isDraftStarted, draftComplete, onAiTradePropose, currentOverall, teamCount, managers, username, draftPicks])

  const removeFromQueue = (idx: number) => {
    setQueue(prev => prev.filter((_, i) => i !== idx))
  }

  const addToQueue = (player: { name: string; position: string; team?: string | null }) => {
    if (!queue.find(q => q.name === player.name)) {
      setQueue(prev => [...prev, player])
    }
  }

  const moveQueueItem = (from: number, to: number) => {
    setQueue(prev => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  const sendChat = () => {
    if (!chatInput.trim()) return
    setChatMessages(prev => [...prev, { from: username, text: chatInput.trim() }])
    setChatInput('')
  }

  const formatPickLabel = (overall: number) => {
    const round = Math.ceil(overall / teamCount)
    const pickInRound = ((overall - 1) % teamCount) + 1
    return `${round}.${pickInRound.toString().padStart(2, '0')}`
  }

  const picksByCell = useMemo(() => {
    const map: Record<string, typeof draftPicks[0]> = {}
    for (const pick of draftPicks) {
      const key = `${pick.round}-${pick.slot}`
      map[key] = pick
    }
    return map
  }, [draftPicks])

  const headerBar = (
    <div style={{ background: '#1a1d26', borderBottom: '1px solid rgba(255,255,255,0.08)' }} className="px-3 py-2.5 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(14,165,233,0.15)' }}>
          <LayoutGrid className="w-4 h-4" style={{ color: '#0ea5e9' }} />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-bold text-white truncate">{leagueName}</h1>
          <div className="flex items-center gap-2 text-[10px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
            <span>{secondsPerPick}s/pick</span>
            <span>•</span>
            <span>{teamCount} teams</span>
            <span>•</span>
            <span>{draftRounds} rounds</span>
            <span>•</span>
            <span className="capitalize">{draftFormat}</span>
            {enable3RR && <span>• 3RR</span>}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isDraftStarted && !draftComplete && currentPickInfo && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(14,165,233,0.1)', border: '1px solid rgba(14,165,233,0.25)' }}>
            <Clock className="w-3.5 h-3.5" style={{ color: '#0ea5e9' }} />
            <span className="text-sm font-bold" style={{ color: timeRemaining <= 10 ? '#ef4444' : '#0ea5e9' }}>
              {timeRemaining}s
            </span>
            <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {isUserTurn ? 'YOUR PICK' : currentPickInfo.managerName}
            </span>
          </div>
        )}

        {!isDraftStarted ? (
          <button
            onClick={onStartDraft}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white transition hover:brightness-110"
            style={{ background: 'linear-gradient(135deg, #0ea5e9, #06b6d4)' }}
          >
            <Play className="w-3.5 h-3.5" />
            START DRAFT
          </button>
        ) : draftComplete ? (
          <button
            onClick={onResetDraft}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition hover:brightness-110"
            style={{ background: 'rgba(239,68,68,0.2)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            RESET
          </button>
        ) : (
          <button
            onClick={onResetDraft}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' }}
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        )}

        {onToggleFullscreen && (
          <button
            onClick={onToggleFullscreen}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition"
            style={{ background: 'rgba(255,255,255,0.05)' }}
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
            ) : (
              <Maximize2 className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
            )}
          </button>
        )}

        <div className="relative" ref={settingsRef}>
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition"
            style={{ background: settingsOpen ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)' }}
          >
            <Settings className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
          </button>

          {settingsOpen && (
            <div className="absolute right-0 top-10 z-50 w-72 rounded-xl shadow-2xl p-4 space-y-3" style={{ background: '#22252e', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">Draft Settings</span>
                <button type="button" onClick={() => setSettingsOpen(false)}>
                  <X className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.4)' }} />
                </button>
              </div>

              <label className="block">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>Format</span>
                <select
                  value={draftFormat}
                  onChange={e => onDraftFormatChange(e.target.value as any)}
                  className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-xs text-white"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                  disabled={isDraftStarted}
                >
                  <option value="snake">Snake</option>
                  <option value="linear">Linear</option>
                  <option value="auction">Auction</option>
                </select>
              </label>

              <label className="block">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>Rounds</span>
                <select
                  value={draftRounds}
                  onChange={e => onDraftRoundsChange(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-xs text-white"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                  disabled={isDraftStarted}
                >
                  {Array.from({ length: 20 }, (_, i) => i + 1).map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>Seconds per Pick</span>
                <select
                  value={secondsPerPick}
                  onChange={e => onSecondsPerPickChange(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-xs text-white"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  {[15, 30, 45, 60, 90, 120].map(s => (
                    <option key={s} value={s}>{s}s</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>Player Pool</span>
                <select
                  value={draftType}
                  onChange={e => onDraftTypeChange(e.target.value as any)}
                  className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-xs text-white"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                  disabled={isDraftStarted}
                >
                  <option value="both">All Players</option>
                  <option value="rookie">Rookies Only</option>
                  <option value="vet">Veterans Only</option>
                </select>
              </label>

              <label className="block">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>League Type</span>
                <select
                  value={leagueType}
                  onChange={e => onLeagueTypeChange?.(e.target.value as any)}
                  className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-xs text-white"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                  disabled={isDraftStarted}
                >
                  <option value="redraft">Redraft</option>
                  <option value="dynasty">Dynasty</option>
                </select>
              </label>

              <label className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>3rd Round Reversal</span>
                <button
                  onClick={() => onEnable3RRChange(!enable3RR)}
                  className="w-9 h-5 rounded-full transition relative"
                  style={{ background: enable3RR ? '#0ea5e9' : 'rgba(255,255,255,0.15)' }}
                  disabled={isDraftStarted}
                >
                  <div
                    className="w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-all"
                    style={{ left: enable3RR ? '18px' : '3px' }}
                  />
                </button>
              </label>

              <div className="space-y-2">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>Draft Order</span>
                <div className="flex gap-1">
                  {(['randomize', 'manual'] as const).map(mode => (
                    <button type="button" key={mode} onClick={() => { onDraftOrderModeChange?.(mode); if (mode === 'randomize') onRandomizeOrder() }}
                      className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-medium transition"
                      style={{ background: draftOrderMode === mode ? 'rgba(14,165,233,0.2)' : 'rgba(255,255,255,0.04)',
                               color: draftOrderMode === mode ? '#0ea5e9' : 'rgba(255,255,255,0.5)',
                               border: draftOrderMode === mode ? '1px solid rgba(14,165,233,0.3)' : '1px solid transparent' }}
                      disabled={isDraftStarted}
                    >
                      {mode === 'randomize' ? 'Random' : 'Manual'}
                    </button>
                  ))}
                </div>
                {draftOrderMode === 'manual' && !isDraftStarted && (
                  <div className="space-y-1 max-h-48 overflow-auto">
                    {sortedManagers.map((mgr, idx) => (
                      <div key={mgr.id} className="flex items-center gap-2 px-2 py-1 rounded-lg text-[10px]" style={{ background: 'rgba(255,255,255,0.03)' }}>
                        <select value={mgr.draftSlot ?? idx + 1} onChange={e => onManualOrderChange?.(mgr.id, Number(e.target.value))}
                          className="w-10 text-center rounded px-1 py-0.5 text-[10px] text-white" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}>
                          {Array.from({ length: managers.length }, (_, i) => <option key={i+1} value={i+1}>{i+1}</option>)}
                        </select>
                        <span className="text-white truncate flex-1">{mgr.displayName}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {onSleeperImport && !isDraftStarted && (
                <div className="space-y-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <span className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>Import from Sleeper</span>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={sleeperImportId}
                      onChange={e => setSleeperImportId(e.target.value)}
                      placeholder="Sleeper League ID"
                      className="flex-1 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-white/30"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                    />
                    <button
                      onClick={async () => {
                        if (!sleeperImportId.trim()) return
                        setSleeperImportResult(null)
                        const result = await onSleeperImport(sleeperImportId.trim())
                        if (result.success) {
                          setSleeperImportResult({ success: true, message: `Imported${result.leagueName ? ` "${result.leagueName}"` : ''} (${result.teamCount || '?'} teams)` })
                        } else {
                          setSleeperImportResult({ success: false, message: result.error || 'Import failed' })
                        }
                      }}
                      disabled={sleeperImportLoading || !sleeperImportId.trim()}
                      className="px-3 py-1.5 rounded-lg text-[10px] font-bold transition"
                      style={{
                        background: sleeperImportLoading ? 'rgba(255,255,255,0.05)' : 'rgba(14,165,233,0.2)',
                        color: sleeperImportLoading ? 'rgba(255,255,255,0.3)' : '#0ea5e9',
                        border: '1px solid rgba(14,165,233,0.3)',
                      }}
                    >
                      {sleeperImportLoading ? 'Importing...' : 'Import'}
                    </button>
                  </div>
                  {sleeperImportResult && (
                    <div className="text-[10px] px-2 py-1 rounded" style={{
                      background: sleeperImportResult.success ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                      color: sleeperImportResult.success ? '#10b981' : '#ef4444',
                    }}>
                      {sleeperImportResult.message}
                    </div>
                  )}
                  <p className="text-[9px] leading-snug" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    Imports team names, rosters, draft order, and traded picks from your Sleeper league.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  const mobileDraftBoard = (
    <div className="flex-1 overflow-auto" style={{ minHeight: 0, background: '#1a1d26' }}>
      <div className="px-2 py-2 space-y-3">
        {Array.from({ length: draftRounds }, (_, roundIdx) => {
          const round = roundIdx + 1
          return (
            <div key={round}>
              <div className="flex items-center gap-2 mb-1.5 px-1">
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>Round {round}</span>
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
              </div>
              <div className="space-y-1">
                {Array.from({ length: teamCount }, (_, colIdx) => {
                  let actualCol = colIdx
                  const isSnakeRd = draftFormat === 'snake' && round % 2 === 0
                  const is3rrRd = enable3RR && round >= 3 && round % 2 === 1
                  if (isSnakeRd || is3rrRd) {
                    actualCol = teamCount - 1 - colIdx
                  }
                  const overall = (round - 1) * teamCount + colIdx + 1
                  const pickLabel = `${round}.${(colIdx + 1).toString().padStart(2, '0')}`
                  const mgr = sortedManagers[actualCol]
                  const pick = draftPicks.find(p => p.round === round && (p.slot === actualCol + 1 || p.slot === actualCol))
                  const isCurrent = overall === currentOverall && isDraftStarted && !draftComplete

                  const tp = tradedPicks?.find(t => t.round === round && (
                    String(t.originalRosterId) === mgr?.id ||
                    t.previousOwner === mgr?.displayName
                  ))

                  return (
                    <div
                      key={`m-${round}-${colIdx}`}
                      className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
                      style={{
                        background: isCurrent
                          ? 'rgba(14,165,233,0.15)'
                          : pick
                            ? 'rgba(255,255,255,0.04)'
                            : 'rgba(255,255,255,0.02)',
                        border: isCurrent ? '1px solid rgba(14,165,233,0.3)' : '1px solid rgba(255,255,255,0.04)',
                      }}
                    >
                      <div className="w-8 shrink-0 text-center">
                        <span className="text-[10px] font-bold" style={{ color: isCurrent ? '#0ea5e9' : 'rgba(255,255,255,0.3)' }}>
                          {pickLabel}
                        </span>
                      </div>
                      <div className="shrink-0">
                        {mgr?.avatar ? (
                          <img src={mgr.avatar} alt="" className="w-7 h-7 rounded-full" />
                        ) : (
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                            style={{
                              background: isCurrent ? 'rgba(14,165,233,0.3)' : 'rgba(255,255,255,0.1)',
                              color: isCurrent ? '#0ea5e9' : 'rgba(255,255,255,0.5)',
                            }}
                          >
                            {mgr?.displayName?.charAt(0)?.toUpperCase() || '?'}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-medium truncate" style={{ color: isCurrent ? '#0ea5e9' : 'rgba(255,255,255,0.5)' }}>
                            {mgr?.displayName || `Team ${actualCol + 1}`}
                          </span>
                          {isCurrent && (
                            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full shrink-0" style={{ background: 'rgba(14,165,233,0.2)', color: '#0ea5e9' }}>
                              OTC
                            </span>
                          )}
                          {tp && (
                            <span className="text-[8px] shrink-0" style={{ color: '#f59e0b' }}>via {tp.newOwner || '?'}</span>
                          )}
                        </div>
                        {pick ? (
                          <span className="text-[12px] font-semibold text-white truncate block">{pick.playerName}</span>
                        ) : isCurrent ? (
                          <span className="text-[11px] font-medium block" style={{ color: '#0ea5e9' }}>On the clock...</span>
                        ) : (
                          <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.15)' }}>—</span>
                        )}
                      </div>
                      {pick && (
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded shrink-0"
                          style={{ background: POS_BG[pick.position], color: POS_TEXT[pick.position] }}
                        >
                          {pick.position}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  const draftBoard = (
    <div className="flex-1 overflow-hidden" style={{ minHeight: 0 }}>
      <div ref={boardScrollRef} className="overflow-auto h-full" style={{ background: '#1a1d26' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `48px repeat(${teamCount}, minmax(100px, 1fr))`, minWidth: `${48 + teamCount * 100}px` }}>
          <div className="sticky left-0 z-10" style={{ background: '#1a1d26' }} />
          {sortedManagers.map((mgr, colIdx) => {
            const isOTC = currentPickInfo?.slot === colIdx && isDraftStarted && !draftComplete
            return (
              <div
                key={mgr.id}
                className="px-1.5 py-2 text-center border-b"
                style={{
                  background: isOTC ? 'rgba(14,165,233,0.12)' : '#1e2130',
                  borderColor: 'rgba(255,255,255,0.06)',
                  borderLeft: '1px solid rgba(255,255,255,0.04)',
                }}
              >
                <div className="flex flex-col items-center gap-1">
                  {mgr.avatar ? (
                    <img src={mgr.avatar} alt="" className="w-6 h-6 rounded-full" />
                  ) : (
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: isOTC ? 'rgba(14,165,233,0.3)' : 'rgba(255,255,255,0.1)', color: isOTC ? '#0ea5e9' : 'rgba(255,255,255,0.5)' }}>
                      {mgr.displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="text-[9px] font-medium truncate w-full" style={{ color: isOTC ? '#0ea5e9' : 'rgba(255,255,255,0.6)' }}>
                    {mgr.displayName}
                  </span>
                  {isOTC && (
                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(14,165,233,0.2)', color: '#0ea5e9' }}>
                      OTC
                    </span>
                  )}
                </div>
              </div>
            )
          })}

          {Array.from({ length: draftRounds }, (_, roundIdx) => {
            const round = roundIdx + 1
            return (
              <React.Fragment key={round}>
                <div
                  className="sticky left-0 z-10 flex items-center justify-center text-[10px] font-bold border-b"
                  style={{ background: '#1a1d26', color: 'rgba(255,255,255,0.35)', borderColor: 'rgba(255,255,255,0.06)' }}
                >
                  R{round}
                </div>
                {Array.from({ length: teamCount }, (_, colIdx) => {
                  let actualCol = colIdx
                  const isSnakeRd = draftFormat === 'snake' && round % 2 === 0
                  const is3rrRd = enable3RR && round >= 3 && round % 2 === 1
                  if (isSnakeRd || is3rrRd) {
                    actualCol = teamCount - 1 - colIdx
                  }
                  const overall = (round - 1) * teamCount + colIdx + 1
                  const pickLabel = `${round}.${(colIdx + 1).toString().padStart(2, '0')}`
                  const mgr = sortedManagers[actualCol]
                  const pick = draftPicks.find(p => p.round === round && (p.slot === actualCol + 1 || p.slot === actualCol))
                  const isCurrent = overall === currentOverall && isDraftStarted && !draftComplete
                  const posColor = pick ? (POS_DOT[pick.position] || 'rgba(255,255,255,0.3)') : undefined

                  return (
                    <div
                      key={`${round}-${colIdx}`}
                      className="px-1.5 py-1.5 border-b min-h-[44px] flex flex-col justify-center"
                      style={{
                        background: isCurrent
                          ? 'rgba(14,165,233,0.12)'
                          : pick
                            ? 'rgba(255,255,255,0.02)'
                            : 'transparent',
                        borderColor: 'rgba(255,255,255,0.04)',
                        borderLeft: '1px solid rgba(255,255,255,0.04)',
                        boxShadow: isCurrent ? 'inset 0 0 0 1px rgba(14,165,233,0.3)' : undefined,
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[8px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                          {pickLabel}
                          {(() => {
                            const colMgr = sortedManagers[actualCol]
                            const tp = tradedPicks?.find(t => t.round === round && (
                              String(t.originalRosterId) === colMgr?.id ||
                              t.previousOwner === colMgr?.displayName
                            ))
                            return tp ? (
                              <span className="text-[7px] block" style={{ color: '#f59e0b' }}>
                                via {tp.newOwner || '?'}
                              </span>
                            ) : null
                          })()}
                        </span>
                        {pick && (
                          <span className="text-[8px] font-semibold px-1 rounded" style={{ background: POS_BG[pick.position], color: POS_TEXT[pick.position] }}>
                            {pick.position}
                          </span>
                        )}
                      </div>
                      {pick ? (
                        <span className="text-[10px] font-medium text-white truncate mt-0.5">{pick.playerName}</span>
                      ) : isCurrent ? (
                        <span className="text-[9px] font-medium mt-0.5" style={{ color: '#0ea5e9' }}>
                          On the clock...
                        </span>
                      ) : null}
                    </div>
                  )
                })}
              </React.Fragment>
            )
          })}
        </div>
      </div>
    </div>
  )

  const playerListPanel = (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#22252e' }}>
      <div className="px-3 py-2 space-y-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.3)' }} />
            <input
              type="text"
              placeholder="Search players..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs text-white placeholder:text-white/30"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
            />
          </div>
        </div>

        <div className="flex gap-1 flex-wrap">
          {positionFilterOptions.map(({ value: pos, label }) => {
            const isActive = posFilter === pos
            const totalSlots = pos === 'All'
              ? slots.length
              : posSlotCounts.total[pos] || 0
            const filledSlots = pos === 'All'
              ? myPicks.length
              : posSlotCounts.filled[pos] || 0

            return (
              <button
                key={pos}
                onClick={() => setPosFilter(pos)}
                className="px-2 py-1 rounded-md text-[10px] font-medium transition"
                style={{
                  background: isActive ? 'rgba(14,165,233,0.2)' : 'rgba(255,255,255,0.04)',
                  color: isActive ? '#0ea5e9' : 'rgba(255,255,255,0.5)',
                  border: isActive ? '1px solid rgba(14,165,233,0.3)' : '1px solid transparent',
                }}
              >
                {label} {filledSlots}/{totalSlots}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[10px] cursor-pointer" style={{ color: 'rgba(255,255,255,0.45)' }}>
            <input
              type="checkbox"
              checked={showDrafted}
              onChange={e => setShowDrafted(e.target.checked)}
              className="w-3 h-3 rounded"
            />
            SHOW DRAFTED
          </label>
          <label className="flex items-center gap-1.5 text-[10px] cursor-pointer" style={{ color: 'rgba(255,255,255,0.45)' }}>
            <input
              type="checkbox"
              checked={rookiesOnly}
              onChange={e => setRookiesOnly(e.target.checked)}
              className="w-3 h-3 rounded"
            />
            ROOKIES ONLY
          </label>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {nflPoolLoading ? (
          <div className="flex items-center justify-center py-12" style={{ color: 'rgba(255,255,255,0.3)' }}>
            <span className="text-xs">Loading players...</span>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <th className="text-left px-2 py-1.5 text-[9px] font-semibold" style={{ color: 'rgba(255,255,255,0.3)' }}>RK</th>
                <th className="text-left px-2 py-1.5 text-[9px] font-semibold" style={{ color: 'rgba(255,255,255,0.3)' }}>PLAYER</th>
                <th className="text-right px-2 py-1.5 text-[9px] font-semibold" style={{ color: 'rgba(255,255,255,0.3)' }}>ADP</th>
              </tr>
            </thead>
            <tbody>
              {filteredPlayers.slice(0, 200).map((player, idx) => {
                const isDrafted = draftedNames.has(player.name)
                const isQueued = queue.some(q => q.name === player.name)
                return (
                  <tr
                    key={player.name}
                    className="group transition cursor-pointer"
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.03)',
                      opacity: isDrafted ? 0.35 : 1,
                    }}
                    onClick={() => {
                      if (!isDrafted && isDraftStarted && isUserTurn) {
                        onMakePick({ name: player.name, position: player.position, team: player.team })
                      }
                    }}
                    onContextMenu={e => {
                      e.preventDefault()
                      if (!isDrafted) addToQueue(player)
                    }}
                  >
                    <td className="px-2 py-1.5" style={{ color: 'rgba(255,255,255,0.3)' }}>{idx + 1}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: POS_DOT[player.position] || 'rgba(255,255,255,0.3)' }}
                        />
                        <div className="min-w-0">
                          <div className="font-medium text-white truncate group-hover:text-cyan-300 transition">{player.name}</div>
                          <div className="text-[9px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
                            {player.position} • {player.team || '—'}
                          </div>
                        </div>
                        {isQueued && (
                          <span className="text-[8px] px-1 rounded" style={{ background: 'rgba(14,165,233,0.15)', color: '#0ea5e9' }}>Q</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      {player.adp != null ? player.adp.toFixed(1) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )

  const queuePanel = (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#22252e' }}>
      <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="text-xs font-bold text-white">QUEUE</span>
        <div className="flex items-center gap-0.5">
          {(['off', 'bpa', 'needs'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => onAiAutoPickModeChange?.(mode)}
              className="px-1.5 py-0.5 rounded text-[9px] font-medium transition"
              style={{
                background: aiAutoPickMode === mode ? (mode === 'off' ? 'rgba(255,255,255,0.1)' : 'rgba(14,165,233,0.2)') : 'rgba(255,255,255,0.04)',
                color: aiAutoPickMode === mode ? (mode === 'off' ? 'rgba(255,255,255,0.7)' : '#0ea5e9') : 'rgba(255,255,255,0.35)',
                border: aiAutoPickMode === mode ? (mode === 'off' ? '1px solid rgba(255,255,255,0.15)' : '1px solid rgba(14,165,233,0.3)') : '1px solid transparent',
              }}
            >
              {mode === 'off' ? 'OFF' : mode === 'bpa' ? 'BPA' : 'NEEDS'}
            </button>
          ))}
          <button
            onClick={() => onAiAutoQueueChange?.(!aiAutoQueue)}
            className="px-1.5 py-0.5 rounded text-[9px] font-medium transition ml-1"
            style={{
              background: aiAutoQueue ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.04)',
              color: aiAutoQueue ? '#a855f7' : 'rgba(255,255,255,0.35)',
              border: aiAutoQueue ? '1px solid rgba(168,85,247,0.3)' : '1px solid transparent',
            }}
          >
            Auto Q
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-2 py-2 space-y-1">
        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <ListOrdered className="w-8 h-8" style={{ color: 'rgba(255,255,255,0.1)' }} />
            <p className="text-[10px] text-center" style={{ color: 'rgba(255,255,255,0.25)' }}>
              Right-click a player to add to queue
            </p>
          </div>
        ) : (
          queue.map((item, idx) => (
            <div
              key={item.name}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg group"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
            >
              <GripVertical className="w-3 h-3 flex-shrink-0 cursor-grab" style={{ color: 'rgba(255,255,255,0.2)' }} />
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: POS_DOT[item.position] || 'rgba(255,255,255,0.3)' }}
              />
              <div className="flex-1 min-w-0">
                <span className="text-[10px] font-medium text-white truncate block">{item.name}</span>
                <span className="text-[8px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{item.position} • {item.team || '—'}</span>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                {idx > 0 && (
                  <button onClick={() => moveQueueItem(idx, idx - 1)} className="text-[9px] px-1 rounded" style={{ color: 'rgba(255,255,255,0.4)' }}>↑</button>
                )}
                {idx < queue.length - 1 && (
                  <button onClick={() => moveQueueItem(idx, idx + 1)} className="text-[9px] px-1 rounded" style={{ color: 'rgba(255,255,255,0.4)' }}>↓</button>
                )}
                <button onClick={() => removeFromQueue(idx)}>
                  <X className="w-3 h-3" style={{ color: 'rgba(255,255,255,0.3)' }} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )

  const resultsPanel = (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#22252e' }}>
      <div className="flex-1 overflow-auto">
        <div className="px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span className="text-xs font-bold text-white">RESULTS</span>
          <span className="ml-2 text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{myPicks.length}/{slots.length} filled</span>
        </div>
        {isRookieDraft && importedRosters?.[username] && (
          <div className="px-2 py-1" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <button
              onClick={() => setShowCurrentRoster(!showCurrentRoster)}
              className="flex items-center gap-1 text-[10px] font-bold w-full py-1"
              style={{ color: 'rgba(255,255,255,0.5)' }}
            >
              <ChevronDown className={`w-3 h-3 transition ${showCurrentRoster ? '' : '-rotate-90'}`} />
              CURRENT ROSTER ({importedRosters[username].length})
            </button>
            {showCurrentRoster && (
              <div className="space-y-0.5 mt-1">
                {importedRosters[username].map((p, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1 rounded text-[10px]" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <span className="font-bold w-7 text-center py-0.5 rounded text-[8px]" style={{ background: POS_BG[p.position], color: POS_TEXT[p.position] }}>{p.position}</span>
                    <span className="text-white truncate flex-1">{p.name}</span>
                    <span style={{ color: 'rgba(255,255,255,0.3)' }}>{p.team}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="px-2 py-1 space-y-0.5">
          {rosterDisplay.map((item, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
              style={{ background: item.player ? 'rgba(255,255,255,0.03)' : 'transparent' }}
            >
              <span
                className="text-[9px] font-bold w-8 text-center py-0.5 rounded"
                style={{ background: POS_BG[item.slot] || 'rgba(255,255,255,0.05)', color: POS_TEXT[item.slot] || 'rgba(255,255,255,0.5)' }}
              >
                {item.slot}
              </span>
              {item.player ? (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: POS_DOT[item.player.position] || 'rgba(255,255,255,0.3)' }}
                  />
                  <span className="text-[11px] font-medium text-white truncate">{item.player.playerName}</span>
                  <span className="text-[9px] ml-auto" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    {formatPickLabel(item.player.overall)}
                  </span>
                </div>
              ) : (
                <span className="text-[10px] italic" style={{ color: 'rgba(255,255,255,0.2)' }}>Empty</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="px-3 py-2 flex items-center gap-1.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <MessageCircle className="w-3 h-3" style={{ color: 'rgba(255,255,255,0.4)' }} />
          <span className="text-xs font-bold text-white">CHAT</span>
        </div>
        <div className="flex-1 overflow-auto px-3 py-2 space-y-1.5">
          {chatMessages.length === 0 ? (
            <p className="text-[10px] text-center py-4" style={{ color: 'rgba(255,255,255,0.2)' }}>No messages yet</p>
          ) : (
            chatMessages.map((msg, i) => {
              if (msg.tradeProposal) {
                const tp = msg.tradeProposal
                const currentTp = tradeProposals.find(t => t.id === tp.id)
                const status = currentTp?.status || tp.status
                return (
                  <div key={i} className="rounded-lg p-2 space-y-1.5" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                    <div className="text-[10px] font-bold" style={{ color: '#f59e0b' }}>📦 Trade Proposal from {tp.from}</div>
                    <div className="flex gap-2 text-[9px]">
                      <div className="flex-1">
                        <div style={{ color: 'rgba(255,255,255,0.4)' }}>You give:</div>
                        {tp.receive.map((p, j) => <div key={j} className="text-white">{p}</div>)}
                      </div>
                      <div className="flex-1">
                        <div style={{ color: 'rgba(255,255,255,0.4)' }}>You get:</div>
                        {tp.give.map((p, j) => <div key={j} className="text-white">{p}</div>)}
                      </div>
                    </div>
                    {status === 'pending' ? (
                      <div className="flex gap-1">
                        <button
                          onClick={async () => {
                            if (onAiTradePropose) {
                              const result = await onAiTradePropose(tp.from, tp.to, tp.give, tp.receive)
                              const finalStatus = result?.accepted ? 'accepted' : 'declined'
                              setTradeProposals(prev => prev.map(t => t.id === tp.id ? { ...t, status: finalStatus, reasoning: result?.reasoning } : t))
                              setChatMessages(prev => [...prev, { from: '🤖 Trade Bot', text: result?.accepted ? `Trade accepted! ${result?.reasoning || ''}` : `Trade declined. ${result?.reasoning || ''}` }])
                            } else {
                              setTradeProposals(prev => prev.map(t => t.id === tp.id ? { ...t, status: 'accepted' } : t))
                            }
                          }}
                          className="flex-1 px-2 py-1 rounded text-[9px] font-medium"
                          style={{ background: 'rgba(16,185,129,0.2)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => {
                            setTradeProposals(prev => prev.map(t => t.id === tp.id ? { ...t, status: 'declined' } : t))
                            setChatMessages(prev => [...prev, { from: '🤖 Trade Bot', text: 'Trade declined.' }])
                          }}
                          className="flex-1 px-2 py-1 rounded text-[9px] font-medium"
                          style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
                        >
                          Decline
                        </button>
                      </div>
                    ) : (
                      <div className="text-[9px] font-medium" style={{ color: status === 'accepted' ? '#10b981' : '#ef4444' }}>
                        {status === 'accepted' ? '✅ Accepted' : '❌ Declined'}
                        {currentTp?.reasoning && <span className="ml-1" style={{ color: 'rgba(255,255,255,0.5)' }}>— {currentTp.reasoning}</span>}
                      </div>
                    )}
                  </div>
                )
              }

              return (
                <div key={i} className="text-[10px] rounded px-1.5 py-0.5" style={{ background: msg.isPrivate ? 'rgba(168,85,247,0.08)' : 'transparent' }}>
                  {msg.isPrivate && <Lock className="w-2.5 h-2.5 inline mr-0.5" style={{ color: '#a855f7' }} />}
                  <span className="font-medium" style={{ color: msg.isPrivate ? '#a855f7' : '#0ea5e9' }}>{msg.from}: </span>
                  <span style={{ color: 'rgba(255,255,255,0.7)' }}>{msg.text}</span>
                </div>
              )
            })
          )}
        </div>
        <div className="px-2 py-2 flex gap-1.5">
          <input
            type="text"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') sendChat() }}
            placeholder="Type a message..."
            className="flex-1 px-2.5 py-1.5 rounded-lg text-[10px] text-white placeholder:text-white/20"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
          />
          <button
            onClick={sendChat}
            className="px-2.5 py-1.5 rounded-lg text-[10px] font-medium"
            style={{ background: 'rgba(14,165,233,0.15)', color: '#0ea5e9' }}
          >
            Send
          </button>
          <button
            onClick={async () => {
              if (!onAiDmSuggestion) return
              setChatMessages(prev => [...prev, { from: '🤖 Chimmy', text: 'Analyzing your picks...' }])
              const myRoster = draftPicks
                .filter(p => p.manager === username)
                .map(p => ({ position: p.position }))
              const importedMyRoster = importedRosters?.[username] || []
              const fullRoster = [...importedMyRoster.map(p => ({ position: p.position })), ...myRoster]
              const undraftedPlayers = availablePlayers.filter(p => !draftedNames.has(p.name))
              const round = Math.ceil(currentOverall / teamCount)
              const pick = ((currentOverall - 1) % teamCount) + 1
              const result = await onAiDmSuggestion(fullRoster, undraftedPlayers, round, pick)
              if (result) {
                const msgs = result.suggestions.map((s: any) => ({
                  from: '🤖 Chimmy',
                  text: `${s.type === 'need' ? '🎯' : s.type === 'bpa' ? '⭐' : '💰'} ${s.player} (${s.position}) - ${s.reason}`
                }))
                if (result.aiInsight) {
                  msgs.push({ from: '🤖 Chimmy', text: result.aiInsight })
                }
                setChatMessages(prev => [...prev, ...msgs])
              }
            }}
            className="px-2.5 py-1.5 rounded-lg text-[10px] font-medium"
            style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}
            disabled={!isDraftStarted || draftComplete}
          >
            <Zap className="w-3 h-3 inline mr-0.5" />
            Ask Chimmy
          </button>
        </div>
      </div>
    </div>
  )

  const mobileTabBar = (
    <div className="flex md:hidden" style={{ background: '#1e2130', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      {([
        { id: 'board' as MobileTab, label: 'Board', icon: <LayoutGrid className="w-4 h-4" /> },
        { id: 'players' as MobileTab, label: 'Players', icon: <Users className="w-4 h-4" /> },
        { id: 'myteam' as MobileTab, label: 'My Team', icon: <User className="w-4 h-4" /> },
      ]).map(tab => (
        <button
          key={tab.id}
          onClick={() => setMobileTab(tab.id)}
          className="flex-1 flex flex-col items-center gap-0.5 py-2 transition"
          style={{ color: mobileTab === tab.id ? '#0ea5e9' : 'rgba(255,255,255,0.35)' }}
        >
          {tab.icon}
          <span className="text-[9px] font-medium">{tab.label}</span>
        </button>
      ))}
    </div>
  )

  return (
    <div className="flex flex-col h-full w-full" style={{ background: '#1a1d26', color: 'white' }}>
      {headerBar}

      {/* Desktop layout */}
      <div className="hidden md:flex flex-col flex-1 overflow-hidden">
        <div className="flex-[2] overflow-hidden" style={{ minHeight: '200px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {draftBoard}
        </div>

        <div className="flex-[3] flex overflow-hidden" style={{ minHeight: '300px' }}>
          <div className="flex-[3] overflow-hidden" style={{ borderRight: '1px solid rgba(255,255,255,0.06)' }}>
            {playerListPanel}
          </div>
          <div className="flex-[2] overflow-hidden" style={{ borderRight: '1px solid rgba(255,255,255,0.06)' }}>
            {queuePanel}
          </div>
          <div className="flex-[3] overflow-hidden">
            {resultsPanel}
          </div>
        </div>
      </div>

      {/* Mobile layout */}
      <div className="flex md:hidden flex-col flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {mobileTab === 'board' && mobileDraftBoard}
          {mobileTab === 'players' && playerListPanel}
          {mobileTab === 'myteam' && resultsPanel}
        </div>
        {mobileTabBar}
      </div>
    </div>
  )
}