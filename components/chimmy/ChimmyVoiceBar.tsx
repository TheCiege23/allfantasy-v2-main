'use client'

import React from 'react'
import { Volume2, VolumeX, Square, Loader2, Mic, MicOff } from 'lucide-react'
import type { ChimmyTtsVoice } from '@/lib/chimmy-interface'

export interface ChimmyVoiceBarProps {
  /** Voice replies enabled (toggle in shell) */
  voiceEnabled: boolean
  onVoiceToggle: () => void
  selectedVoice?: ChimmyTtsVoice
  onVoiceSelect?: (voice: ChimmyTtsVoice) => void
  /** TTS is currently playing */
  isPlaying: boolean
  onStop?: () => void
  /** Future: TTS request in flight */
  ttsLoading?: boolean
  /** When true, disable listen (e.g. no speechSynthesis) */
  ttsUnavailable?: boolean
  /** Speech-to-text availability (web speech recognition). */
  speechInputUnavailable?: boolean
  /** Listening state for speech input. */
  isListening?: boolean
  /** Toggle speech input (start/stop). */
  onSpeechInputToggle?: () => void
  /** Container for transcript sync / highlight (future) */
  transcriptRef?: React.RefObject<HTMLDivElement>
  /** When true, auto-play is active — show volume nudge */
  autoPlay?: boolean
  /** Current volume 0–1 (shown in nudge when autoPlay) */
  volume?: number
  /** Volume change handler for inline nudge slider */
  onVolumeChange?: (volume: number) => void
  className?: string
}

/**
 * Voice-ready UI: listen toggle, play/pause (stop), loading, disabled when TTS unavailable.
 * transcriptRef: attach to the message container for future word-level sync.
 */
export default function ChimmyVoiceBar({
  voiceEnabled,
  onVoiceToggle,
  selectedVoice = 'rachel',
  onVoiceSelect,
  isPlaying,
  onStop,
  ttsLoading = false,
  ttsUnavailable = false,
  speechInputUnavailable = false,
  isListening = false,
  onSpeechInputToggle,
  transcriptRef,
  autoPlay = false,
  volume = 0.85,
  onVolumeChange,
  className = '',
}: ChimmyVoiceBarProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={onVoiceToggle}
        disabled={ttsUnavailable}
        data-testid="chimmy-voice-toggle-button"
        className="rounded-lg border border-white/20 bg-white/5 p-2 text-white/70 hover:bg-white/10 hover:text-white/90 disabled:cursor-not-allowed disabled:opacity-40 min-h-[44px] min-w-[44px] flex items-center justify-center"
        title={
          ttsUnavailable
            ? "Voice unavailable right now"
            : voiceEnabled
              ? 'Voice on'
              : 'Voice off'
        }
        aria-label={
          ttsUnavailable ? 'Voice unavailable' : voiceEnabled ? 'Turn voice off' : 'Turn voice on'
        }
      >
        {voiceEnabled ? (
          <Volume2 className="h-5 w-5 text-cyan-400/90" />
        ) : (
          <VolumeX className="h-5 w-5 text-white/40" />
        )}
      </button>

      {onVoiceSelect && !ttsUnavailable && (
        <div
          className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1 text-[11px] text-white/60"
          data-testid="chimmy-voice-choice-group"
          aria-label="Select Chimmy voice"
        >
          <span className="px-1 uppercase tracking-wider">Voice</span>
          {(['rachel', 'adam'] as ChimmyTtsVoice[]).map((voice) => {
            const active = selectedVoice === voice
            const label = voice === 'rachel' ? 'Rachel' : 'Adam'

            return (
              <button
                key={voice}
                type="button"
                onClick={() => onVoiceSelect(voice)}
                data-testid={`chimmy-voice-choice-${voice}`}
                className={`rounded-md px-2 py-1 text-[11px] transition ${
                  active
                    ? 'bg-cyan-500/20 text-cyan-100 border border-cyan-400/30'
                    : 'border border-transparent bg-transparent text-white/65 hover:bg-white/8 hover:text-white'
                }`}
                aria-pressed={active}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

      {isPlaying && onStop && (
        <button
          type="button"
          onClick={onStop}
          data-testid="chimmy-voice-stop-button"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200 flex items-center gap-1.5 min-h-[44px]"
        >
          <Square className="h-3.5 w-3.5" />
          Stop
        </button>
      )}

      {onSpeechInputToggle && (
        <button
          type="button"
          onClick={onSpeechInputToggle}
          disabled={speechInputUnavailable}
          data-testid="chimmy-voice-input-button"
          className={`rounded-lg border p-2 text-white/80 transition min-h-[44px] min-w-[44px] flex items-center justify-center ${
            isListening
              ? 'border-cyan-500/45 bg-cyan-500/15 text-cyan-200'
              : 'border-white/20 bg-white/5 hover:bg-white/10'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          title={speechInputUnavailable ? 'Voice input unavailable' : isListening ? 'Stop voice input' : 'Start voice input'}
          aria-label={speechInputUnavailable ? 'Voice input unavailable' : isListening ? 'Stop voice input' : 'Start voice input'}
        >
          {isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>
      )}

      {voiceEnabled && autoPlay && !ttsUnavailable && !isPlaying && !ttsLoading && (
        <div
          className="flex items-center gap-1.5 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.07] px-2 py-1"
          data-testid="chimmy-autoplay-volume-nudge"
        >
          <span className="text-[11px] uppercase tracking-wider text-cyan-300/70">Auto</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => onVolumeChange?.(Number(e.target.value) / 100)}
            className="h-1 w-16 cursor-pointer accent-cyan-400"
            aria-label="Auto-play volume"
            data-testid="chimmy-autoplay-volume-slider"
          />
          <span className="min-w-[2.5ch] text-[11px] tabular-nums text-white/55">
            {Math.round(volume * 100)}%
          </span>
        </div>
      )}

      {ttsLoading && (
        <span className="flex items-center gap-1.5 text-xs text-white/50">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Preparing audio…
        </span>
      )}

      {ttsUnavailable && (
        <span className="text-[11px] text-white/40">Voice (unavailable)</span>
      )}
      {speechInputUnavailable && onSpeechInputToggle && (
        <span className="text-[11px] text-white/40">Mic unavailable</span>
      )}

      {transcriptRef && <div ref={transcriptRef} className="sr-only" aria-hidden />}
    </div>
  )
}
