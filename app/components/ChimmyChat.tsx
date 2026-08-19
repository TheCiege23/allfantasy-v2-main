'use client';

import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, type ReactNode } from 'react';
import { Send, Volume2, VolumeX, Image as ImageIcon, Mic, MicOff, Loader2, Square } from 'lucide-react';
import { toast } from 'sonner';
import { getDefaultChimmyChips } from '@/lib/chimmy-interface';
import { isSupportedSport } from '@/lib/sport-scope';
import { isNoChargeChimmyIntent } from '@/lib/ai/chimmyIntentRouter';
import { confirmTokenSpend } from '@/lib/tokens/client-confirm';
import { sendChimmyMessage } from '@/lib/chimmy-chat/ChimmyChatService';
import {
  CHIMMY_DEFAULT_UPGRADE_PATH,
  CHIMMY_GENERIC_ERROR_MESSAGE,
  CHIMMY_PREMIUM_CTA_LABEL,
  CHIMMY_PREMIUM_FEATURE_MESSAGE,
} from '@/lib/chimmy-chat/response-copy';
import {
  getVoiceConfig,
  playChimmyVoice,
  saveVoiceConfig,
  stopCurrentVoice,
  type VoiceConfig,
} from '@/lib/chimmy-voice';
import { triggerChimmyVoiceListenNudge } from '@/lib/chimmy-chat/voiceEngagementNudge';
import { formatChatMessageTimestamp, isChimmyMessageThreaded } from '@/app/dashboard/components/chat/chat-timestamps';
import { ChimmyAssistantAvatar } from '@/app/dashboard/components/chat/ChimmyAssistantAvatar';
import { useChimmyAutoTradeEval } from '@/hooks/useChimmyAutoTradeEval';
import {
  DEFAULT_VOICE_ID,
  getChimmyVoiceLabel,
  readStoredChimmyVoiceId,
} from '@/lib/tts/voices';

const HEART_EMOJI = '\u{1F496}';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string | null;
  upgradePath?: string | null;
  /** Unix ms — for timestamps & threaded grouping */
  createdAt: number;
};

declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }
}

function renderContentWithLinks(content: string) {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<span key={`text-${lastIndex}`}>{content.slice(lastIndex, match.index)}</span>);
    }
    nodes.push(
      <a
        key={`link-${match.index}`}
        href={match[2]}
        className="underline text-cyan-300 hover:text-cyan-200"
      >
        {match[1]}
      </a>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    nodes.push(<span key="text-end">{content.slice(lastIndex)}</span>);
  }

  return <div className="whitespace-pre-wrap">{nodes.length ? nodes : content}</div>;
}

const CHIMMY_GREETING = `Hi, I'm Chimmy ${HEART_EMOJI} I'm your calm, evidence-based fantasy assistant. Ask me about your roster, league, trades, waivers, or upload a screenshot and I'll break it down clearly.`;

function createMessageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `chimmy-msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `chimmy-${Date.now()}`;
}

type ChimmyChatProps = {
  /** Slimmer chrome for dashboard side panels */
  embedded?: boolean
  /** Parent renders New — hide toolbar button and listen for `af-chimmy-new-conversation` */
  parentControlsNew?: boolean
  /** Shown above the message composer (e.g. league context row) */
  footerSlot?: ReactNode
  /** Active league name for suggested chips (truncated inside getDefaultChimmyChips) */
  chipContextLeagueName?: string | null
  /**
   * Real league-grounding context (Cross-League Player/Chimmy seam) — when set,
   * threaded into `sendChimmyMessage`'s `context` so Chimmy uses this league's
   * scoring/SF/TEP/IDP/roster/waiver/trade rules instead of staying general.
   * Previously only `chipContextLeagueName` (chip labels) was forwarded; the
   * actual API call never received the league id, so grounding never activated.
   */
  activeLeagueId?: string | null
  activeLeagueSport?: string | null
  activeLeagueScoring?: string | null
  activeLeagueFormat?: string | null
  /** Fill parent flex column (left panel Chimmy tab): no outer border/radius, flex-1 */
  panelFill?: boolean
  /** ElevenLabs voice id for TTS (optional; otherwise reads `chimmy_voice_id` from localStorage) */
  ttsVoiceId?: string
}

export default function ChimmyChat({
  embedded = false,
  parentControlsNew = false,
  footerSlot,
  chipContextLeagueName = null,
  activeLeagueId = null,
  activeLeagueSport = null,
  activeLeagueScoring = null,
  activeLeagueFormat = null,
  panelFill = false,
  ttsVoiceId: ttsVoiceIdProp,
}: ChimmyChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'chimmy-greeting', role: 'assistant', content: CHIMMY_GREETING, createdAt: Date.now() },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig>(() => getVoiceConfig());
  const [isVoicePlaying, setIsVoicePlaying] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceMessageId, setVoiceMessageId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [sessionId, setSessionId] = useState(() => createSessionId());
  /** Server ElevenLabs TTS must return audio — false when API key missing (503). */
  const [ttsServerReady, setTtsServerReady] = useState<boolean | null>(null);
  const [storedVoiceId, setStoredVoiceId] = useState(DEFAULT_VOICE_ID);

  useLayoutEffect(() => {
    if (ttsVoiceIdProp) return;
    setStoredVoiceId(readStoredChimmyVoiceId());
  }, [ttsVoiceIdProp]);

  const effectiveVoiceId = ttsVoiceIdProp ?? storedVoiceId;
  const voicePlayLabel = getChimmyVoiceLabel(effectiveVoiceId);

  const recognitionRef = useRef<any>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const sendMessageRef = useRef<(overrideText?: string) => Promise<void>>(() => Promise.resolve());
  messagesRef.current = messages;

  const suggestedChips = useMemo(() => {
    const name = chipContextLeagueName?.trim()
    return getDefaultChimmyChips({ leagueName: name ?? undefined, hasLeagues: !!name })
  }, [chipContextLeagueName])

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
            createdAt: Date.now(),
          },
        ]
      })
    },
  })

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
    ttsServerReady === true

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => () => stopCurrentVoice(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === 'undefined') return;
      const hasAudioApi = typeof Audio !== 'undefined' && typeof window.URL?.createObjectURL === 'function';
      if (!hasAudioApi) {
        if (!cancelled) setTtsServerReady(false);
        return;
      }
      try {
        const r = await fetch('/api/tts', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });
        const data = r.ok ? await r.json().catch(() => null) : null;
        const ok = r.ok && data?.available === true;
        if (cancelled) return;
        setTtsServerReady(ok);
        if (!ok) {
          setVoiceConfig((current) => {
            if (!current.enabled) return current;
            return saveVoiceConfig({ ...current, enabled: false });
          });
        }
      } catch {
        if (!cancelled) {
          setTtsServerReady(false);
          setVoiceConfig((current) => {
            if (!current.enabled) return current;
            return saveVoiceConfig({ ...current, enabled: false });
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveVoiceId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => {
      setIsListening(false);
      toast.error('Voice input failed. Please try again.');
    };
    recognition.onresult = (event: any) => {
      const transcript = event?.results?.[0]?.[0]?.transcript?.trim() || '';
      if (!transcript) return;
      setInput(transcript);
      void sendMessageRef.current(transcript);
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.stop();
      } catch {}
    };
  }, []);

  const updateVoiceConfig = useCallback((patch: Partial<VoiceConfig>) => {
    setVoiceConfig((current) => {
      const next = saveVoiceConfig({ ...current, ...patch });
      return next;
    });
  }, []);

  const handleStopVoice = useCallback(() => {
    stopCurrentVoice();
    setIsVoicePlaying(false);
    setVoiceLoading(false);
    setVoiceMessageId(null);
  }, []);

  const handlePlayVoice = useCallback(async (text: string, messageId: string) => {
    if (ttsServerReady === false) {
      toast.error('Voice unavailable — check ElevenLabs API key in settings.');
      return;
    }
    if (ttsServerReady === null) {
      toast.error('Voice is still checking availability…');
      return;
    }

    if (isVoicePlaying && voiceMessageId === messageId) {
      handleStopVoice();
      return;
    }

    setVoiceLoading(true);
    setVoiceMessageId(messageId);

    await playChimmyVoice(
      text,
      voiceConfig,
      () => {
        setVoiceLoading(false);
        setIsVoicePlaying(true);
      },
      () => {
        setVoiceLoading(false);
        setIsVoicePlaying(false);
        setVoiceMessageId(null);
      },
      (message) => {
        setVoiceLoading(false);
        setIsVoicePlaying(false);
        setVoiceMessageId(null);
        toast.error(message);
      },
      effectiveVoiceId,
      true,
    );
  }, [effectiveVoiceId, handleStopVoice, isVoicePlaying, ttsServerReady, voiceConfig, voiceMessageId]);

  const voiceToggleDisabled = ttsServerReady !== true;

  const toggleVoiceReplies = useCallback(() => {
    if (ttsServerReady === false) {
      toast.warning('Voice unavailable — check ElevenLabs API key in settings');
      return;
    }
    if (ttsServerReady === null) return;
    const nextEnabled = !voiceConfig.enabled;
    updateVoiceConfig({ enabled: nextEnabled });
    if (!nextEnabled) handleStopVoice();
  }, [handleStopVoice, ttsServerReady, updateVoiceConfig, voiceConfig.enabled]);

  const startNewConversation = useCallback(() => {
    handleStopVoice();
    setMessages([{ id: 'chimmy-greeting', role: 'assistant', content: CHIMMY_GREETING, createdAt: Date.now() }]);
    setInput('');
    setImagePreview(null);
    setImageFile(null);
    setSessionId(createSessionId());
  }, [handleStopVoice]);

  useEffect(() => {
    if (!embedded || !parentControlsNew) return;
    const onNew = () => startNewConversation();
    window.addEventListener('af-chimmy-new-conversation', onNew);
    return () => window.removeEventListener('af-chimmy-new-conversation', onNew);
  }, [embedded, parentControlsNew, startNewConversation]);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      toast.error('Voice input is not supported on this browser.');
      return;
    }
    try {
      if (isListening) recognitionRef.current.stop();
      else recognitionRef.current.start();
    } catch {
      toast.error('Could not start voice capture.');
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }

    setImageFile(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const sendMessage = async (overrideText?: string) => {
    const outgoingText = (overrideText !== undefined ? overrideText : input).trim();
    if (!outgoingText && !imageFile) return;

    const fromShortcut = overrideText !== undefined;
    const capturedInput = input;
    const capturedImageFile = imageFile;
    const capturedImagePreview = fromShortcut ? null : imagePreview;

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: 'user',
      content: outgoingText || 'Analyze this screenshot and tell me what to do.',
      image: fromShortcut ? null : imagePreview || null,
      createdAt: Date.now(),
    };

    const nextMessages = [...messagesRef.current, userMessage];
    setMessages(nextMessages);
    setInput('');
    setImagePreview(null);
    setImageFile(null);
    if (imageFileInputRef.current) {
      imageFileInputRef.current.value = '';
    }
    setIsTyping(true);

    const skipClientTokenPreflight = outgoingText ? isNoChargeChimmyIntent(outgoingText) : false;
    if (!skipClientTokenPreflight) {
      try {
        const { confirmed, preview } = await confirmTokenSpend('ai_chimmy_chat_message');
        if (!preview.canSpend) {
          setMessages((prev) => [
            ...prev.slice(0, -1),
            {
              id: createMessageId(),
              role: 'assistant',
              content: CHIMMY_PREMIUM_FEATURE_MESSAGE,
              upgradePath: CHIMMY_DEFAULT_UPGRADE_PATH,
              createdAt: Date.now(),
            },
          ]);
          setIsTyping(false);
          return;
        }
        if (!confirmed) {
          setMessages((prev) => prev.slice(0, -1));
          setInput(capturedInput);
          if (capturedImageFile) {
            setImageFile(capturedImageFile);
            setImagePreview(capturedImagePreview);
          }
          setIsTyping(false);
          return;
        }
      } catch (error) {
        console.error(
          '[ChimmyChat] Token preview failed, continuing without preflight:',
          error instanceof Error ? error.message : error
        );
      }
    }

    try {
      let streamedAssistantHandled = false;
      const assistantMessageId = createMessageId();
      const assistantCreatedAt = Date.now();
      const result = await sendChimmyMessage({
        message: outgoingText || '',
        imageFile: fromShortcut ? null : capturedImageFile,
        conversation: nextMessages.slice(-10).map((m) => ({
          role: m.role,
          content: m.content,
          imageUrl: m.image ?? null,
        })),
        context: {
          sessionId,
          ...(activeLeagueId
            ? {
                leagueId: activeLeagueId,
                leagueName: chipContextLeagueName ?? undefined,
                sport: isSupportedSport(activeLeagueSport) ? activeLeagueSport : undefined,
                scoring: activeLeagueScoring ?? undefined,
                leagueFormat: activeLeagueFormat ?? undefined,
              }
            : {}),
        },
        confirmTokenSpend: false,
        onChunk: (text) => {
          streamedAssistantHandled = true;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              const next = [...prev];
              next[next.length - 1] = {
                ...last,
                id: last.id || assistantMessageId,
                role: 'assistant',
                content: text,
                createdAt: last.createdAt ?? assistantCreatedAt,
              };
              return next;
            }
            return [
              ...prev,
              { id: assistantMessageId, role: 'assistant', content: text, createdAt: assistantCreatedAt },
            ];
          });
        },
      });
      if (result.sessionId) {
        setSessionId(result.sessionId);
      }
      const reply = result.response || CHIMMY_GENERIC_ERROR_MESSAGE;
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: reply,
        upgradePath: result.upgradeRequired ? result.upgradePath ?? CHIMMY_DEFAULT_UPGRADE_PATH : null,
        createdAt: assistantCreatedAt,
      };

      if (streamedAssistantHandled) {
        setMessages((prev) => [...prev.slice(0, -1), assistantMessage]);
      } else {
        setMessages((prev) => [
          ...prev,
          assistantMessage,
        ]);
      }
      if (voiceConfig.enabled && voiceConfig.autoPlay) {
        void handlePlayVoice(reply, assistantMessage.id);
      }
      triggerChimmyVoiceListenNudge({
        ttsAvailable: ttsServerReady === true,
        voiceEnabled: voiceConfig.enabled,
        replyText: reply,
        skipForContent: Boolean(assistantMessage.upgradePath) || !result.ok,
      })
      if (!result.ok && result.error) {
        toast.error(result.error);
      }
    } catch {
      toast.error(CHIMMY_GENERIC_ERROR_MESSAGE);
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: 'assistant',
          content: CHIMMY_GENERIC_ERROR_MESSAGE,
          upgradePath: null,
          createdAt: Date.now(),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  sendMessageRef.current = sendMessage;

  useEffect(() => {
    const onShortcut = (e: Event) => {
      const detail = (e as CustomEvent<{ prompt?: string }>).detail;
      const prompt = detail?.prompt?.trim();
      if (!prompt) return;
      setInput(prompt);
      void sendMessageRef.current(prompt);
    };
    window.addEventListener('af-chimmy-shortcut', onShortcut);
    return () => window.removeEventListener('af-chimmy-shortcut', onShortcut);
  }, []);

  const embeddedShell =
    embedded && panelFill
      ? 'h-full min-h-0 flex-1 rounded-none border-0'
      : embedded
        ? 'h-full min-h-0 rounded-xl border border-white/10'
        : ''

  return (
    <div
      className={`mode-readable flex min-h-0 flex-col overflow-hidden touch-scroll bg-slate-950 text-white ${
        embedded ? embeddedShell : 'h-fill-dynamic rounded-3xl border border-slate-800'
      }`}
      data-testid="chimmy-chat-shell"
    >
      {!embedded ? (
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-500 to-purple-500 text-2xl">
              {HEART_EMOJI}
            </div>
            <div>
              <div className="font-semibold">Chimmy</div>
              <div className="text-xs text-emerald-400">Feminine, kind, and straight-to-the-point</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={startNewConversation}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-300 transition hover:bg-slate-700"
              title="Start a new conversation"
            >
              <Square className="h-4 w-4 text-cyan-400" />
              New conversation
            </button>
            <button
              type="button"
              onClick={toggleVoiceReplies}
              disabled={voiceToggleDisabled}
              className="rounded-full p-3 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              title={
                ttsServerReady === false
                  ? 'ElevenLabs API key required'
                  : 'Toggle Chimmy voice replies'
              }
            >
              {voiceConfig.enabled ? <Volume2 className="h-5 w-5 text-cyan-400" /> : <VolumeX className="h-5 w-5 text-slate-400" />}
            </button>
            {isVoicePlaying && (
              <button
                onClick={handleStopVoice}
                className="inline-flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 transition"
                title={`Stop ${voicePlayLabel} voice`}
              >
                <Square className="h-4 w-4" />
                Stop
              </button>
            )}
          </div>
        </div>
      ) : (
        <div
          className={`flex items-center gap-2 border-b border-white/[0.07] bg-slate-900/80 px-2 py-1.5 ${
            parentControlsNew ? 'justify-end' : 'justify-between'
          }`}
        >
          {!parentControlsNew ? (
            <button
              type="button"
              onClick={startNewConversation}
              className="rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] font-semibold text-white/80 transition hover:bg-white/10"
              title="New conversation"
            >
              New
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleVoiceReplies}
            disabled={voiceToggleDisabled}
            className="rounded-full p-1.5 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            title={ttsServerReady === false ? 'ElevenLabs API key required' : 'Toggle voice'}
          >
            {voiceConfig.enabled ? <Volume2 className="h-4 w-4 text-cyan-400" /> : <VolumeX className="h-4 w-4 text-slate-400" />}
          </button>
        </div>
      )}

      <div
        className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
          embedded ? (panelFill ? 'p-2' : 'p-3') : 'p-6'
        }`}
      >
        <div
          className={`min-h-0 flex-1 overflow-y-auto ${embedded ? 'space-y-3' : 'space-y-6'}`}
        >
        {messages.length <= 1 && suggestedChips.length > 0 && (
          <div
            className={
              embedded
                ? 'flex flex-wrap gap-1.5'
                : 'flex flex-wrap gap-2'
            }
          >
            {suggestedChips.slice(0, 6).map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => setInput(chip.prompt)}
                className={
                  embedded
                    ? 'cursor-pointer whitespace-nowrap rounded-full border border-white/[0.08] bg-white/[0.06] px-2.5 py-1 text-[12px] text-slate-200 transition-colors hover:bg-white/[0.10]'
                    : 'shrink-0 rounded-full border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-200 transition hover:border-cyan-500/50 hover:bg-slate-700'
                }
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}
        {messages.map((msg, index) => {
          const prev = index > 0 ? messages[index - 1] : undefined;
          const threaded =
            prev &&
            isChimmyMessageThreaded(
              { role: prev.role, createdAt: prev.createdAt },
              { role: msg.role, createdAt: msg.createdAt }
            );
          const gap = threaded ? 'mt-0.5' : 'mt-2';
          const ts = formatChatMessageTimestamp(msg.createdAt ?? Date.now());

          const widePanel = embedded && panelFill;
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className={`flex justify-end ${gap}`}>
                <div
                  className={`flex min-w-0 flex-col items-end ${widePanel ? 'max-w-full' : 'max-w-[85%]'}`}
                >
                  <div
                    className={`ml-auto w-fit max-w-full rounded-3xl bg-cyan-600 text-white ${embedded ? 'p-3 text-[13px]' : 'p-5'}`}
                  >
                    {renderContentWithLinks(msg.content)}
                    {msg.image && (
                      <img src={msg.image} alt="Uploaded screenshot" className="mt-4 max-w-full rounded-2xl shadow-lg" />
                    )}
                  </div>
                  <span className="mt-1 text-[11px] text-white/40">{ts}</span>
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className={`flex gap-2 ${gap}`}>
              <div className="w-8 shrink-0">{threaded ? null : <ChimmyAssistantAvatar />}</div>
              <div className="min-w-0 flex-1">
                {threaded ? null : (
                  <p className="mb-0.5 text-[13px] font-semibold text-white">Chimmy</p>
                )}
                <div
                  className={`rounded-3xl bg-slate-800 text-slate-200 ${
                    widePanel ? 'w-full max-w-full' : 'max-w-[85%]'
                  } ${embedded ? 'p-3 text-[13px]' : 'p-5'}`}
                >
                  {renderContentWithLinks(msg.content)}
                  <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3">
                    <button
                      type="button"
                      onClick={() => void handlePlayVoice(msg.content, msg.id)}
                      disabled={voiceLoading}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
                        isVoicePlaying && voiceMessageId === msg.id
                          ? 'border-cyan-500/30 bg-cyan-500/15 text-cyan-100'
                          : 'border-white/15 bg-white/5 text-white/70 hover:bg-white/10'
                      } disabled:opacity-50`}
                    >
                      {voiceLoading && voiceMessageId === msg.id ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Loading…
                        </>
                      ) : isVoicePlaying && voiceMessageId === msg.id ? (
                        'Stop'
                      ) : (
                        voicePlayLabel
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={toggleVoiceReplies}
                      disabled={voiceToggleDisabled}
                      className="ml-auto text-[12px] text-white/50 transition hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-40"
                      title={ttsServerReady === false ? 'Voice (unavailable)' : undefined}
                    >
                      {ttsServerReady === false ? 'Voice (unavailable)' : voiceConfig.enabled ? 'Voice on' : 'Voice off'}
                    </button>
                  </div>
                  {msg.upgradePath && (
                    <div className="mt-4">
                      <a
                        href={msg.upgradePath}
                        className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-500/15 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-500/25"
                      >
                        {CHIMMY_PREMIUM_CTA_LABEL}
                      </a>
                    </div>
                  )}
                </div>
                <span className="mt-1 text-[11px] text-white/40">{ts}</span>
              </div>
            </div>
          );
        })}

        {isTyping && (
          <div className="flex items-center gap-2 text-slate-400 pl-4">
            <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
            <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        )}

        <div ref={messagesEndRef} />
        </div>
      </div>

      {footerSlot ? (
        <div className="flex-shrink-0 border-t border-white/[0.07] bg-slate-900/95 px-2 py-2">{footerSlot}</div>
      ) : null}

      <div className="flex-shrink-0 border-t border-white/[0.07] bg-slate-950/80 px-3 py-1.5">
        <div className="flex items-center justify-between text-[11px] text-white/45">
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
            data-testid="chimmy-auto-trade-eval-toggle"
            disabled={!autoTradeEvalReady}
          >
            {autoTradeEvalEnabled ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      <div className={`flex-shrink-0 border-t border-slate-800 bg-slate-900 ${embedded ? 'p-2' : 'p-5'}`}>
        {showPlayLastReplyBar && lastAssistantMessage ? (
          <div
            className={`mb-2 flex items-center justify-between gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/10 ${
              embedded ? 'px-2.5 py-2' : 'px-3 py-2.5'
            }`}
          >
            <span className={`text-white/55 ${embedded ? 'text-[11px]' : 'text-xs'}`}>
              Voice off — listen without turning voice on
            </span>
            <button
              type="button"
              onClick={() => void handlePlayVoice(lastAssistantMessage.content, lastAssistantMessage.id)}
              disabled={voiceLoading}
              data-testid="chimmy-play-last-reply"
              aria-label="Play last Chimmy reply"
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-400/35 bg-cyan-500/15 px-2.5 py-1.5 font-medium text-cyan-100 transition hover:bg-cyan-500/25 disabled:opacity-50 ${
                embedded ? 'text-[11px]' : 'text-xs'
              }`}
            >
              <Volume2 className={embedded ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />
              Play last reply
            </button>
          </div>
        ) : null}
        <div className={`flex ${embedded ? 'gap-1.5' : 'gap-3'}`}>
          <label
            className={`flex cursor-pointer items-center justify-center rounded-2xl bg-slate-800 transition hover:bg-slate-700 ${
              embedded ? 'p-2' : 'p-4'
            }`}
          >
            <ImageIcon className={`text-cyan-400 ${embedded ? 'h-4 w-4' : 'h-6 w-6'}`} />
            <input
              ref={imageFileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
          </label>

          <button
            type="button"
            onClick={toggleListening}
            className={`flex items-center justify-center rounded-2xl transition ${
              embedded ? 'p-2' : 'p-4'
            } ${isListening ? 'bg-pink-600/80 hover:bg-pink-500/80' : 'bg-slate-800 hover:bg-slate-700'}`}
            title="Voice message"
          >
            {isListening ? (
              <MicOff className={`text-white ${embedded ? 'h-4 w-4' : 'h-6 w-6'}`} />
            ) : (
              <Mic className={`text-cyan-400 ${embedded ? 'h-4 w-4' : 'h-6 w-6'}`} />
            )}
          </button>

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
            placeholder="Ask about your roster, league, trades, waivers, or upload a screenshot"
            className={`flex-1 rounded-2xl border border-slate-700 bg-slate-800 text-white outline-none placeholder:text-slate-500 focus:border-cyan-400 ${
              embedded ? 'px-3 py-2 text-[13px]' : 'px-6 py-4'
            }`}
          />

          <button
            onClick={() => void sendMessage()}
            disabled={isTyping}
            className={`flex items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-purple-500 transition hover:scale-105 disabled:opacity-50 ${
              embedded ? 'h-9 w-9' : 'h-14 w-14'
            }`}
          >
            {isTyping ? (
              <Loader2 className={`animate-spin ${embedded ? 'h-4 w-4' : 'h-6 w-6'}`} />
            ) : (
              <Send className={embedded ? 'h-4 w-4' : 'h-6 w-6'} />
            )}
          </button>
        </div>

        {imagePreview && (
          <div className="mt-4 flex items-center gap-3 bg-slate-800 p-3 rounded-2xl">
            <img src={imagePreview} alt="Preview" className="w-20 h-20 object-cover rounded-xl" />
            <button
              onClick={() => {
                setImagePreview(null);
                setImageFile(null);
              }}
              className="text-red-400 text-sm hover:text-red-300"
            >
              Remove image
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
