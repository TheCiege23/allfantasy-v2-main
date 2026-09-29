/**
 * VoicePlaybackController — server-backed TTS with stop support.
 * ElevenLabs via POST /api/tts; browser speech only when API fails (never on 503).
 */

import type { ChimmyTtsVoice, ChimmyVoicePreset } from "./types";
import { getChimmyVoiceStyleProfile, selectChimmyVoice } from "./ChimmyVoiceStyleProfile";

let currentAudio: HTMLAudioElement | null = null;
let activeObjectUrl: string | null = null;
let activeFetchController: AbortController | null = null;
let activeUtterance: SpeechSynthesisUtterance | null = null;
let activeSessionId = 0;
let activeLoading = false;

function canUseServerAudioPlayback() {
  return (
    typeof window !== "undefined" &&
    typeof Audio !== "undefined" &&
    typeof window.URL?.createObjectURL === "function"
  );
}

function canUseBrowserSpeechFallback() {
  return (
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined" &&
    typeof window.SpeechSynthesisUtterance !== "undefined"
  );
}

/** Strip markdown / noise for TTS (aligned with product voice UX). */
function cleanTextForTts(raw: string): string {
  return raw
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/#{1,6}\s/g, "")
    .replace(/\[.*?\]\(.*?\)/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\u{1F300}-\u{1FFFF}]/gu, "")
    .replace(/[_`]/g, "")
    .trim()
    .slice(0, 800);
}

function cleanupAudioResources() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
  if (activeFetchController) {
    activeFetchController.abort();
    activeFetchController = null;
  }
  activeLoading = false;
}

function cleanupSpeechResources() {
  if (typeof window === "undefined" || typeof window.speechSynthesis === "undefined") return;
  window.speechSynthesis.cancel();
  activeUtterance = null;
}

function fallbackSpeak(text: string, preset: ChimmyVoicePreset, sessionId: number, options?: SpeakChimmyOptions) {
  if (!canUseBrowserSpeechFallback()) return false;

  const sanitizedText = cleanTextForTts(text);
  if (!sanitizedText) {
    options?.onEnd?.();
    return true;
  }

  const synth = window.speechSynthesis;
  const config = getChimmyVoiceStyleProfile(preset);
  const utt = new SpeechSynthesisUtterance(sanitizedText);
  utt.rate = 0.95;
  utt.pitch = 1.05;
  utt.volume = config.volume;

  const voices = synth.getVoices();
  const preferred = voices.find(
    (v) =>
      v.name.includes("Samantha") ||
      v.name.includes("Google US English") ||
      v.name.includes("Karen") ||
      (v.lang === "en-US" && !v.name.includes("Male"))
  );
  if (preferred) utt.voice = preferred;
  else {
    const chosen = selectChimmyVoice(voices, config);
    if (chosen) utt.voice = chosen;
  }

  utt.onend = () => {
    if (activeSessionId !== sessionId) return;
    activeUtterance = null;
    activeLoading = false;
    options?.onEnd?.();
  };

  utt.onerror = () => {
    if (activeSessionId !== sessionId) return;
    activeUtterance = null;
    activeLoading = false;
    options?.onError?.();
    options?.onEnd?.();
  };

  cleanupSpeechResources();
  activeUtterance = utt;
  activeLoading = false;
  synth.speak(utt);
  return true;
}

/**
 * Stop any current Chimmy TTS playback.
 */
export function stopChimmyVoice(): void {
  activeSessionId += 1;
  if (typeof window === "undefined") return;
  cleanupAudioResources();
  cleanupSpeechResources();
}

export interface SpeakChimmyOptions {
  voice?: ChimmyTtsVoice;
  /** 0–1, applied to HTMLAudioElement when using server audio */
  volume?: number;
  /** ElevenLabs voice_id for POST /api/tts */
  elevenLabsVoiceId?: string;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: () => void;
  onUnavailable?: (message: string) => void;
}

/**
 * Speak text with Chimmy's server-backed TTS route. Cancels any current playback first.
 */
export function speakChimmy(
  text: string,
  preset: ChimmyVoicePreset = "calm",
  options?: SpeakChimmyOptions
): () => void {
  if (typeof window === "undefined" || !text?.trim()) {
    return stopChimmyVoice;
  }

  const sessionId = activeSessionId + 1;
  activeSessionId = sessionId;
  cleanupAudioResources();
  cleanupSpeechResources();
  options?.onStart?.();
  activeLoading = true;

  const clean = cleanTextForTts(text);
  if (!clean) {
    activeLoading = false;
    options?.onEnd?.();
    return stopChimmyVoice;
  }

  const hasServerAudioPlayback = canUseServerAudioPlayback();
  const hasBrowserSpeechFallback = canUseBrowserSpeechFallback();

  if (!hasServerAudioPlayback) {
    const didFallback = fallbackSpeak(text, preset, sessionId, options);
    if (!didFallback) {
      activeLoading = false;
      options?.onUnavailable?.("Voice playback is unavailable right now.");
      options?.onEnd?.();
    }
    return stopChimmyVoice;
  }

  const controller = new AbortController();
  activeFetchController = controller;

  void (async () => {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text: clean,
          ...(options?.elevenLabsVoiceId ? { voiceId: options.elevenLabsVoiceId } : {}),
        }),
        signal: controller.signal,
      });

      if (activeSessionId !== sessionId) return;

      if (!res.ok) {
        if (res.status === 503) {
          options?.onUnavailable?.("Voice unavailable right now.");
          options?.onEnd?.();
        } else {
          if (hasBrowserSpeechFallback) {
            const did = fallbackSpeak(text, preset, sessionId, options);
            if (!did) {
              options?.onUnavailable?.("Voice playback is unavailable right now.");
              options?.onEnd?.();
            }
          } else {
            options?.onUnavailable?.("Voice playback is unavailable right now.");
            options?.onEnd?.();
          }
        }
        activeFetchController = null;
        cleanupAudioResources();
        return;
      }

      activeFetchController = null;
      const blob = await res.blob();
      if (activeSessionId !== sessionId) return;

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio = audio;

      const vol =
        typeof options?.volume === "number" && Number.isFinite(options.volume)
          ? Math.min(1, Math.max(0, options.volume))
          : 0.85;
      audio.volume = vol;

      activeObjectUrl = url;
      activeLoading = false;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (currentAudio === audio) currentAudio = null;
        if (activeObjectUrl === url) activeObjectUrl = null;
        if (activeSessionId !== sessionId) return;
        cleanupAudioResources();
        options?.onEnd?.();
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (currentAudio === audio) currentAudio = null;
        if (activeObjectUrl === url) activeObjectUrl = null;
        if (activeSessionId !== sessionId) return;
        cleanupAudioResources();
        if (hasBrowserSpeechFallback) {
          const did = fallbackSpeak(text, preset, sessionId, options);
          if (!did) {
            options?.onError?.();
            options?.onEnd?.();
          }
        } else {
          options?.onError?.();
          options?.onEnd?.();
        }
      };

      await audio.play().catch(() => {
        URL.revokeObjectURL(url);
        if (currentAudio === audio) currentAudio = null;
        if (activeObjectUrl === url) activeObjectUrl = null;
        if (activeSessionId !== sessionId) return;
        cleanupAudioResources();
        if (hasBrowserSpeechFallback) {
          const did = fallbackSpeak(text, preset, sessionId, options);
          if (!did) {
            options?.onError?.();
            options?.onEnd?.();
          }
        } else {
          options?.onError?.();
          options?.onEnd?.();
        }
      });
    } catch (err: unknown) {
      if (activeSessionId !== sessionId) return;
      const aborted = err instanceof DOMException && err.name === "AbortError";
      if (!aborted) {
        if (hasBrowserSpeechFallback) {
          const did = fallbackSpeak(text, preset, sessionId, options);
          if (!did) {
            options?.onError?.();
            options?.onEnd?.();
          }
        } else {
          options?.onError?.();
          options?.onEnd?.();
        }
      }
      cleanupAudioResources();
    }
  })();

  return stopChimmyVoice;
}

/**
 * Whether TTS is currently playing (best-effort).
 */
export function isChimmyVoicePlaying(): boolean {
  if (typeof window === "undefined") return false;
  return (
    activeLoading ||
    Boolean(currentAudio && !currentAudio.paused && !currentAudio.ended) ||
    Boolean(activeUtterance)
  );
}
