'use client'

import { useMemo, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Clock, Plus, Share2, Repeat, History, PlaySquare } from 'lucide-react'
import MockDraftSimulatorWrapper from '@/components/mock-draft/MockDraftSimulatorWrapper'
import { MockDraftRecap } from '@/components/mock-draft'
import type { MockDraftConfig } from '@/lib/mock-draft/types'
import { useUserTimezone } from '@/hooks/useUserTimezone'

type LeagueOption = {
  id: string
  name: string
  platform: string
  leagueSize?: number
  isDynasty?: boolean
  scoring?: string | null
  sport?: string
}

type SavedDraft = {
  id: string
  shareId: string | null
  rounds: number
  createdAt: string
  metadata: any
  results: any[]
}

export interface MockDraftLobbyPageProps {
  leagues: LeagueOption[]
  savedDrafts: SavedDraft[]
}

export default function MockDraftLobbyPage({ leagues, savedDrafts }: MockDraftLobbyPageProps) {
  const { formatDateInTimezone } = useUserTimezone()
  const searchParams = useSearchParams()
  const urlDraftId = searchParams?.get('draftId')
  const [selectedDraftId, setSelectedDraftId] = useState<string | 'new'>('new')
  const [urlSessionDraft, setUrlSessionDraft] = useState<{
    id: string
    inviteLink: string | null
    status: string
    canManage?: boolean
  } | null>(null)

  useEffect(() => {
    if (!urlDraftId) {
      setUrlSessionDraft(null)
      return
    }

    let cancelled = false
    fetch(`/api/mock-draft/${urlDraftId}`)
      .then((res) => res.json())
      .then((data) => {
        const draft = data?.draft
        if (cancelled || !draft?.id) return
        setUrlSessionDraft({
          id: draft.id,
          inviteLink: draft.inviteLink ?? null,
          status: draft.status ?? 'pre_draft',
          canManage: draft.canManage ?? false,
        })
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [urlDraftId])

  const selectedDraft = useMemo(
    () => (selectedDraftId === 'new' ? null : savedDrafts.find((draft) => draft.id === selectedDraftId) || null),
    [selectedDraftId, savedDrafts],
  )

  const parsedConfig: MockDraftConfig | null = useMemo(() => {
    if (!selectedDraft?.metadata) return null
    const metadata = selectedDraft.metadata || {}
    return {
      sport: (metadata.sport as any) || 'NFL',
      leagueType: (metadata.leagueType as any) || 'redraft',
      draftType: (metadata.draftType as any) || 'snake',
      numTeams: Number(metadata.numTeams || 12),
      scoringFormat: (metadata.scoringFormat as any) || 'default',
      timerSeconds: Number(metadata.timerSeconds || 0),
      aiEnabled: Boolean(metadata.aiEnabled),
      rounds: Number(metadata.rounds || selectedDraft.rounds || 15),
      leagueId: (metadata.leagueId as string | null) ?? null,
      roomMode: (metadata.roomMode as any) || 'solo',
      humanTeams: Number(metadata.humanTeams || 1),
    }
  }, [selectedDraft])

  const userManagerName = useMemo(() => {
    if (!selectedDraft) return null
    const userPick = (selectedDraft.results || []).find((pick: any) => pick.isUser)
    return userPick?.manager ?? null
  }, [selectedDraft])

  const handleNewMock = () => {
    setSelectedDraftId('new')
  }

  const handleRestartFromSaved = (draft: SavedDraft) => {
    if (!draft.metadata) return
    const metadata = draft.metadata || {}
    const config: MockDraftConfig = {
      sport: (metadata.sport as any) || 'NFL',
      leagueType: (metadata.leagueType as any) || 'redraft',
      draftType: (metadata.draftType as any) || 'snake',
      numTeams: Number(metadata.numTeams || 12),
      scoringFormat: (metadata.scoringFormat as any) || 'default',
      timerSeconds: Number(metadata.timerSeconds || 0),
      aiEnabled: Boolean(metadata.aiEnabled),
      rounds: Number(metadata.rounds || draft.rounds || 15),
      leagueId: (metadata.leagueId as string | null) ?? null,
      roomMode: (metadata.roomMode as any) || 'solo',
      humanTeams: Number(metadata.humanTeams || 1),
    }
    setSelectedDraftId('new')
  }

  const handleCopyShare = (draft: SavedDraft) => {
    const urlBase = process.env.NEXT_PUBLIC_APP_URL || window.location.origin
    const url = draft.shareId ? `${urlBase}/mock-draft/share/${draft.shareId}` : urlBase
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(() => {})
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1.7fr)] xl:grid-cols-[260px_minmax(0,2fr)]">
      <aside className="space-y-4 rounded-2xl border border-white/12 bg-black/30 p-4 text-xs text-white/75">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-400/40">
              <History className="h-3.5 w-3.5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Mock lobby</p>
              <p className="text-[11px] text-white/60">Create, resume, or share your mocks.</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleNewMock}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/50 bg-cyan-500/15 px-3 py-2 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/25"
        >
          <Plus className="h-3.5 w-3.5" />
          New mock draft
        </button>

        <div className="space-y-2">
          <p className="text-[11px] font-medium text-white/80">Recent mocks</p>
          {savedDrafts.length === 0 ? (
            <p className="text-[11px] text-white/55">
              No saved mocks yet. Complete a mock draft to see it here.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {savedDrafts.map((draft) => {
                const metadata = draft.metadata || {}
                const isActive = selectedDraftId === draft.id
                return (
                  <li key={draft.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedDraftId(draft.id)}
                      className={`w-full rounded-lg border px-2.5 py-2 text-left text-[11px] ${
                        isActive ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-white/10 bg-black/40 hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-white">
                          {metadata.sport || 'NFL'} - {metadata.leagueType || 'redraft'} - {metadata.draftType || 'snake'}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-white/55">
                        {metadata.numTeams || 12}-team - {draft.rounds} rounds - {formatDateInTimezone(draft.createdAt)}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-white/60">
                        {draft.results.length > 0 && (
                          <Link
                            href={`/mock-draft/${encodeURIComponent(draft.id)}/replay`}
                            onClick={(event) => {
                              event.stopPropagation()
                            }}
                            className="inline-flex items-center gap-1 rounded-full border border-white/20 px-1.5 py-0.5 hover:bg-white/10"
                            data-testid={`mock-draft-replay-link-${draft.id}`}
                          >
                            <PlaySquare className="h-3 w-3" />
                            Replay
                          </Link>
                        )}
                        {draft.shareId && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              handleCopyShare(draft)
                            }}
                            className="inline-flex items-center gap-1 rounded-full border border-white/20 px-1.5 py-0.5 hover:bg-white/10"
                          >
                            <Share2 className="h-3 w-3" />
                            Share
                          </button>
                        )}
                        {draft.metadata && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              handleRestartFromSaved(draft)
                            }}
                            className="inline-flex items-center gap-1 rounded-full border border-white/20 px-1.5 py-0.5 hover:bg-white/10"
                          >
                            <Repeat className="h-3 w-3" />
                            Restart
                          </button>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="mt-4 space-y-1 border-t border-white/10 pt-3 text-[11px] text-white/50">
          <p>Mocks auto-save when you finish a draft. You can share recap links with friends.</p>
          <p className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> History is limited to your most recent 25 mocks.
          </p>
        </div>
      </aside>

      <main className="space-y-6">
        {selectedDraft && selectedDraft.results.length > 0 && parsedConfig ? (
          <MockDraftRecap
            results={selectedDraft.results}
            config={parsedConfig}
            userManagerName={userManagerName}
            draftId={selectedDraft.id}
          />
        ) : (
          <MockDraftSimulatorWrapper
            leagues={leagues}
            initialSessionDraft={urlSessionDraft}
          />
        )}
      </main>
    </div>
  )
}
