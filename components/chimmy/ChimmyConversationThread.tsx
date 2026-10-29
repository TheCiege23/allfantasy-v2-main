'use client'

import React, { useEffect, useRef } from 'react'
import ChimmyMessageBubble, { type ChimmyMessageMeta } from './ChimmyMessageBubble'
import type { ChimmyFollowUpChip } from '@/lib/chimmy-chat/smart-followups'

export type ChimmyConversationMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  imageUrl?: string | null
  meta?: ChimmyMessageMeta | null
}

const FOLLOW_UP_CHIPS = [
  {
    label: 'Explain that in more detail',
    prompt: 'Can you explain that in more detail?',
    origin: 'fallback',
  },
  { label: 'What should I do next?', prompt: 'What should I do next?', origin: 'fallback' },
  { label: 'What are the risks?', prompt: 'What are the risks or caveats?', origin: 'fallback' },
] satisfies ChimmyFollowUpChip[]

export interface ChimmyConversationThreadProps {
  messages: ChimmyConversationMessage[]
  analysisUnlockId?: string
  onAnalysisUnlock?: (id: string) => void
  isTyping?: boolean
  onFollowUpClick?: (chip: ChimmyFollowUpChip) => void
  onFeedbackSubmit?: (args: { messageId: string; feedback: 'helpful' | 'unhelpful' }) => void
  feedbackByMessageId?: Record<string, 'helpful' | 'unhelpful'>
  onPlayVoice?: (text: string, messageId: string) => void
  onVoiceEnabledToggle?: () => void
  voiceEnabled?: boolean
  voiceLoadingId?: string | null
  voicePlayingId?: string | null
  /** Shown on the per-message TTS play button */
  voiceDisplayName?: string
  showTrustPanel?: boolean
  enableFollowUps?: boolean
  className?: string
}

/**
 * Renders the conversation: message bubbles, follow-ups on last assistant message, typing indicator.
 * Calm, clear presentation — no hype.
 */
export default function ChimmyConversationThread({
  messages,
  analysisUnlockId,
  onAnalysisUnlock,
  isTyping = false,
  onFollowUpClick,
  onFeedbackSubmit,
  feedbackByMessageId = {},
  onPlayVoice,
  onVoiceEnabledToggle,
  voiceEnabled = true,
  voiceLoadingId = null,
  voicePlayingId = null,
  voiceDisplayName = 'Voice',
  showTrustPanel = true,
  enableFollowUps = true,
  className = '',
}: ChimmyConversationThreadProps) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  return (
    <div className={`space-y-4 ${className}`}>
      {messages.map((msg, i) => (
        // Premium-lock and error replies should present a clear next step instead of generic follow-ups.
        <ChimmyMessageBubble
          key={msg.id}
          messageId={msg.id}
          role={msg.role}
          content={msg.content}
          imageUrl={msg.imageUrl}
          meta={msg.meta}
          onAnalysisUnlock={msg.id === analysisUnlockId && onAnalysisUnlock ? () => onAnalysisUnlock(msg.id) : undefined}
          analysisBusy={isTyping}
          onFeedbackSubmit={onFeedbackSubmit}
          feedbackSelection={feedbackByMessageId[msg.id] ?? null}
          followUpChips={
            msg.role === 'assistant' &&
            i === messages.length - 1 &&
            !isTyping &&
            enableFollowUps &&
            msg.meta?.variant !== 'premium_gate' &&
            msg.meta?.variant !== 'error'
              ? FOLLOW_UP_CHIPS
              : undefined
          }
          onFollowUpClick={onFollowUpClick}
          showVoiceButton={msg.role === 'assistant' && msg.meta?.variant !== 'premium_gate' && msg.meta?.variant !== 'error'}
          onVoiceToggle={
            onPlayVoice
              ? () => onPlayVoice(msg.content, msg.id)
              : undefined
          }
          onVoiceEnabledToggle={onVoiceEnabledToggle}
          voiceEnabled={voiceEnabled}
          voiceLoading={voiceLoadingId === msg.id}
          voicePlaying={voicePlayingId === msg.id}
          voiceDisplayName={voiceDisplayName}
          showTrustPanel={showTrustPanel}
          enableFollowUps={enableFollowUps}
            isLastAssistantMessage={
              msg.role === 'assistant' &&
              i === messages.length - 1 &&
              !isTyping &&
              msg.meta?.variant !== 'premium_gate' &&
              msg.meta?.variant !== 'error'
            }
        />
      ))}

      {isTyping && (
        <div className="flex justify-start">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <div className="flex items-center gap-2 text-white/50 text-sm">
              <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-bounce" />
              <span
                className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-bounce"
                style={{ animationDelay: '0.15s' }}
              />
              <span
                className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-bounce"
                style={{ animationDelay: '0.3s' }}
              />
              <span className="ml-1">Thinking…</span>
            </div>
          </div>
        </div>
      )}

      <div ref={endRef} aria-hidden />
    </div>
  )
}
