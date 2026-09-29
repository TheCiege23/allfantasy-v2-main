'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { slotIndexForOverallPick } from '@/lib/draft/snake'
import type {
  DraftMode,
  DraftPickOrderEntry,
  DraftPickRecord,
  DraftPlayerRow,
  DraftStatePayload,
} from '../types'
import { DraftBoard } from './DraftBoard'
import { DraftChatPanel } from './DraftChatPanel'
import { ChimmyDraftChat } from './ChimmyDraftChat'
import { DraftHeader } from './DraftHeader'
import { DraftPlayerModal } from './DraftPlayerModal'
import { DraftResultsView } from './DraftResultsView'
import { DraftSettingsModal } from './DraftSettingsModal'
import { DraftTimerBar } from './DraftTimerBar'
import { ManagerStrip } from './ManagerStrip'
import { PlayerPool } from './PlayerPool'
import { QueuePanel } from './QueuePanel'
import { RosterPanel } from './RosterPanel'
import { AutopickToggle } from './AutopickToggle'
import { motion } from 'framer-motion'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

type Props = {
  mode: DraftMode
  sessionId: string
  leagueId: string | null
  roomId: string | null
  userId: string
  userName: string
  inviteCode?: string | null
  isCommissioner?: boolean
  /** When true, show best-ball depth reminder (no behavior change). */
  bestBallMode?: boolean
  bestBallSport?: string | null
}

function mapState(raw: Record<string, unknown>): DraftStatePayload {
  return {
    id: String(raw.id),
    mode: String(raw.mode),
    status: String(raw.status),
    currentPick: Number(raw.currentPick),
    currentRound: Number(raw.currentRound),
    currentTeamIndex: Number(raw.currentTeamIndex),
    timerEndsAt: raw.timerEndsAt ? String(raw.timerEndsAt) : null,
    timerPaused: Boolean(raw.timerPaused),
    pickOrder: (raw.pickOrder as DraftStatePayload['pickOrder']) ?? null,
    leagueId: raw.leagueId ? String(raw.leagueId) : null,
    roomId: raw.roomId ? String(raw.roomId) : null,
    numTeams: Number(raw.numTeams),
    numRounds: Number(raw.numRounds),
    timerSeconds: Number(raw.timerSeconds),
    updatedAt: String(raw.updatedAt),
  }
}

function mapPick(raw: Record<string, unknown>): DraftPickRecord {
  return {
    id: String(raw.id),
    round: Number(raw.round),
    pickNumber: Number(raw.pickNumber),
    overallPick: Number(raw.overallPick),
    originalOwnerId: String(raw.originalOwnerId),
    currentOwnerId: String(raw.currentOwnerId),
    playerId: raw.playerId ? String(raw.playerId) : null,
    playerName: raw.playerName ? String(raw.playerName) : null,
    position: raw.position ? String(raw.position) : null,
    team: raw.team ? String(raw.team) : null,
    isTraded: Boolean(raw.isTraded),
    autopicked: Boolean(raw.autopicked),
    timestamp: raw.timestamp ? String(raw.timestamp) : '',
  }
}

export function DraftShell({
  mode,
  sessionId,
  leagueId,
  roomId,
  userId,
  userName,
  inviteCode,
  isCommissioner = false,
  bestBallMode = false,
  bestBallSport = null,
}: Props) {
  const { t } = useLanguage()
  const [state, setState] = useState<DraftStatePayload | null>(null)
  const [picks, setPicks] = useState<DraftPickRecord[]>([])
  const [queue, setQueue] = useState<DraftPlayerRow[]>([])
  const [autopick, setAutopick] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [rightTab, setRightTab] = useState<'queue' | 'roster' | 'chat' | 'ai'>('queue')
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null)
  const [leagueMeta, setLeagueMeta] = useState<{
    name: string | null
    avatarsByOwnerId: Record<string, string | null>
  }>({ name: null, avatarsByOwnerId: {} })

  // Lightweight league-name + manager-avatar fetch for league drafts.
  useEffect(() => {
    if (!leagueId) return
    let cancelled = false
    void fetch(`/api/league/detail?leagueId=${encodeURIComponent(leagueId)}`, {
      credentials: 'include',
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { name?: string; teams?: Array<{ platformUserId?: string | null; claimedByUserId?: string | null; avatarUrl?: string | null }> } | null) => {
        if (cancelled || !j) return
        const map: Record<string, string | null> = {}
        for (const team of j.teams ?? []) {
          const id = team.claimedByUserId ?? team.platformUserId ?? null
          if (id && team.avatarUrl) map[id] = team.avatarUrl
        }
        setLeagueMeta({ name: j.name ?? null, avatarsByOwnerId: map })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [leagueId])

  const load = useCallback(async () => {
    const r = await fetch(`/api/draft/room/state?sessionId=${encodeURIComponent(sessionId)}`)
    if (!r.ok) return
    const j = (await r.json()) as { state?: Record<string, unknown>; picks?: Record<string, unknown>[] }
    if (j.state) setState(mapState(j.state))
    if (j.picks) setPicks(j.picks.map((p) => mapPick(p)))
  }, [sessionId])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(id)
  }, [load])

  useEffect(() => {
    void fetch(`/api/draft/queue/get?sessionId=${encodeURIComponent(sessionId)}`)
      .then((r) => r.json())
      .then((j: { playerIds?: string[] }) => {
        const ids = j.playerIds ?? []
        if (!ids.length) return
        void fetch('/api/draft/players?sport=NFL')
          .then((r) => r.json())
          .then((d: { players?: DraftPlayerRow[] }) => {
            const all = d.players ?? []
            const map = new Map(all.map((p) => [p.id, p]))
            setQueue(ids.map((id) => map.get(id)).filter(Boolean) as DraftPlayerRow[])
          })
      })
  }, [sessionId])

  const draftedIds = useMemo(() => new Set(picks.map((p) => p.playerId).filter(Boolean) as string[]), [picks])

  const order = useMemo(
    () => (state?.pickOrder ?? []) as DraftPickOrderEntry[],
    [state?.pickOrder],
  )
  const currentOverall = state?.currentPick ?? 1
  const numT = state?.numTeams ?? 12
  const slotIdx = slotIndexForOverallPick(currentOverall, numT)
  const onClockId = order[slotIdx]?.id ?? ''
  const canDraft = Boolean(state?.status === 'active' && onClockId === userId)

  const myPicks = useMemo(() => {
    if (mode === 'live') {
      return picks.filter((p) => p.pickedById === userId)
    }
    return picks.filter((p) => p.currentOwnerId === userId)
  }, [picks, userId, mode])

  const onClockLabel = order[slotIdx]?.label ?? '—'
  const selfIndex = order.findIndex((s) => s.id === userId)
  const enrichedOrder = useMemo<DraftPickOrderEntry[]>(() => {
    if (!Object.keys(leagueMeta.avatarsByOwnerId).length) return order
    return order.map((s) => ({ ...s, avatarUrl: s.avatarUrl ?? leagueMeta.avatarsByOwnerId[s.id] ?? null }))
  }, [order, leagueMeta])

  const headerTitle =
    leagueMeta.name ??
    (mode === 'mock' ? t('draftRoom.legacy.mockDraft') : t('draftRoom.legacy.liveDraft'))
  const headerSubtitle = useMemo(() => {
    const parts: string[] = []
    if (state?.timerSeconds) {
      const sec = state.timerSeconds
      if (sec >= 3600) parts.push(`${Math.round(sec / 3600)} Hours Per Pick`)
      else if (sec >= 60) parts.push(`${Math.round(sec / 60)} Min Per Pick`)
      else parts.push(`${sec}s Per Pick`)
    }
    if (state?.numTeams) parts.push(`${state.numTeams} Teams`)
    if (state?.numRounds) parts.push(`${state.numRounds} Rounds`)
    return parts.join(' · ')
  }, [state?.timerSeconds, state?.numTeams, state?.numRounds])

  const draftActive = state?.status === 'active'

  const onDraft = async (p: DraftPlayerRow) => {
    const r = await fetch('/api/draft/pick/make', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        playerId: p.id,
        playerName: p.name,
        position: p.position,
        team: p.team,
        mode,
      }),
    })
    if (r.ok) {
      await fetch('/api/draft/worker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      if (mode === 'mock') {
        for (let i = 0; i < 20; i++) {
          const cpu = await fetch('/api/draft/mock/cpu-pick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          })
          if (!cpu.ok) break
        }
      }
      void load()
    }
  }

  const onQueueAdd = (p: DraftPlayerRow) => {
    if (queue.some((q) => q.id === p.id)) return
    setQueue((q) => [...q, p])
  }

  const toggleAutopick = async (v: boolean) => {
    setAutopick(v)
    await fetch('/api/draft/autopick/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, enabled: v }),
    })
  }

  const startDraft = async () => {
    await fetch('/api/draft/room/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    void load()
  }

  if (!state) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0d1117] text-white/50">
        {t('draftRoom.legacy.loading')}
      </div>
    )
  }

  if (state.status === 'complete') {
    return (
      <div className="min-h-screen bg-[#0d1117]">
        <DraftResultsView state={state} picks={picks} sessionId={sessionId} />
      </div>
    )
  }

  return (
    <motion.div
      className="flex min-h-screen flex-col bg-[#0d1117] text-white"
      initial={{ opacity: 0.96 }}
      animate={{ opacity: 1 }}
    >
      <DraftHeader
        title={headerTitle}
        subtitle={headerSubtitle}
        isCommissioner={isCommissioner}
        onOpenSettings={() => setSettingsOpen(true)}
        centerSlot={
          draftActive ? (
            <DraftTimerBar
              timerEndsAt={state.timerEndsAt}
              timerPaused={state.timerPaused}
              onTheClockLabel={onClockLabel}
              isCommissioner={isCommissioner}
              onPause={() =>
                void fetch('/api/draft/timer/pause', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sessionId }),
                }).then(() => load())
              }
              onResume={() =>
                void fetch('/api/draft/timer/resume', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sessionId }),
                }).then(() => load())
              }
              autopickActive={autopick}
            />
          ) : null
        }
        rightSlot={
          <div className="flex items-center gap-2">
            <AutopickToggle enabled={autopick} onChange={(v) => void toggleAutopick(v)} />
            {state.status === 'waiting' ? (
              <button
                type="button"
                onClick={() => void startDraft()}
                className="rounded-lg bg-cyan-500 px-3 py-1 text-[11px] font-bold text-black"
              >
                Start draft
              </button>
            ) : null}
          </div>
        }
      />

      {bestBallMode ? (
        <div
          className="border-b border-cyan-500/20 bg-[#0a1228]/90 px-3 py-2 text-[11px] text-cyan-100/85"
          data-testid="draft-bestball-banner"
        >
          {t('draftRoom.legacy.bestBallBanner').replace(
            '{{sport}}',
            bestBallSport ?? '—',
          )}
        </div>
      ) : null}

      <div className="border-b border-white/[0.06] bg-[#0a1228]/40">
        <ManagerStrip
          slots={enrichedOrder}
          onClockIndex={draftActive ? slotIdx : undefined}
          selfIndex={selfIndex >= 0 ? selfIndex : undefined}
        />
      </div>

      <div className="px-2 py-2">
        <DraftBoard
          numTeams={state.numTeams}
          numRounds={state.numRounds}
          pickOrder={enrichedOrder}
          picks={picks}
          currentOverall={currentOverall}
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 px-2 pb-4 lg:grid-cols-2">
        <div className="min-h-[320px]">
          <PlayerPool
            sport="NFL"
            draftedIds={draftedIds}
            onDraft={(p) => void onDraft(p)}
            onQueue={onQueueAdd}
            canDraft={canDraft}
            onPlayerClick={(id) => setActivePlayerId(id)}
          />
        </div>
        <div
          className="flex min-h-[320px] flex-col rounded-lg border border-white/[0.08] bg-[#0d1117]"
          data-testid="draft-right-panel"
        >
          <div role="tablist" className="flex gap-1 border-b border-white/[0.06] px-2 pt-2">
            {/* Commit W — translation lookup is hardened against missing keys.
             *  `t()` returns the raw key string when a translation is absent
             *  (e.g. `"draftRoom.legacy.queueTab"`), which is truthy, so
             *  `?? 'Queue'` did not fall back. We now treat any returned
             *  string that still equals the lookup key as a miss and use
             *  the literal label. The translation source (EN + ES parity)
             *  has also been updated with the missing keys so the literal
             *  fallback is belt-and-suspenders, not the primary source. */}
            {([
              { key: 'queue', i18nKey: 'draftRoom.legacy.queueTab', label: 'Queue' },
              { key: 'roster', i18nKey: 'draftRoom.legacy.rosterTab', label: 'Roster' },
              { key: 'chat', i18nKey: 'draftRoom.legacy.draftChat', label: 'Draft Chat' },
              { key: 'ai', i18nKey: 'draftRoom.legacy.aiTab', label: 'AI' },
            ] as const).map((tab) => {
              const translated = t(tab.i18nKey)
              const resolvedLabel =
                typeof translated === 'string' && translated && translated !== tab.i18nKey
                  ? translated
                  : tab.label
              return { key: tab.key, label: resolvedLabel }
            }).map((tab) => {
              const active = rightTab === tab.key
              const isAi = tab.key === 'ai'
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setRightTab(tab.key)}
                  data-testid={`draft-right-tab-${tab.key}`}
                  className={`rounded-t px-3 py-1.5 text-[11px] font-semibold transition ${
                    active
                      ? isAi
                        ? 'bg-cyan-500/20 text-cyan-200'
                        : 'bg-white/10 text-white'
                      : 'text-white/45 hover:text-white/70'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
          <div className="min-h-0 flex-1 p-2" data-testid={`draft-right-tab-content-${rightTab}`}>
            {rightTab === 'queue' ? (
              <QueuePanel sessionId={sessionId} queue={queue} onQueueChange={setQueue} />
            ) : rightTab === 'roster' ? (
              <RosterPanel myPicks={myPicks} />
            ) : rightTab === 'chat' ? (
              <DraftChatPanel sessionId={sessionId} mode={mode} viewerId={userId} />
            ) : (
              <ChimmyDraftChat
                sessionId={sessionId}
                context={{
                  userName,
                  userId,
                  state,
                  picks,
                }}
              />
            )}
          </div>
        </div>
      </div>

      <DraftSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        roomId={roomId}
        inviteCode={inviteCode ?? null}
        onStart={() => void startDraft()}
      />

      <DraftPlayerModal
        open={Boolean(activePlayerId)}
        playerId={activePlayerId}
        sport="NFL"
        onClose={() => setActivePlayerId(null)}
      />
    </motion.div>
  )
}
