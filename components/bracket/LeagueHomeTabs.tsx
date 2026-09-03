"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import dynamic from "next/dynamic"
import { Trophy, ChevronDown, MessageCircle, Pin, Send, X, Share2, Copy, Check, Settings, Zap, Crown, Shield } from "lucide-react"
import { BracketTreeView } from "./BracketTreeView"
import { PoolStandings } from "./PoolStandings"
import { GameScores } from "./GameScores"
import { PoolBrackets } from "./PoolBrackets"
import { PoolChat } from "./PoolChat"

// Deferred: only rendered on the "live" tab, pulls in framer-motion.
const LiveModeView = dynamic(() => import("./LiveModeView").then((m) => m.LiveModeView), { ssr: false })
import { useBracketLive } from "@/lib/hooks/useBracketLive"
import CopyJoinCode from "@/app/brackets/leagues/[leagueId]/CopyJoinCode"
import CreateEntryButton from "@/app/brackets/leagues/[leagueId]/CreateEntryButton"
import { LeagueInviteShareButtons } from "./LeagueInviteShareButtons"
import { PaidLeagueNotice } from "@/components/legal/PaidLeagueNotice"
import { CommissionerFanCredSetupNotice } from "@/components/legal/CommissionerFanCredSetupNotice"

type Member = {
  id: string
  userId: string
  role: string
  user: { id: string; displayName: string | null; email: string }
}

type Entry = {
  id: string
  userId: string
  name: string
  createdAt: string
  insuredNodeId?: string | null
  user: { id: string; displayName: string | null; email: string }
}

type BracketNode = {
  id: string
  slot: string
  round: number
  region: string | null
  seedHome: number | null
  seedAway: number | null
  homeTeamName: string | null
  awayTeamName: string | null
  sportsGameId: string | null
  nextNodeId: string | null
  nextNodeSide: string | null
  game: any
}

type Props = {
  leagueId: string
  tournamentId: string
  currentUserId: string
  isOwner: boolean
  members: Member[]
  entries: Entry[]
  userEntries: Entry[]
  nodes: BracketNode[]
  initialPicks: Record<string, Record<string, string | null>>
  joinCode: string
  maxManagers: number
  scoringMode?: string
  scoringRules?: {
    insuranceEnabled?: boolean
    upsetDeltaEnabled?: boolean
    leverageBonusEnabled?: boolean
    insuranceAllowedRounds?: number[]
    [key: string]: any
  }
}

type TabId = "pool" | "brackets" | "live" | "feed" | "global" | "public"

const TABS: { id: TabId; label: string }[] = [
  { id: "pool", label: "HOME" },
  { id: "brackets", label: "MY BRACKETS" },
  { id: "live", label: "LIVE" },
  { id: "feed", label: "CHAT" },
  { id: "global", label: "GLOBAL" },
  { id: "public", label: "PUBLIC" },
]

export function LeagueHomeTabs(props: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("pool")
  const [activeEntryId, setActiveEntryId] = useState<string>(
    props.userEntries[0]?.id ?? ""
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(true)

  const isCommissioner = useMemo(() => {
    if (props.isOwner) return true
    const member = props.members.find(m => m.userId === props.currentUserId)
    return member?.role === "CO_COMMISSIONER"
  }, [props.isOwner, props.members, props.currentUserId])

  const { data: live } = useBracketLive({
    tournamentId: props.tournamentId,
    leagueId: props.leagueId,
    enabled: true,
    intervalMs: 12000,
  })

  const standings = (live?.standings ?? []) as any[]
  const games = (live?.games ?? []) as any[]

  const activePicks = activeEntryId ? (props.initialPicks[activeEntryId] ?? {}) : {}

  return (
    <div className="space-y-0 relative pb-16">
      <div className="mb-4 grid gap-2 sm:grid-cols-4 sm:gap-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="text-[11px] mode-muted">Your Entries</div>
          <div className="text-base font-semibold mode-text">{props.userEntries.length}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="text-[11px] mode-muted">Pool Entries</div>
          <div className="text-base font-semibold mode-text">{props.entries.length}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="text-[11px] mode-muted">Members</div>
          <div className="text-base font-semibold mode-text">{props.members.length}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="text-[11px] mode-muted">Scoring</div>
          <div className="text-base font-semibold mode-text">{normalizeScoringMode(props.scoringMode)}</div>
        </div>
      </div>
      <div className="mb-4 flex items-center gap-0 overflow-x-auto [scrollbar-width:none]" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="relative shrink-0 px-4 py-3 text-xs font-semibold tracking-wide transition-colors sm:px-6 sm:text-sm"
              style={{ color: isActive ? 'var(--text)' : 'var(--muted2)' }}
              data-testid={`bracket-tab-${tab.id}`}
            >
              {tab.label}
              {isActive && (
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full" style={{ background: '#fb923c' }} />
              )}
            </button>
          )
        })}
      </div>

      <div>
        {activeTab === "pool" && (
          <PoolTab
            {...props}
            activeEntryId={activeEntryId}
            setActiveEntryId={setActiveEntryId}
            activePicks={activePicks}
            standings={standings}
            games={games}
            settingsOpen={settingsOpen}
            setSettingsOpen={setSettingsOpen}
            inviteOpen={inviteOpen}
            setInviteOpen={setInviteOpen}
          />
        )}
        {activeTab === "brackets" && (
          <PoolBrackets
            standings={standings}
            nodes={props.nodes}
            tournamentId={props.tournamentId}
            leagueId={props.leagueId}
            currentUserId={props.currentUserId}
            allPicks={props.initialPicks}
          />
        )}
        {activeTab === "live" && (
          <LiveModeView
            games={games}
            standings={standings}
            currentUserId={props.currentUserId}
            scoringMode={props.scoringMode}
          />
        )}
        {activeTab === "feed" && (
          <FeedTab tournamentId={props.tournamentId} leagueId={props.leagueId} />
        )}
        {activeTab === "global" && (
          <GlobalTab tournamentId={props.tournamentId} currentUserId={props.currentUserId} />
        )}
        {activeTab === "public" && (
          <PublicPoolsTab tournamentId={props.tournamentId} />
        )}
      </div>

      <PoolChat
        leagueId={props.leagueId}
        currentUserId={props.currentUserId}
        members={props.members}
      />
    </div>
  )
}

function PoolTab({
  nodes,
  tournamentId,
  leagueId,
  activeEntryId,
  setActiveEntryId,
  activePicks,
  userEntries,
  currentUserId,
  entries,
  standings,
  games,
  settingsOpen,
  setSettingsOpen,
  inviteOpen,
  setInviteOpen,
  joinCode,
  isOwner,
  maxManagers,
  members,
  scoringMode,
  scoringRules,
}: Props & {
  activeEntryId: string
  setActiveEntryId: (id: string) => void
  activePicks: Record<string, string | null>
  standings: any[]
  games: any[]
  settingsOpen: boolean
  setSettingsOpen: (v: boolean) => void
  inviteOpen: boolean
  setInviteOpen: (v: boolean) => void
}) {
  const totalPicks = Object.values(activePicks).filter(Boolean).length
  const totalGames = nodes.filter(n => n.round >= 1).length

  return (
    <div className="space-y-4">
      {userEntries.length > 0 ? (
        <div className="space-y-3">
          {userEntries.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Viewing:</label>
              <div className="relative">
                <select
                  value={activeEntryId}
                  onChange={(e) => setActiveEntryId(e.target.value)}
                  className="appearance-none rounded-xl px-4 py-2 pr-8 text-sm text-white outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  {userEntries.map((e) => (
                    <option key={e.id} value={e.id} style={{ background: '#0d1117' }}>
                      {e.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" style={{ color: 'rgba(255,255,255,0.3)' }} />
              </div>
            </div>
          )}

          <BracketTreeView
            tournamentId={tournamentId}
            leagueId={leagueId}
            entryId={activeEntryId}
            nodes={nodes}
            initialPicks={activePicks}
            compact
            insuranceEnabled={scoringRules?.insuranceEnabled === true}
            insuranceAllowedRounds={[1, 3, 4, 5, 6]}
            initialInsuredNodeId={userEntries.find(e => e.id === activeEntryId)?.insuredNodeId}
          />
          <div className="text-center">
            <p className="text-sm">
              Tap to fill out your bracket <span className="font-bold" style={{ color: '#fb923c' }}>{totalPicks}</span> out of <span className="font-bold">{totalGames}</span>
            </p>
            <p className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Brackets lock when first round games begin
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl p-8 text-center space-y-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <Trophy className="h-12 w-12 mx-auto" style={{ color: 'rgba(251,146,60,0.5)' }} />
          <div>
            <h3 className="text-lg font-semibold">Fill Out Your Bracket</h3>
            <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Create an entry to start picking winners
            </p>
          </div>
          <CreateEntryButton leagueId={leagueId} tiebreakerEnabled={Boolean(scoringRules?.tiebreakerEnabled)} />
        </div>
      )}

      <InviteSection joinCode={joinCode} inviteOpen={inviteOpen} setInviteOpen={setInviteOpen} members={members} />

      <button
        onClick={() => setSettingsOpen(!settingsOpen)}
        className="w-full rounded-xl px-5 py-3.5 flex items-center justify-center gap-2 text-sm font-semibold transition"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)' }}
        data-testid="bracket-settings-toggle-button"
      >
        SETTINGS & RULES
        <ChevronDown className={`h-4 w-4 transition-transform ${settingsOpen ? "rotate-180" : ""}`} />
      </button>

      {settingsOpen && (
        <SettingsPanel
          joinCode={joinCode}
          isOwner={isOwner}
          leagueId={leagueId}
          maxManagers={maxManagers}
          scoringMode={normalizeScoringMode(scoringMode)}
          scoringRules={scoringRules}
          members={members}
          currentUserId={currentUserId}
        />
      )}

      <GameScores games={games} />

      <PoolStandings
        standings={standings}
        currentUserId={currentUserId}
        totalEntries={entries.length}
      />
    </div>
  )
}

function InviteSection({
  joinCode,
  inviteOpen,
  setInviteOpen,
  members,
}: {
  joinCode: string
  inviteOpen: boolean
  setInviteOpen: (v: boolean) => void
  members: Member[]
}) {
  const [copied, setCopied] = useState(false)
  const inviteUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/brackets/join?code=${joinCode}`
    : `/brackets/join?code=${joinCode}`

  function copyLink() {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <button
        onClick={() => setInviteOpen(!inviteOpen)}
        className="w-full px-4 py-3 flex items-center justify-center gap-2 text-sm font-semibold"
        style={{ color: 'rgba(255,255,255,0.7)' }}
        data-testid="bracket-invite-toggle-button"
      >
        INVITE TO POOL
        <ChevronDown className={`h-4 w-4 transition-transform ${inviteOpen ? "rotate-180" : ""}`} />
      </button>

      {inviteOpen && (
        <div className="px-4 pb-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {members.slice(0, 5).map((m) => (
              <div
                key={m.id}
                className="w-9 h-9 rounded-full flex items-center justify-center text-[10px] font-bold"
                style={{ background: 'rgba(251,146,60,0.12)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.2)' }}
              >
                {(m.user.displayName || m.user.email || '?').slice(0, 2).toUpperCase()}
              </div>
            ))}
            {members.length > 5 && (
              <div className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>+{members.length - 5}</div>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div
              className="flex-1 rounded-lg px-3 py-2 text-xs truncate"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(251,146,60,0.3)', color: 'rgba(255,255,255,0.5)' }}
            >
              {inviteUrl}
            </div>
            <button
              onClick={copyLink}
              className="p-2 rounded-lg transition"
              style={{ background: 'rgba(251,146,60,0.15)', color: '#fb923c' }}
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
            <button
              onClick={() => {
                if (navigator.share) {
                  navigator.share({ title: 'Join my March Madness pool!', url: inviteUrl })
                } else {
                  copyLink()
                }
              }}
              className="p-2 rounded-lg transition"
              style={{ background: 'rgba(251,146,60,0.15)', color: '#fb923c' }}
            >
              <Share2 className="w-4 h-4" />
            </button>
          </div>
          <div className="pt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Share via</p>
            <LeagueInviteShareButtons inviteUrl={inviteUrl} message="Join my bracket pool on AllFantasy!" />
          </div>
        </div>
      )}
    </div>
  )
}

type ScoringMode = 'fancred_edge' | 'momentum' | 'accuracy_boldness' | 'streak_survival'

const VALID_SCORING_MODES: ScoringMode[] = ['fancred_edge', 'momentum', 'accuracy_boldness', 'streak_survival']

function normalizeScoringMode(raw: string | undefined | null): ScoringMode {
  if (raw && VALID_SCORING_MODES.includes(raw as ScoringMode)) return raw as ScoringMode
  if (raw === 'standard' || raw === 'upset_bonus') return 'momentum'
  if (raw === 'seed_weighted') return 'accuracy_boldness'
  return 'fancred_edge'
}

const SCORING_MODES: { id: ScoringMode; label: string; desc: string }[] = [
  { id: 'fancred_edge', label: 'AF Edge', desc: 'Upset delta + leverage bonus + insurance' },
  { id: 'momentum', label: 'Momentum', desc: 'Round base + seed-gap upset bonus' },
  { id: 'accuracy_boldness', label: 'Accuracy + Boldness', desc: 'Round base + uniqueness bonus within league' },
  { id: 'streak_survival', label: 'Streak & Survival', desc: 'Streak bonuses scaling deeper' },
]

function getDefaultRoundPoints(mode: ScoringMode): Record<number, number> {
  if (mode === "fancred_edge") return { 1: 1, 2: 2, 3: 5, 4: 10, 5: 18, 6: 30 }
  return { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32 }
}

function normalizeRoundPoints(raw: any, mode: ScoringMode): Record<number, number> {
  const fallback = getDefaultRoundPoints(mode)
  if (!raw || typeof raw !== "object") return fallback
  const out: Record<number, number> = { ...fallback }
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const round = Number(k)
    const value = Number(v)
    if (Number.isFinite(round) && Number.isFinite(value) && round >= 1 && round <= 6) {
      out[round] = Math.max(0, Math.round(value))
    }
  }
  return out
}

function getScoringTable(mode: ScoringMode) {
  if (mode === 'fancred_edge') {
    return [
      { round: "Round of 64 (32)", pts: "1 + upset + leverage", total: "32+" },
      { round: "Round of 32 (16)", pts: "2 + upset + leverage", total: "32+" },
      { round: "Sweet 16 (8)", pts: "5 + upset + leverage", total: "40+" },
      { round: "Elite 8 (4)", pts: "10 + upset + leverage", total: "40+" },
      { round: "Final Four (2)", pts: "18 + upset + leverage", total: "36+" },
      { round: "Championship (1)", pts: "30 + upset + leverage", total: "30+" },
    ]
  }
  if (mode === 'momentum') {
    return [
      { round: "Round 1 (32)", pts: "1 + upset bonus", total: "32+" },
      { round: "Round 2 (16)", pts: "2 + upset bonus", total: "32+" },
      { round: "Sweet 16 (8)", pts: "4 + upset bonus", total: "32+" },
      { round: "Elite 8 (4)", pts: "8 + upset bonus", total: "32+" },
      { round: "Final Four (2)", pts: "16 + upset bonus", total: "32+" },
      { round: "Championship (1)", pts: "32 + upset bonus", total: "32+" },
    ]
  }
  if (mode === 'accuracy_boldness') {
    return [
      { round: "Round 1 (32)", pts: "1 + uniqueness bonus", total: "32+" },
      { round: "Round 2 (16)", pts: "2 + uniqueness bonus", total: "32+" },
      { round: "Sweet 16 (8)", pts: "4 + uniqueness bonus", total: "32+" },
      { round: "Elite 8 (4)", pts: "8 + uniqueness bonus", total: "32+" },
      { round: "Final Four (2)", pts: "16 + uniqueness bonus", total: "32+" },
      { round: "Championship (1)", pts: "32 + uniqueness bonus", total: "32+" },
    ]
  }
  if (mode === 'streak_survival') {
    return [
      { round: "Round 1 (32)", pts: "1 x streak mult", total: "32+" },
      { round: "Round 2 (16)", pts: "2 x streak mult", total: "32+" },
      { round: "Sweet 16 (8)", pts: "4 x streak mult", total: "32+" },
      { round: "Elite 8 (4)", pts: "8 x streak mult", total: "32+" },
      { round: "Final Four (2)", pts: "16 x streak mult", total: "32+" },
      { round: "Championship (1)", pts: "32 x streak mult", total: "32+" },
    ]
  }
  return [
    { round: "Round 1 (32)", pts: "1", total: "32" },
    { round: "Round 2 (16)", pts: "2", total: "32" },
    { round: "Sweet 16 (8)", pts: "4", total: "32" },
    { round: "Elite 8 (4)", pts: "8", total: "32" },
    { round: "Final Four (2)", pts: "16", total: "32" },
    { round: "Championship (1)", pts: "32", total: "32" },
  ]
}

function SettingsPanel({
  joinCode,
  isOwner,
  leagueId,
  maxManagers,
  scoringMode: initialScoringMode,
  scoringRules,
  members,
  currentUserId,
}: {
  joinCode: string
  isOwner: boolean
  leagueId: string
  maxManagers: number
  scoringMode: ScoringMode
  scoringRules?: { insuranceEnabled?: boolean; upsetDeltaEnabled?: boolean; leverageBonusEnabled?: boolean; [key: string]: any }
  members?: Member[]
  currentUserId?: string
}) {
  const isPaidLeague = Boolean(scoringRules?.isPaidLeague)
  const [scoringMode, setScoringMode] = useState<ScoringMode>(initialScoringMode)
  const [saving, setSaving] = useState(false)
  const [roundPoints, setRoundPoints] = useState<Record<number, number>>(
    normalizeRoundPoints(scoringRules?.roundPoints, initialScoringMode)
  )
  const [savingRoundPoints, setSavingRoundPoints] = useState(false)
  const [localJoinCode, setLocalJoinCode] = useState(joinCode)
  const [regenLoading, setRegenLoading] = useState(false)

  const canEdit = useMemo(() => {
    if (isOwner) return true
    if (!members || !currentUserId) return false
    const member = members.find(m => m.userId === currentUserId)
    return member?.role === "CO_COMMISSIONER"
  }, [isOwner, members, currentUserId])

  async function updateScoringMode(mode: ScoringMode) {
    setScoringMode(mode)
    if (!canEdit) return
    setSaving(true)
    try {
      await fetch(`/api/bracket/leagues/${leagueId}/manage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: "update_rules",
          scoringRules: { scoringMode: mode },
        }),
      })
    } catch {}
    setSaving(false)
    if (!scoringRules?.roundPoints) {
      setRoundPoints(getDefaultRoundPoints(mode))
    }
  }

  async function saveRoundPoints() {
    if (!canEdit) return
    setSavingRoundPoints(true)
    try {
      await fetch(`/api/bracket/leagues/${leagueId}/manage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: "update_rules",
          scoringRules: { roundPoints },
        }),
      })
    } catch {}
    setSavingRoundPoints(false)
  }

  async function regenerateJoinCode() {
    if (!canEdit) return
    setRegenLoading(true)
    try {
      const res = await fetch(`/api/bracket/leagues/${leagueId}/manage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "regenerate_join_code" }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.joinCode) {
        setLocalJoinCode(data.joinCode)
      }
    } catch {
      // swallow for now; future: surface toast
    } finally {
      setRegenLoading(false)
    }
  }

  const scoring = getScoringTable(scoringMode)

  return (
    <div className="space-y-3" id="settings-rules" data-testid="bracket-settings-rules">
      {isPaidLeague ? (
        <>
          <PaidLeagueNotice
            compact
            showFanCredCta
            ctaLabel="Pay League Dues on FanCred →"
            ctaTestId="bracket-settings-fancred-link"
            dataTestId="bracket-settings-paid-boundary-notice"
          />
          <CommissionerFanCredSetupNotice
            dataTestId="bracket-settings-commissioner-setup-notice"
            showFanCredLink
          />
        </>
      ) : null}
      <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="px-4 py-3 flex items-center gap-4 text-sm" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <div className="flex items-center gap-2" style={{ color: 'rgba(255,255,255,0.6)' }}>
            <Settings className="w-4 h-4" />
            Unlimited Brackets
          </div>
          <div style={{ color: 'rgba(255,255,255,0.6)' }}>Show Champ Pick</div>
        </div>

        <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Scoring Mode {saving && <span style={{ color: '#fb923c' }}>(saving...)</span>}
          </div>
          <div className="flex gap-2">
            {SCORING_MODES.map(m => (
              <button
                key={m.id}
                onClick={() => canEdit && updateScoringMode(m.id)}
                className="flex-1 rounded-lg py-2 px-2 text-center transition-all"
                style={{
                  background: scoringMode === m.id ? 'rgba(251,146,60,0.12)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${scoringMode === m.id ? 'rgba(251,146,60,0.3)' : 'rgba(255,255,255,0.06)'}`,
                  cursor: canEdit ? 'pointer' : 'default',
                  opacity: !canEdit && scoringMode !== m.id ? 0.4 : 1,
                }}
              >
                <div className="text-[10px] font-bold" style={{ color: scoringMode === m.id ? '#fb923c' : 'rgba(255,255,255,0.6)' }}>
                  {m.label}
                </div>
                <div className="text-[8px] mt-0.5" style={{ color: 'rgba(255,255,255,0.25)' }}>
                  {m.desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <th className="text-left px-4 py-2 text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.4)' }}>ROUND (# GAMES)</th>
              <th className="text-center px-4 py-2 text-xs font-semibold" style={{ color: '#fb923c' }}>PTS PER CORRECT</th>
              <th className="text-center px-4 py-2 text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.4)' }}>TOTAL POINTS</th>
            </tr>
          </thead>
          <tbody>
            {scoring.map((s) => (
              <tr key={s.round} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                <td className="px-4 py-2 text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>{s.round}</td>
                <td className="text-center px-4 py-2 text-xs font-bold" style={{ color: '#fb923c' }}>{s.pts}</td>
                <td className="text-center px-4 py-2 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>{s.total}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Round Points Override
            </div>
            {savingRoundPoints && <span className="text-[10px]" style={{ color: '#fb923c' }}>saving...</span>}
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {[1, 2, 3, 4, 5, 6].map((round) => (
              <label key={round} className="text-[10px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
                R{round}
                <input
                  type="number"
                  min={0}
                  value={roundPoints[round] ?? 0}
                  onChange={(e) => setRoundPoints((prev) => ({
                    ...prev,
                    [round]: Math.max(0, Number(e.target.value || 0)),
                  }))}
                  disabled={!canEdit}
                  className="mt-1 w-full rounded-md bg-black/25 border border-white/10 px-2 py-1 text-xs text-white"
                />
              </label>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={!canEdit || savingRoundPoints}
              onClick={() => setRoundPoints(getDefaultRoundPoints(scoringMode))}
              className="text-[10px] px-2 py-1 rounded-md"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)' }}
            >
              Reset Defaults
            </button>
            <button
              type="button"
              disabled={!canEdit || savingRoundPoints}
              onClick={saveRoundPoints}
              className="text-[10px] px-2 py-1 rounded-md"
              style={{ background: 'rgba(251,146,60,0.15)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.2)' }}
            >
              Save Round Points
            </button>
          </div>
        </div>
        {scoringMode === 'momentum' && (
          <div className="px-4 py-2 text-[10px]" style={{ color: 'rgba(255,255,255,0.3)', borderTop: '1px solid rgba(255,255,255,0.03)' }}>
            Upset bonus scales with seed gap and round depth. Rewards correctly picking upsets deeper in the tournament.
          </div>
        )}
        {scoringMode === 'accuracy_boldness' && (
          <div className="px-4 py-2 text-[10px]" style={{ color: 'rgba(255,255,255,0.3)', borderTop: '1px solid rgba(255,255,255,0.03)' }}>
            Uniqueness bonus rewards bold picks that fewer league members made. More unique correct picks earn more points.
          </div>
        )}
        {scoringMode === 'streak_survival' && (
          <div className="px-4 py-2 text-[10px]" style={{ color: 'rgba(255,255,255,0.3)', borderTop: '1px solid rgba(255,255,255,0.03)' }}>
            Streak multipliers: 2nd correct = 1.5x, 3rd = 2x, 4th+ = 2.5x. Consecutive correct picks compound your points.
          </div>
        )}
      </div>

      {canEdit && (
        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(148,163,184,0.35)' }}>
          <div className="px-4 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(148,163,184,0.25)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(226,232,240,0.85)' }}>
              Commissioner Tools
            </div>
            <span className="text-[10px]" style={{ color: 'rgba(148,163,184,0.9)' }}>
              Owner & co‑commissioners only
            </span>
          </div>

          <div className="px-4 py-3 space-y-3">
            <div>
              <div className="text-[11px] font-medium mb-1" style={{ color: 'rgba(226,232,240,0.9)' }}>
                Join Code
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="flex-1 rounded-md px-3 py-1.5 text-xs truncate"
                  style={{ background: 'rgba(15,23,42,0.9)', border: '1px dashed rgba(148,163,184,0.5)', color: 'rgba(226,232,240,0.8)' }}
                >
                  {localJoinCode}
                </div>
                <button
                  type="button"
                  onClick={regenerateJoinCode}
                  disabled={regenLoading}
                  className="text-[10px] px-2 py-1 rounded-md border border-amber-400/40 bg-amber-400/10 text-amber-200 disabled:opacity-60"
                >
                  {regenLoading ? "Regenerating..." : "Regenerate"}
                </button>
              </div>
            </div>

            {members && members.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium" style={{ color: 'rgba(226,232,240,0.9)' }}>
                  Members
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                  {members.map((m) => {
                    const isSelf = currentUserId && m.userId === currentUserId
                    const isOwnerRole = m.role === "OWNER"
                    const removable = canEdit && !isOwnerRole && !isSelf
                    return (
                      <div
                        key={m.id}
                        className="flex items-center justify-between text-[11px] px-2 py-1.5 rounded-md"
                        style={{ background: 'rgba(15,23,42,0.9)', border: '1px solid rgba(30,64,175,0.4)' }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate" style={{ color: 'rgba(226,232,240,0.9)' }}>
                            {m.user.displayName || m.user.email}
                          </div>
                          <div className="text-[9px]" style={{ color: 'rgba(148,163,184,0.8)' }}>
                            {m.role.toLowerCase()}
                            {isSelf && " · you"}
                          </div>
                        </div>
                        {removable && (
                          <RemoveMemberButton leagueId={leagueId} userId={m.userId} />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {scoringMode === 'fancred_edge' && (
        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="text-[10px] font-semibold uppercase tracking-wider px-4 py-2" style={{ color: 'rgba(255,255,255,0.3)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            Scoring Bonuses
          </div>

          <BonusToggleCard
            icon={<Zap className="w-4 h-4" style={{ color: '#a78bfa' }} />}
            label="Upset Delta Bonus"
            description="Earn bonus points for correctly picking upsets. The bigger the seed difference, the bigger the bonus."
            accentColor="#a78bfa"
            bgColor="rgba(167,139,250,0.06)"
            borderColor="rgba(167,139,250,0.15)"
            field="upsetDeltaEnabled"
            isOwner={canEdit}
            leagueId={leagueId}
            initialValue={scoringRules?.upsetDeltaEnabled !== false}
          />

          <BonusToggleCard
            icon={<Crown className="w-4 h-4" style={{ color: '#fb923c' }} />}
            label="Leverage Bonus"
            description="Going against the consensus with a correct pick earns you a leverage multiplier."
            accentColor="#fb923c"
            bgColor="rgba(251,146,60,0.06)"
            borderColor="rgba(251,146,60,0.15)"
            field="leverageBonusEnabled"
            isOwner={canEdit}
            leagueId={leagueId}
            initialValue={scoringRules?.leverageBonusEnabled !== false}
          />

          <BonusToggleCard
            icon={<Shield className="w-4 h-4" style={{ color: '#34d399' }} />}
            label="Insurance Token"
            description="Protect one key pick with partial points if it loses. Commissioners can limit which rounds are eligible."
            accentColor="#34d399"
            bgColor="rgba(52,211,153,0.06)"
            borderColor="rgba(52,211,153,0.15)"
            field="insuranceEnabled"
            isOwner={canEdit}
            leagueId={leagueId}
            initialValue={scoringRules?.insuranceEnabled === true}
          />
          {scoringRules?.insuranceEnabled && (
            <div className="px-4 pb-3 text-[11px]" style={{ color: 'rgba(209,213,219,0.65)' }}>
              <div className="mb-1 font-semibold" style={{ color: 'rgba(243,244,246,0.9)' }}>
                Insurance applies to:
              </div>
              <div className="flex flex-wrap gap-1.5 text-[10px]">
                {["Round 1", "Sweet 16 / Elite 8", "Final Four / Champion"].map((label, idx) => (
                  <span
                    key={label}
                    className="inline-flex items-center rounded-full px-2 py-0.5"
                    style={{
                      background: 'rgba(15,23,42,0.8)',
                      border: '1px solid rgba(148,163,184,0.4)',
                      color: 'rgba(226,232,240,0.9)',
                    }}
                  >
                    {label}
                  </span>
                ))}
              </div>
              <div className="mt-1 text-[10px]" style={{ color: 'rgba(148,163,184,0.85)' }}>
                For this version, insurance is available in Round 1, late regional rounds, and Final Four / title games.
              </div>
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="text-[10px] font-semibold uppercase tracking-wider px-4 py-2" style={{ color: 'rgba(255,255,255,0.3)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          Entry Controls
        </div>
        <EntryControlRow
          label="Enable Tiebreaker"
          description="Use championship total points guess as tie-break"
          field="tiebreakerEnabled"
          isOwner={canEdit}
          leagueId={leagueId}
          initialValue={Boolean(scoringRules?.tiebreakerEnabled)}
        />

        <EntryControlRow
          label="Allow Copy Bracket"
          description="Let members copy existing brackets"
          field="allowCopyBracket"
          isOwner={canEdit}
          leagueId={leagueId}
          initialValue={true}
        />
        <EntryControlRow
          label="Hide Picks Until Lock"
          description="Other members' picks hidden until tournament locks"
          field="pickVisibility"
          isOwner={canEdit}
          leagueId={leagueId}
          initialValue={false}
          valueMap={{ true: "hidden_until_lock", false: "visible" }}
        />
      </div>

      <DonateSection />
    </div>
  )
}

function BonusToggleCard({
  icon,
  label,
  description,
  accentColor,
  bgColor,
  borderColor,
  field,
  isOwner,
  leagueId,
  initialValue,
}: {
  icon: React.ReactNode
  label: string
  description: string
  accentColor: string
  bgColor: string
  borderColor: string
  field: string
  isOwner: boolean
  leagueId: string
  initialValue: boolean
}) {
  const [enabled, setEnabled] = useState(initialValue)
  const [saving, setSaving] = useState(false)

  async function toggle() {
    if (!isOwner) return
    const newVal = !enabled
    setEnabled(newVal)
    setSaving(true)
    try {
      await fetch(`/api/bracket/leagues/${leagueId}/manage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "update_rules",
          scoringRules: { [field]: newVal },
        }),
      })
    } catch {}
    setSaving(false)
  }

  return (
    <div
      className="px-4 py-3 flex items-start gap-3 transition-all"
      style={{
        borderBottom: `1px solid ${borderColor}`,
        background: enabled ? bgColor : 'transparent',
      }}
    >
      <div className="mt-0.5 flex-shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold" style={{ color: enabled ? accentColor : 'rgba(255,255,255,0.5)' }}>
            {label}
          </span>
          {saving && <span className="text-[9px]" style={{ color: '#fb923c' }}>(saving...)</span>}
        </div>
        <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: 'rgba(255,255,255,0.35)' }}>
          {description}
        </p>
      </div>
      <button
        onClick={toggle}
        disabled={!isOwner}
        className="w-10 h-5 rounded-full relative transition-colors flex-shrink-0 mt-0.5"
        style={{
          background: enabled ? `${accentColor}40` : 'rgba(255,255,255,0.08)',
          cursor: isOwner ? 'pointer' : 'default',
        }}
      >
        <div
          className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
          style={{
            left: enabled ? '22px' : '2px',
            background: enabled ? accentColor : 'rgba(255,255,255,0.3)',
          }}
        />
      </button>
    </div>
  )
}

function DonateSection() {
  const [loading, setLoading] = useState(false)
  const [amount, setAmount] = useState(500)

  async function handleDonate(amountCents: number) {
    setLoading(true)
    try {
      const res = await fetch("/api/bracket/donate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountCents }),
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } catch {}
    setLoading(false)
  }

  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.1)' }}>
      <div className="text-center space-y-1">
        <div className="text-xs font-semibold" style={{ color: '#f87171' }}>
          Support FanCred Brackets
        </div>
        <div className="text-[9px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
          All brackets are free forever. Donations help keep it running.
        </div>
      </div>
      <div className="flex gap-2">
        {[{ label: "$3", value: 300 }, { label: "$5", value: 500 }, { label: "$10", value: 1000 }].map(p => (
          <button
            key={p.value}
            onClick={() => setAmount(p.value)}
            className="flex-1 rounded-lg py-2 text-xs font-bold transition"
            style={{
              background: amount === p.value ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${amount === p.value ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.06)'}`,
              color: amount === p.value ? '#f87171' : 'rgba(255,255,255,0.5)',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <button
        onClick={() => handleDonate(amount)}
        disabled={loading}
        className="w-full rounded-lg py-2 text-xs font-bold transition disabled:opacity-50"
        style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}
      >
        {loading ? "Processing..." : `Donate $${(amount / 100).toFixed(0)}`}
      </button>
    </div>
  )
}

function EntryControlRow({
  label,
  description,
  field,
  isOwner,
  leagueId,
  initialValue,
  valueMap,
}: {
  label: string
  description: string
  field: string
  isOwner: boolean
  leagueId: string
  initialValue: boolean
  valueMap?: Record<string, string>
}) {
  const [enabled, setEnabled] = useState(initialValue)
  const [saving, setSaving] = useState(false)

  async function toggle() {
    if (!isOwner) return
    const newVal = !enabled
    setEnabled(newVal)
    setSaving(true)
    try {
      const value = valueMap ? valueMap[String(newVal)] : newVal
      await fetch(`/api/bracket/leagues/${leagueId}/manage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "update_rules",
          scoringRules: { [field]: value },
        }),
      })
    } catch {}
    setSaving(false)
  }

  return (
    <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>
          {label} {saving && <span className="text-[10px]" style={{ color: '#fb923c' }}>(saving...)</span>}
        </div>
        <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>{description}</div>
      </div>
      <button
        onClick={toggle}
        disabled={!isOwner}
        className="w-10 h-5 rounded-full relative transition-colors flex-shrink-0"
        style={{
          background: enabled ? 'rgba(251,146,60,0.3)' : 'rgba(255,255,255,0.08)',
          cursor: isOwner ? 'pointer' : 'default',
        }}
      >
        <div
          className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
          style={{
            left: enabled ? '22px' : '2px',
            background: enabled ? '#fb923c' : 'rgba(255,255,255,0.3)',
          }}
        />
      </button>
    </div>
  )
}

function RemoveMemberButton({ leagueId, userId }: { leagueId: string; userId: string }) {
  const [removing, setRemoving] = useState(false)

  async function handleRemove() {
    if (removing) return
    setRemoving(true)
    try {
      await fetch(`/api/bracket/leagues/${leagueId}/manage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "remove_member",
          memberUserId: userId,
        }),
      })
      // For now we rely on a refresh; future improvement: optimistic local removal.
    } catch {
      // swallow; future: surface toast
    } finally {
      setRemoving(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleRemove}
      disabled={removing}
      className="ml-2 text-[10px] px-2 py-1 rounded-md border border-red-400/40 bg-red-500/10 text-red-200 disabled:opacity-60"
    >
      {removing ? "Removing..." : "Remove"}
    </button>
  )
}

const FEED_EVENT_STYLES: Record<string, { icon: string; bg: string; border: string; text: string }> = {
  UPSET_BUSTED: { icon: 'UPSET', bg: 'rgba(239,68,68,0.06)', border: 'rgba(239,68,68,0.15)', text: '#ef4444' },
  CHAMP_ELIMINATED: { icon: 'ELIM', bg: 'rgba(139,92,246,0.06)', border: 'rgba(139,92,246,0.15)', text: '#a78bfa' },
  PERFECT_TRACKER: { icon: 'HOT', bg: 'rgba(251,146,60,0.06)', border: 'rgba(251,146,60,0.15)', text: '#fb923c' },
  LEAD_CHANGE: { icon: 'LEAD', bg: 'rgba(34,197,94,0.06)', border: 'rgba(34,197,94,0.15)', text: '#22c55e' },
  BIG_UPSET: { icon: 'BIG', bg: 'rgba(234,179,8,0.06)', border: 'rgba(234,179,8,0.15)', text: '#eab308' },
}

function FeedTab({ tournamentId, leagueId }: { tournamentId: string; leagueId: string }) {
  const [events, setEvents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'all' | 'league'>('all')

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ tournamentId, limit: '30' })
    if (tab === 'league') params.set('leagueId', leagueId)
    fetch(`/api/bracket/feed?${params}`)
      .then(r => r.json())
      .then(data => setEvents(data.events || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [tournamentId, leagueId, tab])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {(['all', 'league'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold transition"
            style={{
              background: tab === t ? 'rgba(251,146,60,0.12)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${tab === t ? 'rgba(251,146,60,0.2)' : 'rgba(255,255,255,0.06)'}`,
              color: tab === t ? '#fb923c' : 'rgba(255,255,255,0.4)',
            }}
          >
            {t === 'all' ? 'Global Feed' : 'Pool Feed'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-xl p-8 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>Loading feed...</div>
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-xl p-8 text-center space-y-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="text-3xl">BALL</div>
          <h3 className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>No Events Yet</h3>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
            Bracket-busting moments will appear here as games are played.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event: any) => {
            const style = FEED_EVENT_STYLES[event.eventType] || FEED_EVENT_STYLES.BIG_UPSET
            const time = new Date(event.createdAt)
            const timeAgo = formatFeedTime(time)
            return (
              <div
                key={event.id}
                className="rounded-xl p-3.5 space-y-1.5 transition-all"
                style={{ background: style.bg, border: `1px solid ${style.border}` }}
              >
                <div className="flex items-start gap-2.5">
                  <span className="text-xl flex-shrink-0">{style.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold" style={{ color: style.text }}>
                      {event.headline}
                    </div>
                    {event.detail && (
                      <div className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
                        {event.detail}
                      </div>
                    )}
                    <div className="text-[10px] mt-1.5 flex items-center gap-2" style={{ color: 'rgba(255,255,255,0.2)' }}>
                      <span>{timeAgo}</span>
                      {event.leagueId && <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.05)' }}>Pool</span>}
                      {!event.leagueId && <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.05)' }}>Global</span>}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function formatFeedTime(d: Date): string {
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function configKeyLabel(key: string): string {
  const parts = key.split("+")
  const mode = parts[0]
  const modeLabel = SCORING_MODES.find(m => m.id === mode)?.label || mode
  const bonuses = parts.slice(1)
  if (bonuses.length === 0) return `${modeLabel} (Base)`
  const bonusLabels = bonuses.map(b => {
    if (b === "upset") return "Upset"
    if (b === "leverage") return "Leverage"
    if (b === "insurance") return "Insurance"
    return b
  })
  return `${modeLabel} + ${bonusLabels.join(" + ")}`
}

function GlobalTab({ tournamentId, currentUserId }: { tournamentId: string; currentUserId: string }) {
  const [rankings, setRankings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [totalEntries, setTotalEntries] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [scoringConfigs, setScoringConfigs] = useState<{ key: string; count: number }[]>([])
  const [activeConfig, setActiveConfig] = useState<string>("")

  async function fetchRankings(p: number, config: string) {
    setLoading(true)
    try {
      let url = `/api/bracket/global-rankings?tournamentId=${tournamentId}&page=${p}&limit=50`
      if (config) url += `&scoringConfig=${encodeURIComponent(config)}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setRankings(data.rankings ?? [])
        setTotalEntries(data.totalEntries ?? 0)
        setTotalPages(data.totalPages ?? 0)
        if (data.scoringConfigs && !config) {
          setScoringConfigs(data.scoringConfigs)
        }
      }
    } catch {}
    setLoading(false)
  }

  useEffect(() => { fetchRankings(page, activeConfig) }, [tournamentId, page, activeConfig])

  if (loading) {
    return (
      <div className="rounded-xl p-8 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>Loading global rankings...</div>
      </div>
    )
  }

  if (rankings.length === 0) {
    return (
      <div className="rounded-xl p-8 text-center space-y-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <Trophy className="h-10 w-10 mx-auto" style={{ color: 'rgba(251,146,60,0.3)' }} />
        <h3 className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>Global Leaderboard</h3>
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
          No brackets submitted yet. Fill out your bracket to see global rankings!
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <div className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.6)' }}>
          Global Rankings
        </div>
        <div className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
          {totalEntries.toLocaleString()} brackets
        </div>
      </div>

      {scoringConfigs.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 px-1">
          <button
            onClick={() => { setActiveConfig(""); setPage(1) }}
            className="px-3 py-1.5 rounded-lg text-[10px] font-semibold whitespace-nowrap transition-all flex-shrink-0"
            style={{
              background: !activeConfig ? 'rgba(251,146,60,0.12)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${!activeConfig ? 'rgba(251,146,60,0.2)' : 'rgba(255,255,255,0.06)'}`,
              color: !activeConfig ? '#fb923c' : 'rgba(255,255,255,0.4)',
            }}
          >
            All
          </button>
          {scoringConfigs.map(cfg => (
            <button
              key={cfg.key}
              onClick={() => { setActiveConfig(cfg.key); setPage(1) }}
              className="px-3 py-1.5 rounded-lg text-[10px] font-semibold whitespace-nowrap transition-all flex-shrink-0"
              style={{
                background: activeConfig === cfg.key ? 'rgba(251,146,60,0.12)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${activeConfig === cfg.key ? 'rgba(251,146,60,0.2)' : 'rgba(255,255,255,0.06)'}`,
                color: activeConfig === cfg.key ? '#fb923c' : 'rgba(255,255,255,0.4)',
              }}
            >
              {configKeyLabel(cfg.key)} ({cfg.count})
            </button>
          ))}
        </div>
      )}

      <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center px-3 py-2 text-[9px] font-semibold uppercase tracking-wider" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.3)' }}>
          <div className="w-8 text-center">#</div>
          <div className="flex-1">Player</div>
          <div className="w-12 text-center">Pts</div>
          <div className="w-12 text-center">Acc%</div>
          <div className="w-12 text-center">Risk</div>
          <div className="w-12 text-center">%ile</div>
        </div>

        {rankings.map((r: any) => {
          const isMe = r.userId === currentUserId
          return (
            <div
              key={r.entryId}
              className="flex items-center px-3 py-2.5 transition"
              style={{
                borderBottom: '1px solid rgba(255,255,255,0.03)',
                background: isMe ? 'rgba(251,146,60,0.06)' : undefined,
              }}
            >
              <div className="w-8 text-center text-xs font-bold" style={{ color: r.rank <= 3 ? '#fb923c' : 'rgba(255,255,255,0.4)' }}>
                {r.rank}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate" style={{ color: isMe ? '#fb923c' : 'rgba(255,255,255,0.8)' }}>
                  {r.displayName || 'Anonymous'}
                  {isMe && <span className="ml-1 text-[10px]" style={{ color: 'rgba(251,146,60,0.6)' }}>(you)</span>}
                </div>
                <div className="text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.25)' }}>
                  {r.entryName} - {r.championPick || '--'}
                </div>
              </div>
              <div className="w-12 text-center text-xs font-bold" style={{ color: '#fb923c' }}>
                {r.totalPoints}
              </div>
              <div className="w-12 text-center text-[10px]" style={{ color: r.accuracy >= 60 ? '#22c55e' : 'rgba(255,255,255,0.4)' }}>
                {r.accuracy}%
              </div>
              <div className="w-12 text-center text-[10px]" style={{ color: r.riskIndex >= 30 ? '#818cf8' : 'rgba(255,255,255,0.4)' }}>
                {r.riskIndex}%
              </div>
              <div className="w-12 text-center text-[10px]" style={{ color: r.percentile >= 90 ? '#fb923c' : 'rgba(255,255,255,0.3)' }}>
                {r.percentile}
              </div>
            </div>
          )
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-30 transition"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)' }}
          >
            Prev
          </button>
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-30 transition"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)' }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}

function PublicPoolsTab({ tournamentId }: { tournamentId: string }) {
  const [pools, setPools] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [total, setTotal] = useState(0)
  const [filterMode, setFilterMode] = useState<string>("")
  const [joining, setJoining] = useState<string | null>(null)

  async function fetchPools(p: number) {
    setLoading(true)
    try {
      let url = `/api/bracket/public-pools?tournamentId=${tournamentId}&page=${p}&limit=20`
      if (filterMode) url += `&scoringMode=${filterMode}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setPools(data.pools ?? [])
        setTotal(data.total ?? 0)
        setTotalPages(data.totalPages ?? 0)
      }
    } catch {}
    setLoading(false)
  }

  async function joinPool(joinCode: string) {
    setJoining(joinCode)
    try {
      const res = await fetch('/api/bracket/leagues/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ joinCode }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.leagueId) {
          window.location.href = `/brackets/leagues/${data.leagueId}`
        }
      }
    } catch {}
    setJoining(null)
  }

  useEffect(() => { fetchPools(page) }, [tournamentId, page, filterMode])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <div className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.6)' }}>
          Public Pools
        </div>
        <div className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
          {total} pool{total !== 1 ? 's' : ''}
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {[{ id: '', label: 'All' }, ...SCORING_MODES].map(m => (
          <button
            key={m.id}
            onClick={() => { setFilterMode(m.id); setPage(1) }}
            className="text-[10px] font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition"
            style={{
              background: filterMode === m.id ? 'rgba(251,146,60,0.15)' : 'rgba(255,255,255,0.03)',
              color: filterMode === m.id ? '#fb923c' : 'rgba(255,255,255,0.4)',
              border: `1px solid ${filterMode === m.id ? 'rgba(251,146,60,0.3)' : 'rgba(255,255,255,0.06)'}`,
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-xl p-8 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>Loading pools...</div>
        </div>
      ) : pools.length === 0 ? (
        <div className="rounded-xl p-8 text-center space-y-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <Trophy className="h-10 w-10 mx-auto" style={{ color: 'rgba(251,146,60,0.3)' }} />
          <h3 className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>No Public Pools</h3>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
            No public pools available yet. Create one and make it public!
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {pools.map((pool: any) => (
            <div
              key={pool.id}
              className="rounded-xl p-3 transition"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-white truncate">{pool.name}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                      by {pool.ownerName}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(251,146,60,0.08)', color: '#fb923c' }}>
                      {SCORING_MODES.find(m => m.id === pool.scoringMode)?.label || pool.scoringMode}
                    </span>
                    {pool.memberCount >= 50 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.08)', color: '#22c55e' }}>
                        Popular
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-right">
                    <div className="text-xs font-bold" style={{ color: 'rgba(255,255,255,0.6)' }}>
                      {pool.memberCount}
                    </div>
                    <div className="text-[9px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
                      / {pool.maxManagers}
                    </div>
                  </div>
                  <button
                    onClick={() => joinPool(pool.joinCode)}
                    disabled={joining === pool.joinCode}
                    className="text-[11px] font-semibold px-4 py-1.5 rounded-lg transition"
                    style={{ background: 'rgba(251,146,60,0.15)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.2)' }}
                  >
                    {joining === pool.joinCode ? '...' : 'Join'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-30 transition"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)' }}
          >
            Prev
          </button>
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-30 transition"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)' }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
