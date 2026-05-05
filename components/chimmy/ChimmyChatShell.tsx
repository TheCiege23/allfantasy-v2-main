'use client'

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Send, Image as ImageIcon, Loader2, X, RefreshCw, Volume2, History, Save } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { type ChimmyVoicePreset } from '@/lib/chimmy-interface'
import {
  getAIThreadStorageKey,
  loadAIThreadMessages,
  resolveSportForAIChat,
  saveAIThreadMessages,
  sendChimmyMessage,
} from '@/lib/chimmy-chat'
import type { AIChatContext } from '@/lib/chimmy-chat'
import { loadChimmyConversation } from '@/lib/chimmy-conversation-service'
import ChimmyMessageBubble, { type ChimmyMessageMeta } from './ChimmyMessageBubble'
import ChimmyConversationThread from './ChimmyConversationThread'
import ChimmyIntentChips from './ChimmyIntentChips'
import ChimmyToolContext from './ChimmyToolContext'
import ChimmyProviderIndicator from './ChimmyProviderIndicator'
import ChimmyVoiceReadyControls from './ChimmyVoiceReadyControls'
import ChimmyAssistantModeSelector from './ChimmyAssistantModeSelector'
import SaveConversationDialog from './SaveConversationDialog'
import ConversationHistorySidebar from './ConversationHistorySidebar'
import { InContextMonetizationCard } from '@/components/monetization/InContextMonetizationCard'
import {
  CHIMMY_DEFAULT_UPGRADE_PATH,
  CHIMMY_GENERIC_ERROR_MESSAGE,
  CHIMMY_PREMIUM_CTA_LABEL,
} from '@/lib/chimmy-chat/response-copy'
import { getChimmyFeatureFlags } from '@/lib/chimmy-chat/feature-flags'
import {
  getVoiceConfig,
  playChimmyVoice,
  saveVoiceConfig,
  stopCurrentVoice,
  type VoiceConfig,
} from '@/lib/chimmy-voice'
import { DEFAULT_VOICE_ID, getChimmyVoiceLabel, readStoredChimmyVoiceId } from '@/lib/tts/voices'
import { triggerChimmyVoiceListenNudge } from '@/lib/chimmy-chat/voiceEngagementNudge'
import { normalizeToSupportedSport, SUPPORTED_SPORTS, type SupportedSport } from '@/lib/sport-scope'
import { useChimmyAutoTradeEval } from '@/hooks/useChimmyAutoTradeEval'
import {
  trackChimmyAIEvent,
  trackChimmyModeChangeEvent,
} from '@/lib/chimmy-chat/analytics-events-client'
import { buildChimmyFeedbackEvent } from '@/lib/chimmy-chat/feedback-events'
import {
  DEFAULT_CHIMMY_ASSISTANT_MODE,
  normalizeChimmyAssistantMode,
  type ChimmyAssistantMode,
} from '@/lib/chimmy-chat/assistant-mode'
import type { ChimmyFollowUpChip } from '@/lib/chimmy-chat/smart-followups'

export type ChimmyChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  imageUrl?: string | null
  meta?: ChimmyMessageMeta | null
}

const CHIMMY_GREETING =
  "I'm Chimmy — your calm, evidence-based fantasy assistant. Ask about trades, waivers, drafts, or your league. I'll keep it clear and data-backed."

function createMessageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `chimmy-msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function buildGreetingMessage(): ChimmyChatMessage {
  return {
    id: 'chimmy-greeting',
    role: 'assistant',
    content: CHIMMY_GREETING,
  }
}

function ensureMessageIds(messages: ChimmyChatMessage[]): ChimmyChatMessage[] {
  return messages.map((message) => ({
    ...message,
    id: message.id || createMessageId(),
  }))
}

export interface ChimmyToolContextValue {
  toolName?: string
  summary?: string
  leagueName?: string | null
  sport?: string | null
}

export interface ChimmyChatShellProps {
  /** Prefill input from URL or tool handoff */
  initialPrompt?: string
  /** Clear URL prompt after applying (default true) */
  clearUrlPromptAfterUse?: boolean
  /** Optional league context for chips */
  leagueName?: string | null
  /** Optional league id for targeted context queries */
  leagueId?: string | null
  /** Optional sleeper username for enrichment */
  sleeperUsername?: string | null
  /** Optional insight type for targeted AI routing */
  insightType?: 'matchup' | 'playoff' | 'dynasty' | 'trade' | 'waiver' | 'draft'
  /** Optional team id for team-scoped insight routes */
  teamId?: string | null
  /** Optional sport context */
  sport?: string | null
  /** Optional season context */
  season?: number | null
  /** Optional week/period context */
  week?: number | null
  /** Optional thread/conversation context for DM-aware AI mode. */
  conversationId?: string | null
  /** Optional private mode target for DM AI chat. */
  privateMode?: boolean
  /** Optional DM username target for private AI mode. */
  targetUsername?: string | null
  /** Optional strategy mode label for AI routing hints. */
  strategyMode?: string | null
  /** Optional source tag for orchestration context/routing hints. */
  source?: AIChatContext['source']
  /** Optional: on "Save conversation" (placeholder) */
  onSaveConversation?: () => void
  /** Optional: compact mode (e.g. drawer) */
  compact?: boolean
  /** When provided, show close button and call on close (drawer/split) */
  onClose?: () => void
  /** Tool context when opened from "Open result in Chimmy" */
  toolContext?: ChimmyToolContextValue | null
  /** Optional: open provider comparison (e.g. modal or route) */
  onOpenCompare?: () => void
  /** Deep link to Start A vs B decision tool (lineup / start-sit handoff) */
  startSitDecisionHref?: string | null
  /** Voice profile preset (reserved for compatibility). */
  voicePreset?: ChimmyVoicePreset
  /** Enable speech input control (default true). */
  enableSpeechInput?: boolean
  className?: string
}

declare global {
  interface Window {
    SpeechRecognition?: any
    webkitSpeechRecognition?: any
  }
}

export default function ChimmyChatShell({
  initialPrompt = '',
  clearUrlPromptAfterUse = true,
  leagueName,
  leagueId,
  sleeperUsername,
  insightType,
  teamId,
  sport,
  season,
  week,
  conversationId,
  privateMode = false,
  targetUsername,
  strategyMode,
  source,
  onSaveConversation,
  compact = false,
  onClose,
  toolContext,
  onOpenCompare,
  startSitDecisionHref = null,
  voicePreset: _voicePreset = 'calm',
  enableSpeechInput = true,
  className = '',
}: ChimmyChatShellProps) {
  const [messages, setMessages] = useState<ChimmyChatMessage[]>([
    buildGreetingMessage(),
  ])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig>(() => getVoiceConfig())
  const [isVoicePlaying, setIsVoicePlaying] = useState(false)
  const [voiceMessageId, setVoiceMessageId] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [lastMeta, setLastMeta] = useState<Record<string, string> | null>(null)
  const [ttsUnavailable, setTtsUnavailable] = useState(false)
  const [ttsLoading, setTtsLoading] = useState(false)
  const [speechInputUnavailable, setSpeechInputUnavailable] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [retryLoading, setRetryLoading] = useState(false)
  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState(DEFAULT_VOICE_ID)
  // Conversation persistence state
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [showHistorySidebar, setShowHistorySidebar] = useState(false)
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [isLoadingConversation, setIsLoadingConversation] = useState(false)
  const [feedbackByMessageId, setFeedbackByMessageId] = useState<Record<string, 'helpful' | 'unhelpful'>>({})
  const [assistantMode, setAssistantMode] = useState<ChimmyAssistantMode>(() =>
    normalizeChimmyAssistantMode(strategyMode ?? DEFAULT_CHIMMY_ASSISTANT_MODE)
  )
  const [scopeSport, setScopeSport] = useState<'all' | SupportedSport>(() =>
    sport ? resolveSportForAIChat(sport, null) : 'all'
  )
  const [scopeLeagueId, setScopeLeagueId] = useState<'all' | string>(() => leagueId ?? 'all')
  const [leagues, setLeagues] = useState<Array<{ id: string; name: string | null; sport: string }>>([])

  const {
    autoTradeEvalEnabled,
    toggleAutoTradeEval,
    autoTradeEvalReady,
  } = useChimmyAutoTradeEval({
    onEvent: (event) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === event.eventId)) return prev
        return [
          ...prev,
          {
            id: event.eventId,
            role: 'assistant',
            content: event.message,
            meta: {
              recommendedTool: 'trade_analyzer',
              dataSources: ['auto_trade_eval'],
            },
          },
        ]
      })
    },
  })

  useLayoutEffect(() => {
    setElevenLabsVoiceId(readStoredChimmyVoiceId())
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/league/list', { credentials: 'include' })
        if (!r.ok) return
        const data = (await r.json()) as { leagues?: unknown[] }
        const raw = Array.isArray(data?.leagues) ? data.leagues : []
        const mapped = raw
          .map((row) => {
            const o = row as Record<string, unknown>
            const id = typeof o.id === 'string' ? o.id : ''
            if (!id) return null
            return {
              id,
              name: typeof o.name === 'string' ? o.name : null,
              sport: typeof o.sport === 'string' ? o.sport : 'NFL',
            }
          })
          .filter((x): x is { id: string; name: string | null; sport: string } => x != null)
        if (!cancelled) setLeagues(mapped)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const transcriptRef = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<any>(null)
  const imageFileInputRef = useRef<HTMLInputElement>(null)
  const initialPromptApplied = useRef(false)
  const sendingRef = useRef(false)
  const sendMessageRef = useRef<((overrideText?: string) => Promise<void>) | null>(null)

  const filteredLeagues = useMemo(() => {
    if (scopeSport === 'all') return leagues
    return leagues.filter((l) => normalizeToSupportedSport(l.sport) === scopeSport)
  }, [leagues, scopeSport])

  useEffect(() => {
    if (scopeLeagueId === 'all') return
    const ok = filteredLeagues.some((l) => l.id === scopeLeagueId)
    if (!ok) setScopeLeagueId('all')
  }, [filteredLeagues, scopeLeagueId])

  const displayLeagueName = useMemo(() => {
    if (scopeLeagueId !== 'all') {
      const row = leagues.find((l) => l.id === scopeLeagueId)
      if (row?.name) return row.name
    }
    return leagueName ?? undefined
  }, [scopeLeagueId, leagues, leagueName])

  const hasUserMessage = useMemo(() => messages.some((m) => m.role === 'user'), [messages])
  const lastAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!
      if (m.role === 'assistant') return m
    }
    return null
  }, [messages])
  const showPlayLastReplyBar =
    hasUserMessage &&
    !!lastAssistantMessage &&
    lastAssistantMessage.content.trim().length > 40 &&
    !voiceConfig.enabled &&
    !ttsUnavailable
  const requestContext = useMemo((): AIChatContext => {
    const effectiveLeagueId = scopeLeagueId !== 'all' ? scopeLeagueId : undefined
    const selected = effectiveLeagueId ? leagues.find((l) => l.id === effectiveLeagueId) : undefined
    const sportOut = selected
      ? normalizeToSupportedSport(selected.sport)
      : scopeSport !== 'all'
        ? scopeSport
        : undefined
    const sportScopeOut = scopeSport === 'all' && !selected ? ('all' as const) : undefined

    return {
      leagueId: effectiveLeagueId,
      leagueName: selected?.name ?? undefined,
      sportScope: sportScopeOut,
      sleeperUsername: sleeperUsername ?? undefined,
      insightType,
      teamId: teamId ?? undefined,
      sport: sportOut,
      season: season ?? undefined,
      week: week ?? undefined,
      conversationId: conversationId ?? undefined,
      privateMode,
      targetUsername: targetUsername ?? undefined,
      assistantMode,
      strategyMode: assistantMode,
      source: source ?? (privateMode ? "messages_dm_ai" : "messages_ai"),
    }
  }, [
    assistantMode,
    conversationId,
    insightType,
    leagues,
    privateMode,
    scopeLeagueId,
    scopeSport,
    season,
    sleeperUsername,
    source,
    targetUsername,
    teamId,
    week,
  ])
  const analyticsSurface = useMemo(() => {
    const sourceKey = (requestContext.source ?? '').toLowerCase()
    if (sourceKey.includes('war_room')) return 'war_room' as const
    if (sourceKey.includes('draft')) return 'draft_room' as const
    if (sourceKey.includes('waiver')) return 'waiver' as const
    if (sourceKey.includes('trade')) return 'trade' as const
    if (sourceKey.includes('player')) return 'player_profile' as const
    return requestContext.leagueId ? ('league' as const) : ('dashboard' as const)
  }, [requestContext.leagueId, requestContext.source])
  const analyticsMode = assistantMode
  const threadStorageKey = useMemo(
    () =>
      getAIThreadStorageKey({
        leagueId: requestContext.leagueId,
        sport: requestContext.sport,
        sportScope: requestContext.sportScope,
        insightType,
        teamId: teamId ?? undefined,
        conversationId: conversationId ?? undefined,
      }),
    [conversationId, insightType, requestContext.leagueId, requestContext.sport, requestContext.sportScope, teamId]
  )

  const canCompare = lastMeta && Object.keys(lastMeta).length > 1
  const chimmyFeatureFlags = useMemo(() => getChimmyFeatureFlags(), [])

  useEffect(() => {
    if (!chimmyFeatureFlags.assistantModes) return
    if (typeof window === 'undefined') return
    const storageKey = `chimmy:assistant-mode:${threadStorageKey}`
    const rawStored = window.sessionStorage.getItem(storageKey)
    if (!rawStored) return
    setAssistantMode(normalizeChimmyAssistantMode(rawStored))
  }, [chimmyFeatureFlags.assistantModes, threadStorageKey])

  useEffect(() => {
    if (!chimmyFeatureFlags.assistantModes) return
    if (typeof window === 'undefined') return
    const storageKey = `chimmy:assistant-mode:${threadStorageKey}`
    window.sessionStorage.setItem(storageKey, assistantMode)
  }, [assistantMode, chimmyFeatureFlags.assistantModes, threadStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setSpeechInputUnavailable(true)
    }
  }, [])

  /** ElevenLabs must return audio — browser speech alone is not enough for "Voice on". */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (typeof window === 'undefined') return
      const hasAudioApi = typeof Audio !== 'undefined' && typeof window.URL?.createObjectURL === 'function'
      if (!hasAudioApi) {
        if (!cancelled) setTtsUnavailable(true)
        return
      }
      try {
        const r = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ text: 'test', voiceId: elevenLabsVoiceId }),
        })
        const ct = r.headers.get('content-type') || ''
        const ok = r.ok && (ct.includes('audio') || ct.includes('mpeg'))
        if (cancelled) return
        setTtsUnavailable(!ok)
        if (!ok) {
          setVoiceConfig((current) => {
            if (!current.enabled) return current
            return saveVoiceConfig({ ...current, enabled: false })
          })
        }
      } catch {
        if (!cancelled) {
          setTtsUnavailable(true)
          setVoiceConfig((current) => {
            if (!current.enabled) return current
            return saveVoiceConfig({ ...current, enabled: false })
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [elevenLabsVoiceId])

  useEffect(() => {
    if (initialPrompt && !initialPromptApplied.current) {
      setInput(initialPrompt)
      initialPromptApplied.current = true
      if (clearUrlPromptAfterUse && typeof window !== 'undefined') {
        const u = new URL(window.location.href)
        if (u.searchParams.has('prompt')) {
          u.searchParams.delete('prompt')
          window.history.replaceState({}, '', u.pathname + u.search)
        }
      }
    }
  }, [initialPrompt, clearUrlPromptAfterUse])

  useEffect(() => {
    const restored = loadAIThreadMessages(threadStorageKey)
    if (restored.length > 0) {
      setMessages(ensureMessageIds(restored as ChimmyChatMessage[]))
      return
    }
    setMessages([buildGreetingMessage()])
  }, [threadStorageKey])

  useEffect(() => {
    saveAIThreadMessages(threadStorageKey, messages)
  }, [messages, threadStorageKey])

  useEffect(() => {
    return () => stopCurrentVoice()
  }, [])

  useEffect(() => {
    if (!enableSpeechInput) return
    if (typeof window === 'undefined') return
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return
    const recognition = new SpeechRecognition()
    recognition.lang = 'en-US'
    recognition.interimResults = false
    recognition.continuous = false
    recognition.onstart = () => {
      setIsListening(true)
      setInlineError(null)
    }
    recognition.onend = () => setIsListening(false)
    recognition.onerror = () => {
      setIsListening(false)
      toast.error('Voice input failed. Try again.')
    }
    recognition.onresult = (e: any) => {
      const t = e?.results?.[0]?.[0]?.transcript?.trim() || ''
      if (t) {
        setInput(t)
        const send = sendMessageRef.current
        if (send) {
          void send(t)
        }
      }
    }
    recognitionRef.current = recognition
    return () => {
      try {
        recognition.stop()
      } catch {}
      recognitionRef.current = null
    }
  }, [enableSpeechInput])

  const updateVoiceConfig = useCallback((patch: Partial<VoiceConfig>) => {
    setVoiceConfig((current) => {
      const next = saveVoiceConfig({ ...current, ...patch })
      return next
    })
  }, [])

  const handleStopVoice = useCallback(() => {
    stopCurrentVoice()
    setTtsLoading(false)
    setIsVoicePlaying(false)
    setVoiceMessageId(null)
  }, [])

  const handleVoiceToggle = useCallback(() => {
    if (ttsUnavailable) {
      toast.warning('Voice unavailable — check ElevenLabs API key in settings')
      return
    }
    const nextEnabled = !voiceConfig.enabled
    updateVoiceConfig({ enabled: nextEnabled })
    if (!nextEnabled) {
      handleStopVoice()
    }
  }, [handleStopVoice, ttsUnavailable, updateVoiceConfig, voiceConfig.enabled])

  const handlePlayVoice = useCallback(
    async (text: string, messageId: string) => {
      if (ttsUnavailable) {
        const message = 'Voice unavailable — check ElevenLabs API key in settings.'
        setInlineError(message)
        toast.error(message)
        return
      }

      if (isVoicePlaying && voiceMessageId === messageId) {
        handleStopVoice()
        return
      }

      setInlineError(null)
      setTtsLoading(true)
      setVoiceMessageId(messageId)

      await playChimmyVoice(
        text,
        voiceConfig,
        () => {
          setTtsLoading(false)
          setIsVoicePlaying(true)
        },
        () => {
          setTtsLoading(false)
          setIsVoicePlaying(false)
          setVoiceMessageId(null)
        },
        (message) => {
          setTtsLoading(false)
          setIsVoicePlaying(false)
          setVoiceMessageId(null)
          setInlineError(message)
          toast.error(message)
        },
        elevenLabsVoiceId,
        true,
      )
    },
    [elevenLabsVoiceId, handleStopVoice, isVoicePlaying, ttsUnavailable, voiceConfig, voiceMessageId]
  )

  const handleFollowUp = useCallback((chip: ChimmyFollowUpChip) => {
    setInput(chip.prompt)
    setInlineError(null)
    if (!chimmyFeatureFlags.aiKpiEvents) return
    void trackChimmyAIEvent({
      event_name: 'followup_click',
      league_id: requestContext.leagueId ?? null,
      surface: analyticsSurface,
      mode: analyticsMode,
      topic: lastAssistantMessage?.meta?.answerContract?.answerType,
      action: 'followup_prompt_selected',
      timestamp: new Date().toISOString(),
      metadata: {
        promptLength: chip.prompt.length,
        promptOrigin: chip.origin,
        answerType: lastAssistantMessage?.meta?.answerContract?.answerType ?? null,
        assistantMode: analyticsMode,
        surface: analyticsSurface,
        previousMessageId: lastAssistantMessage?.id ?? null,
        source: requestContext.source ?? null,
      },
    }).catch(() => {})
  }, [
    analyticsMode,
    analyticsSurface,
    chimmyFeatureFlags.aiKpiEvents,
    lastAssistantMessage,
    requestContext.leagueId,
    requestContext.source,
  ])

  const handleAssistantModeChange = useCallback((nextModeRaw: string) => {
    const nextMode = normalizeChimmyAssistantMode(nextModeRaw)
    if (nextMode === assistantMode) return
    const previousMode = assistantMode
    setAssistantMode(nextMode)

    if (!chimmyFeatureFlags.aiKpiEvents) return

    void trackChimmyModeChangeEvent({
      leagueId: requestContext.leagueId ?? null,
      surface: analyticsSurface,
      mode: nextMode,
      topic: lastAssistantMessage?.meta?.answerContract?.answerType,
      action: 'assistant_mode_selected',
      previousMode,
    }).catch(() => {})
  }, [
    analyticsSurface,
    assistantMode,
    chimmyFeatureFlags.aiKpiEvents,
    lastAssistantMessage,
    requestContext.leagueId,
  ])

  const handleFeedbackSubmit = useCallback((args: { messageId: string; feedback: 'helpful' | 'unhelpful' }) => {
    setFeedbackByMessageId((prev) => ({
      ...prev,
      [args.messageId]: args.feedback,
    }))

    if (!chimmyFeatureFlags.aiKpiEvents) return

    const message = messages.find((m) => m.id === args.messageId)

    void trackChimmyAIEvent(
      buildChimmyFeedbackEvent({
        messageId: args.messageId,
        feedback: args.feedback,
        leagueId: requestContext.leagueId ?? null,
        surface: analyticsSurface,
        mode: analyticsMode,
        source: requestContext.source ?? null,
        topic: message?.meta?.answerContract?.answerType,
      })
    ).catch(() => {})
  }, [
    analyticsMode,
    analyticsSurface,
    chimmyFeatureFlags.aiKpiEvents,
    messages,
    requestContext.leagueId,
    requestContext.source,
  ])

  const handleSpeechInputToggle = useCallback(() => {
    if (!enableSpeechInput) return
    if (speechInputUnavailable) {
      toast.error('Voice input is unavailable on this browser.')
      return
    }
    const recognition = recognitionRef.current
    if (!recognition) {
      toast.error('Voice input is unavailable on this browser.')
      return
    }
    try {
      if (isListening) {
        recognition.stop()
      } else {
        recognition.start()
      }
    } catch {
      toast.error('Could not start voice input.')
    }
  }, [enableSpeechInput, isListening, speechInputUnavailable])

  const runSend = useCallback(
    async (
      outgoingText: string,
      image: File | null,
      conversationBeforeUser: ChimmyChatMessage[],
      options?: { replaceLastAssistant?: boolean }
    ) => {
      const userMsg: ChimmyChatMessage = {
        id: createMessageId(),
        role: 'user',
        content: outgoingText.trim() || 'Analyze this screenshot.',
        imageUrl: image ? null : undefined,
      }
      if (chimmyFeatureFlags.aiKpiEvents) {
        void trackChimmyAIEvent({
          event_name: 'message_send',
          league_id: requestContext.leagueId ?? null,
          surface: analyticsSurface,
          mode: analyticsMode,
          topic: undefined,
          action: 'message_submit',
          timestamp: new Date().toISOString(),
          metadata: {
            messageLength: outgoingText.trim().length,
            hasImage: Boolean(image),
            source: requestContext.source ?? null,
          },
        }).catch(() => {})
      }
      const assistantMessageId = createMessageId()
      let streamedAssistantHandled = false
      const result = await sendChimmyMessage({
        message: outgoingText,
        imageFile: image,
        conversation: [...conversationBeforeUser, userMsg],
        context: requestContext,
        onChunk: (text) => {
          streamedAssistantHandled = true
          const partialAssistant: ChimmyChatMessage = {
            id: assistantMessageId,
            role: 'assistant',
            content: text,
            meta: null,
          }

          if (options?.replaceLastAssistant) {
            setMessages((prev) => [...prev.slice(0, -1), partialAssistant])
            return
          }

          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (last?.role === 'assistant') {
              return [...prev.slice(0, -1), partialAssistant]
            }
            return [...prev, partialAssistant]
          })
        },
      })

      if (!result.ok && result.error) {
        setInlineError(result.error)
        toast.error(result.error)
      } else if (result.upgradeRequired) {
        setInlineError(null)
      } else {
        setInlineError(null)
      }

      const reply = result.response || CHIMMY_GENERIC_ERROR_MESSAGE
      const meta = result.meta
      const providerStatus: ChimmyMessageMeta['providerStatus'] = meta?.providerStatus

      const assistantMsg: ChimmyChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: reply,
        meta: {
          mode: result.meta?.mode,
          answerContract: result.meta?.answerContract,
          confidencePct: result.meta?.confidencePct,
          providerStatus,
          recommendedTool: result.meta?.recommendedTool,
          dataSources: result.meta?.dataSources,
          sourceLinks: result.meta?.sourceLinks,
          syncFreshness: result.meta?.syncFreshness,
          quantData: result.meta?.quantData,
          trendData: result.meta?.trendData,
          responseStructure: result.meta?.responseStructure,
          variant:
            result.meta?.variant ??
            (result.upgradeRequired ? 'premium_gate' : !result.ok ? 'error' : undefined),
          ctaLabel:
            result.meta?.ctaLabel ??
            (result.upgradeRequired ? CHIMMY_PREMIUM_CTA_LABEL : undefined),
          ctaHref:
            result.meta?.ctaHref ??
            (result.upgradeRequired ? result.upgradePath ?? CHIMMY_DEFAULT_UPGRADE_PATH : undefined),
        },
      }

      setLastMeta(providerStatus ?? null)
      if (options?.replaceLastAssistant || streamedAssistantHandled) {
        setMessages((prev) => [...prev.slice(0, -1), assistantMsg])
      } else {
        setMessages((prev) => [...prev, assistantMsg])
      }
      if (
        voiceConfig.enabled &&
        voiceConfig.autoPlay &&
        assistantMsg.meta?.variant !== 'premium_gate' &&
        assistantMsg.meta?.variant !== 'error'
      ) {
        void handlePlayVoice(assistantMsg.content, assistantMsg.id)
      }
      triggerChimmyVoiceListenNudge({
        ttsAvailable: !ttsUnavailable,
        voiceEnabled: voiceConfig.enabled,
        replyText: reply,
        skipForContent:
          assistantMsg.meta?.variant === 'premium_gate' ||
          assistantMsg.meta?.variant === 'error' ||
          !result.ok,
      })
      if (chimmyFeatureFlags.aiKpiEvents) {
        void trackChimmyAIEvent({
          event_name: 'response_rendered',
          league_id: requestContext.leagueId ?? null,
          surface: analyticsSurface,
          mode: analyticsMode,
          topic: result.meta?.answerContract?.answerType,
          action: result.ok ? 'response_success' : 'response_error',
          timestamp: new Date().toISOString(),
          metadata: {
            responseLength: reply.length,
            streamed: streamedAssistantHandled,
            upgradeRequired: Boolean(result.upgradeRequired),
            source: requestContext.source ?? null,
          },
        }).catch(() => {})
      }
    },
    [analyticsMode, analyticsSurface, chimmyFeatureFlags.aiKpiEvents, handlePlayVoice, requestContext, ttsUnavailable, voiceConfig]
  )

  const sendMessage = useCallback(async (overrideText?: string | unknown) => {
    const normalizedOverride = typeof overrideText === 'string' ? overrideText : undefined
    const outgoingText = (normalizedOverride ?? input).trim()
    const fromSpeech = normalizedOverride !== undefined
    if (!outgoingText && !imageFile) return
    if (sendingRef.current) return
    sendingRef.current = true

    const priorThread = messages
    const outImage = fromSpeech ? null : imageFile

    const userMsg: ChimmyChatMessage = {
      id: createMessageId(),
      role: 'user',
      content: outgoingText,
      imageUrl: fromSpeech ? null : imagePreview || null,
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    if (!fromSpeech) {
      setImagePreview(null)
      setImageFile(null)
      if (imageFileInputRef.current) {
        imageFileInputRef.current.value = ''
      }
    }
    setIsTyping(true)
    setLastMeta(null)
    setInlineError(null)

    try {
      await runSend(outgoingText, outImage, priorThread)
    } catch {
      setInlineError(CHIMMY_GENERIC_ERROR_MESSAGE)
      toast.error(CHIMMY_GENERIC_ERROR_MESSAGE)
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: 'assistant',
          content: CHIMMY_GENERIC_ERROR_MESSAGE,
          meta: { variant: 'error' },
        },
      ])
    } finally {
      setIsTyping(false)
      sendingRef.current = false
    }
  }, [input, imageFile, imagePreview, messages, runSend])

  sendMessageRef.current = sendMessage

  const handleRetry = useCallback(async () => {
    const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user')
    if (lastUserIdx === -1) return
    const lastUserMsg = messages[lastUserIdx]
    if (!lastUserMsg) return
    if (sendingRef.current || retryLoading) return

    sendingRef.current = true
    setRetryLoading(true)
    setIsTyping(true)
    setLastMeta(null)
    setInlineError(null)

    try {
      await runSend(lastUserMsg.content, null, messages.slice(0, lastUserIdx), {
        replaceLastAssistant: true,
      })
    } catch {
      setInlineError(CHIMMY_GENERIC_ERROR_MESSAGE)
      toast.error(CHIMMY_GENERIC_ERROR_MESSAGE)
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: 'assistant',
          content: CHIMMY_GENERIC_ERROR_MESSAGE,
          meta: { variant: 'error' },
        },
      ])
    } finally {
      setIsTyping(false)
      setRetryLoading(false)
      sendingRef.current = false
    }
  }, [messages, runSend, retryLoading])

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image.')
      return
    }
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = () => setImagePreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleSelectConversation = useCallback(async (conversationId: string) => {
    setIsLoadingConversation(true)
    try {
      const loaded = await loadChimmyConversation(conversationId)
      // Convert API format to ChimmyChatMessage format
      const convertedMessages: ChimmyChatMessage[] = loaded.messages.map((msg) => ({
        id: msg.id,
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
        meta: msg.meta as ChimmyMessageMeta | null,
      }))
      setMessages(ensureMessageIds(convertedMessages))
      setCurrentConversationId(conversationId)
      setInput('')
      setInlineError(null)
      toast.success(`Loaded: ${loaded.title}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load conversation'
      toast.error(msg)
    } finally {
      setIsLoadingConversation(false)
    }
  }, [])

  const handleCopyResponse = useCallback(() => {
    const last = [...messages].reverse().find((m) => m.role === 'assistant')
    const structure = last?.meta?.responseStructure
    const structuredText = structure
      ? [
          `Short Answer: ${structure.shortAnswer}`,
          structure.whatDataSays ? `What the Data Says: ${structure.whatDataSays}` : '',
          structure.whatItMeans ? `What It Means: ${structure.whatItMeans}` : '',
          structure.recommendedAction ? `Recommended Action: ${structure.recommendedAction}` : '',
          structure.caveats && structure.caveats.length > 0 ? `Caveats: ${structure.caveats.join(' | ')}` : '',
        ]
          .filter(Boolean)
          .join('\n\n')
      : ''
    const textToCopy = structuredText || last?.content

    if (textToCopy && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(textToCopy)
      toast.success('Copied to clipboard.')
      setInlineError(null)
      return
    }
    setInlineError('Clipboard is unavailable in this browser.')
    toast.error('Clipboard is unavailable.')
  }, [messages])

  const lastIsAssistant = messages.length > 0 && messages[messages.length - 1]?.role === 'assistant'
  const showRetry = lastIsAssistant && messages.length >= 2 && !isTyping

  return (
    <div
      className={cn(
        'touch-scroll flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/30',
        compact ? 'min-h-[400px]' : 'h-fill-dynamic min-h-[420px]',
        className,
      )}
      data-testid="chimmy-chat-shell"
    >
      <header className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-white/[0.03] p-3 sm:gap-3 sm:p-4">
        <div className="flex min-w-0 flex-1 basis-[min(100%,280px)] items-center gap-2 sm:gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center text-lg shrink-0">
            *
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-white truncate">Chimmy</h2>
            <p className="text-[10px] sm:text-xs text-white/50 truncate">
              Calm, evidence-based fantasy assistant
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              data-testid="chimmy-close-button"
              className="ml-auto shrink-0 rounded-lg border border-white/20 bg-white/5 p-2 text-white/70 hover:bg-white/10 min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Close panel"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="-mx-1 flex max-w-full shrink-0 items-center gap-1 overflow-x-auto px-1 scrollbar-none sm:gap-2">
          {/* Save conversation button */}
          <button
            onClick={() => setShowSaveDialog(true)}
            disabled={messages.length <= 1 || isTyping}
            title="Save conversation"
            className="rounded-lg border border-white/20 bg-white/5 p-2 text-white/70 hover:bg-white/10 hover:text-white/90 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors"
            aria-label="Save conversation"
          >
            <Save className="h-5 w-5" />
          </button>

          {/* Load conversation button */}
          <button
            onClick={() => setShowHistorySidebar(!showHistorySidebar)}
            title="Load conversation from history"
            className={`rounded-lg border ${
              showHistorySidebar
                ? 'border-cyan-500/30 bg-cyan-600/20 text-cyan-400'
                : 'border-white/20 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white/90'
            } p-2 min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors`}
            aria-label="Load conversation from history"
          >
            <History className="h-5 w-5" />
          </button>

          <ChimmyProviderIndicator
            lastMeta={lastMeta}
            onOpenCompare={onOpenCompare}
            canCompare={!!canCompare}
          />
          <ChimmyVoiceReadyControls
            voiceEnabled={voiceConfig.enabled}
            onVoiceToggle={handleVoiceToggle}
            isPlaying={isVoicePlaying}
            onStop={handleStopVoice}
            ttsLoading={ttsLoading}
            ttsUnavailable={ttsUnavailable}
            onSpeechInputToggle={enableSpeechInput ? handleSpeechInputToggle : undefined}
            speechInputUnavailable={speechInputUnavailable}
            isListening={isListening}
            transcriptRef={transcriptRef}
            autoPlay={voiceConfig.autoPlay}
            volume={voiceConfig.volume}
            onVolumeChange={(v) => updateVoiceConfig({ volume: v })}
          />
        </div>
      </header>

      <div className="flex flex-shrink-0 flex-wrap items-end gap-2 border-b border-white/10 bg-[#0a1228]/90 px-3 py-2">
        <ChimmyAssistantModeSelector
          enabled={chimmyFeatureFlags.assistantModes}
          value={assistantMode}
          onChange={handleAssistantModeChange}
        />
        <label className="flex flex-col gap-1 min-w-[120px] flex-1 sm:flex-none">
          <span className="text-[10px] uppercase tracking-wide text-white/45">Sport</span>
          <select
            data-testid="chimmy-scope-sport"
            className="rounded-lg border border-white/15 bg-[#040915] px-2 py-1.5 text-xs text-white/90 focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
            value={scopeSport}
            onChange={(e) => {
              const v = e.target.value
              if (v === 'all') {
                setScopeSport('all')
              } else {
                setScopeSport(normalizeToSupportedSport(v))
              }
            }}
          >
            <option value="all">All sports</option>
            {SUPPORTED_SPORTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 min-w-[160px] flex-[2] sm:flex-none sm:min-w-[220px]">
          <span className="text-[10px] uppercase tracking-wide text-white/45">League</span>
          <select
            data-testid="chimmy-scope-league"
            className="max-w-full rounded-lg border border-white/15 bg-[#040915] px-2 py-1.5 text-xs text-white/90 focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
            value={scopeLeagueId}
            onChange={(e) => {
              const v = e.target.value
              setScopeLeagueId(v)
              if (v !== 'all') {
                const row = leagues.find((l) => l.id === v)
                if (row) setScopeSport(normalizeToSupportedSport(row.sport))
              }
            }}
          >
            <option value="all">All leagues</option>
            {filteredLeagues.map((l) => (
              <option key={l.id} value={l.id}>
                {(l.name || 'League').slice(0, 48)} ({normalizeToSupportedSport(l.sport)})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center justify-between border-b border-white/10 bg-[#080f22] px-3 py-1.5 text-[11px] text-white/45">
        <span>Auto trade eval</span>
        <button
          type="button"
          onClick={toggleAutoTradeEval}
          className={`rounded-md border px-2 py-0.5 transition ${
            autoTradeEvalEnabled
              ? 'border-cyan-400/30 bg-cyan-500/15 text-cyan-200'
              : 'border-white/15 bg-white/[0.03] text-white/50'
          }`}
          aria-label="Toggle auto trade evaluation messages"
          data-testid="chimmy-shell-auto-trade-eval-toggle"
          disabled={!autoTradeEvalReady}
        >
          {autoTradeEvalEnabled ? 'On' : 'Off'}
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5">
        <InContextMonetizationCard
          title="Chimmy message access"
          featureId="ai_chat"
          tokenRuleCodes={['ai_chimmy_chat_message']}
          className="mb-2"
          testIdPrefix="chimmy-monetization"
        />
        {toolContext && (
          <ChimmyToolContext
            toolName={toolContext.toolName}
            summary={toolContext.summary}
            leagueName={toolContext.leagueName}
            sport={toolContext.sport}
          />
        )}

        <ChimmyIntentChips
          enabled={chimmyFeatureFlags.intentChips}
          hasUserMessage={hasUserMessage}
          leagueId={requestContext.leagueId ?? null}
          leagueName={displayLeagueName ?? null}
          surface={analyticsSurface}
          assistantMode={analyticsMode}
          source={requestContext.source ?? null}
          onSendPrompt={(prompt) => sendMessage(prompt)}
          onTrackEvent={
            chimmyFeatureFlags.aiKpiEvents
              ? (event) => trackChimmyAIEvent(event)
              : undefined
          }
          maxVisible={4}
        />

        <ChimmyConversationThread
          messages={messages}
          isTyping={isTyping}
          onFollowUpClick={handleFollowUp}
          onFeedbackSubmit={handleFeedbackSubmit}
          feedbackByMessageId={feedbackByMessageId}
          onPlayVoice={handlePlayVoice}
          onVoiceEnabledToggle={handleVoiceToggle}
          voiceEnabled={voiceConfig.enabled}
          voiceLoadingId={ttsLoading ? voiceMessageId : null}
          voicePlayingId={isVoicePlaying ? voiceMessageId : null}
          voiceDisplayName={getChimmyVoiceLabel(elevenLabsVoiceId)}
          showTrustPanel={chimmyFeatureFlags.trustPanel}
          enableFollowUps={chimmyFeatureFlags.followups}
          className="chimmy-conversation-thread"
        />
      </div>

      <div className="flex-shrink-0 space-y-2 border-t border-white/10 bg-white/[0.03] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
        {isTyping && (
          <p className="text-[11px] text-white/55" data-testid="chimmy-loading-state">
            Chimmy is preparing a response...
          </p>
        )}
        {inlineError && (
          <p className="text-[11px] text-amber-300" data-testid="chimmy-inline-error">
            {inlineError}
          </p>
        )}
        {imagePreview && (
          <div className="flex items-center gap-2 p-2 rounded-xl bg-white/5">
            <img src={imagePreview} alt="Message preview" className="w-14 h-14 object-cover rounded-lg" />
            <button
              type="button"
              onClick={() => {
                setImagePreview(null)
                setImageFile(null)
              }}
              className="text-xs text-red-300 hover:text-red-200"
              aria-label="Remove image"
            >
              Remove
            </button>
          </div>
        )}

        {showPlayLastReplyBar && lastAssistantMessage ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2">
            <span className="text-[11px] text-white/55">Voice off — tap to hear the latest reply</span>
            <button
              type="button"
              onClick={() => void handlePlayVoice(lastAssistantMessage.content, lastAssistantMessage.id)}
              disabled={ttsLoading}
              data-testid="chimmy-play-last-reply"
              aria-label="Play last Chimmy reply"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-400/35 bg-cyan-500/15 px-2.5 py-1.5 text-xs font-medium text-cyan-100 transition hover:bg-cyan-500/25 disabled:opacity-50 min-h-[36px]"
            >
              <Volume2 className="h-4 w-4" aria-hidden />
              Play last reply
            </button>
          </div>
        ) : null}

        <div className="flex gap-2">
          <label className="flex-shrink-0 w-11 h-11 rounded-xl border border-white/20 bg-white/5 flex items-center justify-center cursor-pointer hover:bg-white/10 min-h-[44px]">
            <ImageIcon className="h-5 w-5 text-cyan-400/80" />
            <input
              ref={imageFileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              data-testid="chimmy-image-upload-input"
              className="hidden"
              aria-label="Upload image for Chimmy message"
            />
          </label>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            placeholder="Ask about trades, waivers, drafts, or your league…"
            className="flex-1 min-w-0 rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-cyan-500/40 focus:outline-none disabled:opacity-50"
            disabled={isTyping}
            aria-label="Message"
            data-testid="chimmy-message-input"
          />

          <button
            type="button"
            onClick={sendMessage}
            disabled={isTyping || (!input.trim() && !imageFile)}
            data-testid="chimmy-send-button"
            className="flex-shrink-0 w-11 h-11 rounded-xl bg-cyan-500/20 border border-cyan-400/30 flex items-center justify-center text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50 min-h-[44px]"
            aria-label="Send message"
          >
            {isTyping ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </div>

        <div className="flex items-center justify-between text-[10px] text-white/40 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            {startSitDecisionHref ? (
              <Link
                href={startSitDecisionHref}
                data-testid="chimmy-start-sit-tool-link"
                className="text-cyan-300/90 hover:text-cyan-100 underline underline-offset-2"
              >
                Start A vs B tool
              </Link>
            ) : null}
            <button
              type="button"
              onClick={handleCopyResponse}
              data-testid="chimmy-copy-response-button"
              className="hover:text-white/60"
              aria-label="Copy response"
            >
              Copy response
            </button>
            {showRetry && (
              <button
                type="button"
                onClick={handleRetry}
                disabled={retryLoading}
                data-testid="chimmy-retry-button"
                className="inline-flex items-center gap-1 hover:text-white/60 disabled:opacity-50"
                aria-label="Retry"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${retryLoading ? 'animate-spin' : ''}`} />
                Retry
              </button>
            )}
          </div>
          {onSaveConversation && (
            <button
              type="button"
              onClick={onSaveConversation}
              data-testid="chimmy-save-conversation-button"
              className="hover:text-white/60"
            >
              Save conversation
            </button>
          )}
        </div>
      </div>

      {/* Conversation persistence UI */}
      <SaveConversationDialog
        isOpen={showSaveDialog}
        messageCount={messages.filter((m) => m.role === 'user').length}
        onClose={() => setShowSaveDialog(false)}
        onSaved={(conversationId) => {
          setCurrentConversationId(conversationId)
        }}
      />

      <ConversationHistorySidebar
        isOpen={showHistorySidebar}
        onClose={() => setShowHistorySidebar(false)}
        onSelectConversation={handleSelectConversation}
        currentConversationId={currentConversationId}
      />
    </div>
  )
}
