'use client'

import { useState, useCallback, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { Play, RotateCcw, Loader2 } from 'lucide-react'
import { MockDraftSetup, MockDraftRecap } from '@/components/mock-draft'
import { MockDraftInviteLink } from '@/components/mock-draft/MockDraftInviteLink'
import { MockDraftChatPanel } from '@/components/mock-draft/MockDraftChatPanel'
import { MockDraftSessionBoard } from '@/components/mock-draft/MockDraftSessionBoard'
import type { MockDraftConfig } from '@/lib/mock-draft/types'

// Deferred: does not render until `showSetup` is false (after the user starts a
// draft), pulls in recharts and framer-motion.
const MockDraftSimulatorClient = dynamic(() => import('@/components/MockDraftSimulatorClient'), { ssr: false })

interface DraftPick {
  round: number
  pick: number
  overall: number
  playerName: string
  position: string
  team: string
  manager: string
  managerAvatar?: string
  confidence?: number
  isUser: boolean
  value?: number
  notes?: string
  isBotPick?: boolean
}

interface LeagueOption {
  id: string
  name: string
  platform: string
  leagueSize?: number
  isDynasty?: boolean
  scoring?: string | null
  sport?: string
}

type SessionDraft = {
  id: string
  inviteLink: string | null
  status: string
  canManage?: boolean
}

interface MockDraftSimulatorWrapperProps {
  leagues: LeagueOption[]
  /** When opening room via invite or link, pass existing session so we show invite/start/reset/chat */
  initialSessionDraft?: SessionDraft | null
}

export default function MockDraftSimulatorWrapper({ leagues, initialSessionDraft = null }: MockDraftSimulatorWrapperProps) {
  const [showSetup, setShowSetup] = useState(!initialSessionDraft)
  const [mockConfig, setMockConfig] = useState<MockDraftConfig | null>(null)
  const [sessionDraft, setSessionDraft] = useState<SessionDraft | null>(initialSessionDraft ?? null)

  useEffect(() => {
    if (initialSessionDraft?.id) {
      setSessionDraft(initialSessionDraft)
      setShowSetup(false)
    }
  }, [initialSessionDraft?.id, initialSessionDraft?.inviteLink, initialSessionDraft?.status, initialSessionDraft?.canManage])
  const [showRecap, setShowRecap] = useState(false)
  const [recapResults, setRecapResults] = useState<DraftPick[]>([])
  const [recapDraftId, setRecapDraftId] = useState<string | null>(null)
  const [userManagerName, setUserManagerName] = useState<string | null>(null)
  const [chatAiSuggestion, setChatAiSuggestion] = useState<string | null>(null)
  const [startResetLoading, setStartResetLoading] = useState(false)

  const handleStart = useCallback(async (config: MockDraftConfig) => {
    setMockConfig(config)
    try {
      const res = await fetch('/api/mock-draft/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          numTeams: config.numTeams,
          rounds: config.rounds,
          timerSeconds: config.timerSeconds,
          poolType: config.poolType ?? 'all',
          rosterSize: config.rosterSize,
          roomMode: config.roomMode ?? 'solo',
          humanTeams: config.humanTeams ?? 1,
          slotConfig: config.slotConfig ?? undefined,
          useSession: true,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.draftId) {
        setSessionDraft({
          id: data.draftId,
          inviteLink: data.inviteLink ?? null,
          status: data.draftStatus ?? data.status ?? 'pre_draft',
          canManage: true,
        })
      }
    } catch {
      // proceed without session (no invite link)
    }
    setShowSetup(false)
  }, [])

  const handleDraftComplete = useCallback((results: DraftPick[], draftId: string | null) => {
    setRecapResults(results)
    setRecapDraftId(draftId)
    setUserManagerName(results.find((p) => p.isUser)?.manager ?? null)
    setShowRecap(true)
  }, [])

  const handleStartDraft = useCallback(async () => {
    if (!sessionDraft?.id || sessionDraft.status !== 'pre_draft') return
    setStartResetLoading(true)
    try {
      const res = await fetch(`/api/mock-draft/${sessionDraft.id}/start`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) setSessionDraft((prev) => (prev ? { ...prev, status: data?.draft?.status ?? 'in_progress' } : null))
    } finally {
      setStartResetLoading(false)
    }
  }, [sessionDraft?.id, sessionDraft?.status])

  const handleResetDraft = useCallback(async () => {
    if (!sessionDraft?.id) return
    setStartResetLoading(true)
    try {
      const res = await fetch(`/api/mock-draft/${sessionDraft.id}/reset`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) setSessionDraft((prev) => (prev ? { ...prev, status: data?.draft?.status ?? 'pre_draft' } : null))
    } finally {
      setStartResetLoading(false)
    }
  }, [sessionDraft?.id])

  const handleRestartDraft = useCallback(async () => {
    if (!sessionDraft?.id) return
    setStartResetLoading(true)
    try {
      const res = await fetch(`/api/mock-draft/${sessionDraft.id}/restart`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) setSessionDraft((prev) => (prev ? { ...prev, status: data?.draft?.status ?? 'pre_draft' } : null))
    } finally {
      setStartResetLoading(false)
    }
  }, [sessionDraft?.id])

  if (showRecap) {
    const recapLeagueId = mockConfig?.leagueId ?? leagues[0]?.id ?? null
    return (
      <div className="space-y-6">
        <MockDraftRecap
          results={recapResults}
          config={mockConfig}
          userManagerName={userManagerName}
          leagueId={recapLeagueId}
          draftId={recapDraftId}
          onBack={() => setShowRecap(false)}
        />
      </div>
    )
  }

  if (showSetup) {
    return (
      <div className="max-w-2xl mx-auto" data-testid="mock-draft-wrapper-setup">
        <MockDraftSetup
          leagueOptions={leagues.map((l) => ({
            id: l.id,
            name: l.name,
            leagueSize: l.leagueSize,
            isDynasty: l.isDynasty,
            scoring: l.scoring ?? null,
            sport: l.sport,
          }))}
          onStart={handleStart}
        />
        <p className="mt-4 text-center text-sm text-white/50">
          Or skip setup and use the flow below to select a league and run a mock draft.
        </p>
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setShowSetup(false)}
            data-testid="mock-draft-go-to-league-selector"
            className="text-sm text-cyan-400 hover:text-cyan-300 underline"
          >
            Go to league selector
          </button>
        </div>
      </div>
    )
  }

  const leaguesWithSize = leagues.map((l) => ({
    ...l,
    leagueSize: l.leagueSize ?? 12,
    isDynasty: l.isDynasty ?? false,
    scoring: l.scoring ?? null,
  }))

  return (
    <div className="space-y-4" data-testid="mock-draft-wrapper-active">
      {sessionDraft && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/12 bg-black/25 p-3" data-testid="mock-draft-session-controls">
          {sessionDraft.canManage !== false && (
            <MockDraftInviteLink
              inviteLink={sessionDraft.inviteLink}
              draftId={sessionDraft.id}
              status={sessionDraft.status}
            />
          )}
          {sessionDraft.canManage !== false && sessionDraft.status === 'pre_draft' && (
            <>
              <button
                type="button"
                onClick={handleStartDraft}
                disabled={startResetLoading}
                data-testid="mock-draft-session-start"
                className="inline-flex items-center gap-2 rounded-xl border border-green-500/40 bg-green-500/15 px-3 py-2 text-xs font-medium text-green-200 hover:bg-green-500/25 disabled:opacity-50"
              >
                {startResetLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Start draft
              </button>
              <button
                type="button"
                onClick={handleResetDraft}
                disabled={startResetLoading}
                data-testid="mock-draft-session-reset"
                className="inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-200 hover:bg-amber-500/25 disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
              <button
                type="button"
                onClick={handleRestartDraft}
                disabled={startResetLoading}
                data-testid="mock-draft-session-restart"
                className="inline-flex items-center gap-2 rounded-xl border border-purple-500/40 bg-purple-500/15 px-3 py-2 text-xs font-medium text-purple-200 hover:bg-purple-500/25 disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restart
              </button>
            </>
          )}
        </div>
      )}
      {sessionDraft && (
        <MockDraftSessionBoard
          draftId={sessionDraft.id}
          canManage={sessionDraft.canManage !== false}
        />
      )}
      {sessionDraft && <MockDraftChatPanel draftId={sessionDraft.id} aiSuggestion={chatAiSuggestion} />}
      <MockDraftSimulatorClient
        leagues={leaguesWithSize}
        initialLeagueId={mockConfig?.leagueId ?? ''}
        initialConfig={
          mockConfig
            ? {
                rounds: mockConfig.rounds,
                draftType: mockConfig.draftType,
                scoring: mockConfig.scoringFormat,
                aiEnabled: mockConfig.aiEnabled,
              }
            : undefined
        }
        initialDraftId={sessionDraft?.id ?? null}
        onDraftComplete={handleDraftComplete}
        showAIAssistantPanel={mockConfig?.aiEnabled ?? true}
        onBack={() => setShowSetup(true)}
        onChatSuggestionChange={setChatAiSuggestion}
      />
    </div>
  )
}
