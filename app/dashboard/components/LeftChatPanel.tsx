'use client'

import { Bot, ChevronDown, ChevronRight, Inbox, MessageCircle, Users, VolumeX, ArrowUp } from 'lucide-react'
import { toast } from 'sonner'
import { RichMessageRenderer, resolveMediaViewerUrl, canOpenInMediaViewer, getMediaViewerAriaLabel } from '@/lib/rich-message'
import { QUICK_REACTIONS, getAddReactionUrl, getRemoveReactionUrl, getReactionsFromMetadata } from '@/lib/social-chat/ReactionService'
import { EmojiPicker } from './chat/EmojiPicker'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useInterval } from '@/hooks/useInterval' // Assume you have/use a polling hook
import { Send } from 'lucide-react'
import type { PlatformChatThread, PlatformChatMessage } from '@/types/platform-shared'
import ChimmyChat from '@/app/components/ChimmyChat'
import { DiscordIcon } from '@/app/components/icons/DiscordIcon'
import type { LeftChatInitialTab, LeftChatPanelLayoutProps, UserLeague } from '../types'
import { LeagueAvatar } from './LeagueAvatar'
import { LeagueChatInPanel } from './LeagueChatInPanel'
import { CHIMMY_VOICES } from '@/lib/tts/voices'
import { useChimmyTtsVoiceSync } from '@/hooks/useChimmyTtsVoiceSync'

function ChimmyVoicePicker({
  selectedVoiceId,
  onVoiceChange,
}: {
  selectedVoiceId: string
  onVoiceChange: (voiceId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const selectedVoice = CHIMMY_VOICES.find((v) => v.id === selectedVoiceId) ?? CHIMMY_VOICES[0]!

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  return (
    <div ref={wrapRef} className="relative z-[100]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.10] px-2.5 py-1.5 text-xs text-white/60 transition-colors hover:border-white/[0.20] hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
        aria-haspopup="listbox"
        aria-expanded={open}
        tabIndex={0}
        style={{ marginBottom: 4 }}
      >
        {selectedVoice.name}
        <span className={`ml-1 text-[9px] text-white/30 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1 max-h-64 w-[220px] overflow-y-auto overflow-x-hidden rounded-xl border border-white/[0.10] bg-[#0f1521] shadow-2xl z-[10000]"
          role="listbox"
          aria-label="Chimmy voice"
        >
          <p className="sticky top-0 z-[1] border-b border-white/[0.06] bg-[#0f1521] px-3 py-2 text-[10px] uppercase tracking-wider text-white/30">
            Chimmy Voice
          </p>
          {CHIMMY_VOICES.map((voice) => (
            <button
              key={voice.id}
              type="button"
              role="option"
              aria-selected={voice.id === selectedVoiceId}
              onClick={(e) => {
                e.stopPropagation()
                onVoiceChange(voice.id)
                setOpen(false)
              }}
              className={`flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06] ${
                voice.id === selectedVoiceId ? 'bg-cyan-500/10' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold text-white">{voice.name}</span>
                  <span className="text-[9px] capitalize text-white/30">{voice.gender}</span>
                </div>
                <p className="mt-0.5 text-[10px] text-white/40">{voice.description}</p>
              </div>
              {voice.id === selectedVoiceId ? (
                <span className="mt-0.5 text-[12px] text-cyan-400" aria-hidden>
                  ✓
                </span>
              ) : null}
            </button>
          ))}
          <div className="border-t border-white/[0.06] px-3 py-2">
            <p className="text-[9px] text-white/20">Powered by ElevenLabs</p>
          </div>
        </div>
      )}
    </div>
  )
}

function ChimmyLeagueContextBar({
  leagues,
  activeLeagueId,
  onSelect,
}: {
  leagues: UserLeague[]
  activeLeagueId: string | null
  onSelect: (id: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const active = leagues.find((l) => l.id === activeLeagueId) ?? null
  if (leagues.length === 0) return null

  return (
    <div ref={wrapRef} className="relative">
      <p className="mb-1 text-[8px] text-white/30">Asking about:</p>
      <button
        type="button"
        onClick={() => {
          if (leagues.length > 1) setOpen((o) => !o)
        }}
        className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.06] px-2.5 py-1 text-[14px] font-bold text-white/90"
      >
        {active ? <LeagueAvatar league={active} size={22} /> : null}
        <span className="min-w-0 flex-1 truncate text-left">{active?.name ?? 'All leagues'}</span>
        {!active ? (
          <span className="rounded-full border border-cyan-400/30 bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-200">
            Global
          </span>
        ) : null}
        {leagues.length > 1 ? (
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-white/45 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        ) : null}
      </button>
      {open && leagues.length > 1 ? (
        <div
          className="absolute bottom-full left-0 z-50 mb-1 max-h-64 min-w-[200px] overflow-y-auto rounded-xl border border-white/[0.1] bg-[#0c0c1e] py-1 shadow-lg"
          role="listbox"
        >
          <button
            type="button"
            role="option"
            aria-selected={activeLeagueId == null}
            onClick={() => {
              onSelect(null)
              setOpen(false)
            }}
            className={`flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-[14px] font-bold transition-colors hover:bg-white/[0.06] ${
              activeLeagueId == null
                ? 'bg-cyan-500/15 text-cyan-200'
                : 'text-white/80'
            }`}
          >
            <span className="min-w-0 flex-1 truncate">All leagues</span>
          </button>
          {leagues.map((l) => (
            <button
              key={l.id}
              type="button"
              role="option"
              aria-selected={l.id === activeLeagueId}
              onClick={() => {
                onSelect(l.id)
                setOpen(false)
              }}
              className={`flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-[14px] font-bold transition-colors hover:bg-white/[0.06] ${
                l.id === activeLeagueId
                  ? 'bg-cyan-500/15 text-cyan-200'
                  : 'text-white/80'
              }`}
            >
              <LeagueAvatar league={l} size={22} />
              <span className="min-w-0 flex-1 truncate">{l.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Chimmy is the default tab only when no league is selected; with a league, league chat is primary. */
function initialLeftTab(
  selectedLeague: UserLeague | null,
  initialOpenChat: LeftChatInitialTab | null | undefined
): LeftChatInitialTab {
  if (initialOpenChat) return initialOpenChat
  return selectedLeague ? 'league' : 'chimmy'
}

/** Position-style avatar fallback colors (aligned with `PlayerImage` positionBgClass). */
function dmAvatarBgClass(name: string, index: number): string {
  const p = name.trim()
  let h = 0
  for (let i = 0; i < p.length; i++) h = (h + p.charCodeAt(i) * (i + 1)) % 7
  h = (h + index) % 7
  const classes = [
    'bg-red-500/80',
    'bg-green-500/80',
    'bg-blue-500/80',
    'bg-orange-500/80',
    'bg-purple-500/80',
    'bg-indigo-500/80',
    'bg-slate-500/80',
  ]
  return classes[h] ?? 'bg-slate-500/80'
}

function initialsFromDisplayName(name: string): string {
  const n = name.trim()
  if (!n) return '?'
  const parts = n.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
  if (n.length >= 2) return n.slice(0, 2).toUpperCase()
  return (n[0]! + n[0]!).toUpperCase()
}

const DM_STUB_ROWS = [
  {
    name: 'TheCiege24',
    preview: 'You seeing these waiver moves?',
    time: '2m ago',
    unread: 2 as number | null,
  },
  {
    name: 'PoloGlizzy',
    preview: 'Bro that trade was robbery',
    time: '1h ago',
    unread: null as number | null,
  },
  {
    name: 'tomwh',
    preview: 'Running it back next year 🔥',
    time: 'Yesterday',
    unread: null as number | null,
  },
] as const

export function LeftChatPanel({
  selectedLeague,
  activeLeagueId: activeLeagueIdProp = null,
  userId,
  userDisplayName,
  userImage,
  rootId = 'dashboard-left-chat',
  leagues = [],
  discordConnected = false,
  zombieChimmyPrefill = null,
  initialOpenChat = null,
  commissionerLeagues = [],
}: LeftChatPanelLayoutProps) {
  const [activeTab, setActiveTab] = useState<LeftChatInitialTab>(() =>
    initialLeftTab(selectedLeague, initialOpenChat)
  )
  // DM state
  const [dmThreads, setDmThreads] = useState<PlatformChatThread[]>([])
  const [dmUnread, setDmUnread] = useState(0)
  const [dmMute, setDmMute] = useState<Record<string, boolean>>({})
  const [dmSilent, setDmSilent] = useState(false)
  const [dmNotifThrottle, setDmNotifThrottle] = useState<Record<string, number>>({})
  const [activeDm, setActiveDm] = useState<string | null>(null)
    // Notification permission
    useEffect(() => {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }, []);

    // Notification sound
    const playNotifSound = useCallback(() => {
      const audio = new Audio('/notif.mp3');
      audio.volume = 0.5;
      audio.play().catch(() => {});
    }, []);

    // Calculate unread DMs and show notifications (browser + in-app toast)
    useEffect(() => {
      const unread = dmThreads.reduce((sum, t) => sum + (t.unreadCount || 0), 0);
      setDmUnread(unread);
      if (typeof window === 'undefined') return;
      const now = Date.now();
      const lastNotified = (window as any).__lastDmNotified || {};
      dmThreads.forEach(t => {
        if (
          t.unreadCount > 0 &&
          t.lastMessageAt &&
          !dmMute[t.id] &&
          !dmSilent &&
          (!lastNotified[t.id] || lastNotified[t.id] !== t.lastMessageAt) &&
          (!dmNotifThrottle[t.id] || now - dmNotifThrottle[t.id] > 60000)
        ) {
          // Notification content
          const body =
            typeof t.context?.lastMessagePreview === 'string' && t.context.lastMessagePreview.trim().length > 0
              ? t.context.lastMessagePreview
              : 'You have a new DM!';
          const icon = '/favicon.ico';
          // Browser notification
          if ('Notification' in window && Notification.permission === 'granted') {
            const notif = new Notification(`New message from ${t.title}`, {
              body,
              icon,
              silent: false,
            });
            notif.onclick = () => window.focus();
          }
          // In-app toast
          toast(`New message from ${t.title}`, {
            description: body,
            action: {
              label: 'Open',
              onClick: () => {
                setActiveTab('dms');
                setActiveDm(t.id);
              },
            },
          });
          playNotifSound();
          lastNotified[t.id] = t.lastMessageAt;
          setDmNotifThrottle((prev) => ({ ...prev, [t.id]: now }));
        }
      });
      (window as any).__lastDmNotified = lastNotified;
    }, [dmThreads, dmMute, dmSilent, dmNotifThrottle, setActiveTab, setActiveDm, playNotifSound]);
  const [dmSearch, setDmSearch] = useState('')
  const [dmMessages, setDmMessages] = useState<PlatformChatMessage[]>([])
  const [dmMsgReactions, setDmMsgReactions] = useState<Record<string, any[]>>({})
  const [emojiPickerFor, setEmojiPickerFor] = useState<string | null>(null)
  const [mediaViewerUrl, setMediaViewerUrl] = useState<string | null>(null)
  const [dmLoading, setDmLoading] = useState(false)
  const [dmSending, setDmSending] = useState(false)
  const [dmInput, setDmInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [otherTyping, setOtherTyping] = useState(false)
  const [lastReadLabel, setLastReadLabel] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const dmListRef = useRef<HTMLDivElement>(null)
  const typingTimeout = useRef<NodeJS.Timeout | null>(null)
  const typingPollInterval = activeDm ? 2000 : null

      const stopTyping = useCallback(() => {
        if (!activeDm) return
        void fetch(`/api/shared/chat/threads/${encodeURIComponent(activeDm)}/typing`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ isTyping: false }),
        }).catch(() => {})
      }, [activeDm])

      // Poll for typing and read status (simulate, replace with websocket for prod)
      useInterval(() => {
        if (!activeDm) return;
        fetch(`/api/shared/chat/threads/${encodeURIComponent(activeDm)}/typing`, { cache: 'no-store' }).then(async r => {
          if (r.ok) {
            const json = await r.json();
            const list = Array.isArray(json?.typing) ? json.typing : [];
            setOtherTyping(list.length > 0);
          }
        });
        fetch(`/api/shared/chat/threads/${encodeURIComponent(activeDm)}/read-receipts`, { cache: 'no-store' }).then(async r => {
          if (r.ok) {
            const json = await r.json();
            const receipts = Array.isArray(json?.receipts) ? json.receipts : [];
            const latestOther = receipts
              .filter((row: any) => row?.userId && row.userId !== userId)
              .sort(
                (a: any, b: any) =>
                  new Date(b?.lastReadAt ?? 0).getTime() - new Date(a?.lastReadAt ?? 0).getTime()
              )[0];
            if (latestOther) {
              const name = latestOther.displayName || latestOther.username || 'someone';
              setLastReadLabel(`Seen by ${name}`);
            } else {
              setLastReadLabel('');
            }
          }
        });
      }, typingPollInterval); // Poll every 2s when DM open
    // Fetch DM threads on mount or tab switch
    useEffect(() => {
      if (activeTab !== 'dms' && activeTab !== 'af_huddle') return;
      const fetchThreads = async () => {
        try {
          const res = await fetch('/api/shared/chat/threads', { cache: 'no-store' });
          const json = await res.json();
          const threads = Array.isArray(json?.threads) ? json.threads : [];
          setDmThreads(threads);
        } catch {
          setDmThreads([]);
        }
      };
      fetchThreads();
    }, [activeTab]);

    // Fetch DM messages when a DM is selected
    useEffect(() => {
      if (!activeDm) return;
      setDmLoading(true);
      const fetchMessages = async () => {
        try {
          const res = await fetch(`/api/shared/chat/threads/${encodeURIComponent(activeDm)}/messages?limit=50`, { cache: 'no-store' });
          const json = await res.json();
          setDmMessages(Array.isArray(json?.messages) ? json.messages : []);
          // Extract reactions from metadata
          const reactions: Record<string, any[]> = {};
          (json?.messages || []).forEach((msg: any) => {
            reactions[msg.id] = getReactionsFromMetadata(msg.metadata);
          });
          setDmMsgReactions(reactions);
          void fetch(`/api/shared/chat/threads/${encodeURIComponent(activeDm)}/read-receipts`, { method: 'POST' });
        } catch {
          setDmMessages([]);
          setDmMsgReactions({});
        } finally {
          setDmLoading(false);
        }
      };
      fetchMessages();
    }, [activeDm]);

    useEffect(() => {
      return () => {
        if (typingTimeout.current) {
          clearTimeout(typingTimeout.current)
        }
      }
    }, [])

    // Send DM message
    const handleSendDm = useCallback(async () => {
      if (!activeDm || !dmInput.trim() || dmSending) return;
      setDmSending(true);
      setSendError(null);
      const optimisticMsg = {
        id: `temp-${Date.now()}`,
        threadId: activeDm,
        senderUserId: userId,
        senderName: userDisplayName ?? 'You',
        senderUsername: null,
        senderAvatarUrl: userImage ?? null,
        senderAvatarPreset: null,
        messageType: 'text',
        body: dmInput,
        createdAt: new Date().toISOString(),
        metadata: { sending: true },
      };
      setDmMessages((prev) => [...prev, optimisticMsg]);
      setDmInput('');
      setIsTyping(false);
      stopTyping();
      try {
        const res = await fetch(`/api/shared/chat/threads/${encodeURIComponent(activeDm)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: optimisticMsg.body, messageType: 'text' }),
        });
        const json = await res.json();
        if (res.ok && json?.message) {
          setDmMessages((prev) => prev.map((m) => (m.id === optimisticMsg.id ? json.message : m)));
          void fetch(`/api/shared/chat/threads/${encodeURIComponent(activeDm)}/read-receipts`, { method: 'POST' });
        } else {
          setSendError(json?.error || 'Failed to send');
          setDmMessages((prev) => prev.map((m) => m.id === optimisticMsg.id ? { ...m, metadata: { ...m.metadata, failed: true } } : m));
        }
      } catch {
        setSendError('Failed to send');
        setDmMessages((prev) => prev.map((m) => m.id === optimisticMsg.id ? { ...m, metadata: { ...m.metadata, failed: true } } : m));
      } finally {
        setDmSending(false);
      }
    }, [activeDm, dmInput, dmSending, userId, userDisplayName, userImage, stopTyping]);
  const [activeChimmyLeagueId, setActiveChimmyLeagueId] = useState<string | null>(null)
  /** Tracks last right-panel/route league we synced so `leagues` refetches do not override a manual Chimmy pick */
  const lastSyncedRightPanelLeagueRef = useRef<string | null>(null)

  const prevLeagueIdForTabRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const id = selectedLeague?.id ?? null
    const prev = prevLeagueIdForTabRef.current

    if (id === null) {
      prevLeagueIdForTabRef.current = null
      // Without a league context, only fall back to Chimmy when no tab was requested (?openChat= / initial prop).
      // Otherwise we overwrite e.g. ?openChat=league during a brief null selectedLeague frame on the league route.
      if (initialOpenChat == null) {
        setActiveTab('chimmy')
      }
      return
    }

    if (prev === undefined) {
      prevLeagueIdForTabRef.current = id
      return
    }

    if (prev === null) {
      prevLeagueIdForTabRef.current = id
      setActiveTab('league')
      return
    }

    if (prev !== id) {
      prevLeagueIdForTabRef.current = id
      setActiveTab('league')
    }
  }, [selectedLeague?.id, initialOpenChat])

  useEffect(() => {
    const focusChimmy = () => setActiveTab('chimmy')
    window.addEventListener('af-dashboard-focus-left-chimmy', focusChimmy)
    return () => window.removeEventListener('af-dashboard-focus-left-chimmy', focusChimmy)
  }, [])

  useEffect(() => {
    if (leagues.length === 0) {
      setActiveChimmyLeagueId(null)
      return
    }
    if (activeLeagueIdProp) return
    setActiveChimmyLeagueId((prev) => {
      if (prev && leagues.some((l) => l.id === prev)) return prev
      return null
    })
  }, [leagues, activeLeagueIdProp])

  useEffect(() => {
    if (activeLeagueIdProp == null || activeLeagueIdProp === '') {
      lastSyncedRightPanelLeagueRef.current = null
      return
    }
    if (!leagues.some((l) => l.id === activeLeagueIdProp)) return
    if (lastSyncedRightPanelLeagueRef.current === activeLeagueIdProp) return
    lastSyncedRightPanelLeagueRef.current = activeLeagueIdProp
    setActiveChimmyLeagueId(activeLeagueIdProp)
  }, [activeLeagueIdProp, leagues])

  const activeChimmyLeague =
    leagues.find((l) => l.id === activeChimmyLeagueId) ?? null

  const { voiceId: selectedVoiceId, setVoiceId: handleVoiceChange } = useChimmyTtsVoiceSync()

  const isBigBrotherHouse = selectedLeague?.leagueVariant === 'big_brother'
  const leagueThreadTabLabel = isBigBrotherHouse ? '🏠 House' : '🏈 League'
  const leagueThreadHeader = isBigBrotherHouse ? 'House Chat' : 'League Chat'
  const leagueTabAria = isBigBrotherHouse ? 'House chat tab' : 'League chat tab'
  const chatTabClass = (active: boolean) =>
    `inline-flex min-h-10 min-w-0 items-center justify-center gap-1.5 rounded-2xl border px-2 text-[11px] font-black uppercase tracking-[0.04em] transition touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 ${
      active
        ? 'border-cyan-200/45 bg-gradient-to-r from-cyan-300 to-cyan-100 text-slate-950 shadow-[0_0_22px_-10px_rgba(34,211,238,0.95)]'
        : 'border-white/10 bg-white/[0.045] text-white/58 hover:border-cyan-300/25 hover:bg-cyan-300/[0.08] hover:text-white'
    }`

  return (
    <div
      id={rootId ?? undefined}
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.08),transparent_36%),linear-gradient(180deg,#07101f_0%,#07091b_100%)]"
    >
      <div className="shrink-0 border-b border-cyan-300/10 bg-black/20 p-2">
        <div className="grid grid-cols-2 gap-1 min-[380px]:grid-cols-4">
        <button
          type="button"
          data-testid="left-chat-tab-league"
          aria-pressed={activeTab === 'league'}
          onClick={() => setActiveTab('league')}
          className={chatTabClass(activeTab === 'league')}
          aria-label={leagueTabAria}
        >
          {leagueThreadTabLabel}
        </button>
        <button
          type="button"
          data-testid="left-chat-tab-chimmy"
          aria-pressed={activeTab === 'chimmy'}
          onClick={() => setActiveTab('chimmy')}
          className={chatTabClass(activeTab === 'chimmy')}
          aria-label="Chimmy tab"
        >
          <Bot className="h-3.5 w-3.5 shrink-0" strokeWidth={2.4} aria-hidden />
          🤖 Chimmy
        </button>
        <button
          type="button"
          data-testid="left-chat-tab-af-huddle"
          aria-pressed={activeTab === 'af_huddle'}
          onClick={() => setActiveTab('af_huddle')}
          className={chatTabClass(activeTab === 'af_huddle')}
          aria-label="AF Huddle tab"
        >
          <Users className="h-3.5 w-3.5 shrink-0" strokeWidth={2.4} aria-hidden />
          AF Huddle
        </button>
        <button
          type="button"
          data-testid="left-chat-tab-dms"
          aria-pressed={activeTab === 'dms'}
          onClick={() => setActiveTab('dms')}
          className={`${chatTabClass(activeTab === 'dms')} ${dmSilent ? 'opacity-70' : ''}`}
          aria-label="Direct messages tab"
        >
          <span className="relative flex items-center">
            <MessageCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={2.4} aria-hidden />
            {dmUnread > 0 && (
              <span className="absolute -top-2 -right-2 min-w-[18px] animate-bounce rounded-full bg-gradient-to-r from-pink-500 via-red-500 to-yellow-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow ring-2 ring-cyan-400">{dmUnread}</span>
            )}
          </span>
          DMs
        </button>
        </div>
        {/* Silent mode and mute controls */}
        {activeTab === 'dms' && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
            <label className="flex min-h-8 items-center gap-2 rounded-full border border-cyan-300/15 bg-black/20 px-2.5 text-[11px] font-bold text-white/70 cursor-pointer">
              <input type="checkbox" checked={dmSilent} onChange={e => setDmSilent(e.target.checked)} /> Silent Mode
            </label>
            <span className="text-cyan-100/40 text-[10px] font-black uppercase tracking-[0.14em]">Mute</span>
            {dmThreads.map(t => (
              <button
                key={t.id}
                className={`min-h-8 max-w-full truncate rounded-full border px-2.5 py-1 text-[11px] font-bold ${dmMute[t.id] ? 'border-rose-300/30 bg-rose-500/20 text-rose-200' : 'border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-100'} transition`}
                onClick={() => setDmMute(prev => ({ ...prev, [t.id]: !prev[t.id] }))}
              >
                {t.title}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === 'league' && selectedLeague ? (
          <div className="flex h-full min-h-0 min-w-0 flex-col">
            <div className="flex shrink-0 items-center justify-between border-b border-white/[0.07] px-3 py-2">
              <div>
                <p className="text-[14px] font-semibold text-white/90">{leagueThreadHeader}</p>
                {isBigBrotherHouse ? (
                  <p className="text-[11px] text-white/40">Default — full house, alliances use DMs</p>
                ) : null}
              </div>
              <button
                type="button"
                title="Mute (coming soon)"
                className="rounded-lg p-1.5 text-white/35 transition hover:bg-white/[0.06] hover:text-white/55"
                aria-label="Mute league chat"
              >
                <VolumeX className="h-4 w-4" />
              </button>
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <LeagueChatInPanel
                selectedLeague={selectedLeague}
                userId={userId}
                userDisplayName={userDisplayName}
                userImage={userImage}
                onAskChimmy={() => setActiveTab('chimmy')}
                zombieChimmyPrefill={zombieChimmyPrefill}
                commissionerLeagues={commissionerLeagues}
              />
            </div>
          </div>
        ) : null}

        {activeTab === 'league' && !selectedLeague ? (
          <div className="flex min-h-[140px] flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
            <ChevronRight className="h-5 w-5 text-white/25" aria-hidden />
            <p className="text-[13px] text-white/40">Select a league to view chat</p>
          </div>
        ) : null}

        {activeTab === 'chimmy' ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-2 pb-2 pt-1">
            <div className="mb-2 flex shrink-0 items-center gap-2 rounded-xl border border-violet-500/[0.18] bg-gradient-to-r from-violet-500/[0.07] to-transparent px-3 py-2">
              <span className="text-base" aria-hidden>🤖</span>
              <div className="min-w-0">
                <p className="text-[12px] font-bold text-violet-300/90">Chimmy</p>
                <p className="text-[10px] leading-tight text-white/40">Calm, evidence-based fantasy assistant</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-2 pb-1">
              <ChimmyVoicePicker selectedVoiceId={selectedVoiceId} onVoiceChange={handleVoiceChange} />
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('af-chimmy-new-conversation'))}
                className="rounded-lg border border-white/[0.08] bg-transparent px-2 py-1 text-[11px] font-semibold text-white/50 transition hover:bg-white/[0.06] hover:text-white/90"
                title="New conversation"
              >
                New
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden" data-chimmy-league-id={activeChimmyLeagueId ?? undefined}>
              <ChimmyChat
                embedded
                parentControlsNew
                ttsVoiceId={selectedVoiceId}
                chipContextLeagueName={activeChimmyLeague?.name ?? null}
                activeLeagueId={activeChimmyLeagueId}
                activeLeagueSport={activeChimmyLeague?.sport ?? null}
                activeLeagueScoring={activeChimmyLeague?.scoring ?? null}
                activeLeagueFormat={activeChimmyLeague?.format ?? null}
                footerSlot={
                  leagues.length > 0 ? (
                    <ChimmyLeagueContextBar
                      leagues={leagues}
                      activeLeagueId={activeChimmyLeagueId}
                      onSelect={setActiveChimmyLeagueId}
                    />
                  ) : null
                }
                panelFill
              />
            </div>
          </div>
        ) : null}

        {activeTab === 'af_huddle' ? (
          <div className="flex min-h-0 flex-1 flex-col px-3 py-4 [scrollbar-gutter:stable]">
            {/* Search bar */}
            <div className="mb-2 flex items-center gap-2">
              <input
                type="text"
                value={dmSearch}
                onChange={e => setDmSearch(e.target.value)}
                placeholder="Search group chats..."
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[13px] text-white placeholder:text-white/30 focus:border-cyan-400 focus:outline-none"
              />
            </div>
            {/* Split view: group chat list (top), conversation (bottom) */}
            <div className={`flex flex-col min-h-0 flex-1 ${activeDm ? 'h-1/2' : 'h-full'}`}
                 style={{height: activeDm ? '50%' : '100%'}}>
              <div className="relative min-h-0 flex-1 overflow-y-auto" ref={dmListRef}>
                <div className="space-y-0">
                  {dmThreads
                    .filter((thread) => thread.threadType === 'group' && thread.title.toLowerCase().includes(dmSearch.toLowerCase()))
                    .map((thread, index) => {
                      const isActive = activeDm === thread.id;
                      return (
                        <div
                          key={thread.id}
                          className={`flex cursor-pointer items-center gap-2.5 border-b border-white/[0.05] py-3 last:border-b-0 transition-colors ${isActive ? 'bg-white/[0.06]' : ''}`}
                          onClick={() => setActiveDm(thread.id)}
                          tabIndex={0}
                          role="button"
                          aria-pressed={isActive}
                        >
                          <div className="relative shrink-0">
                            <div
                              className={`flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold text-white bg-indigo-800`}
                              aria-hidden
                            >
                              {thread.title.slice(0, 2).toUpperCase()}
                            </div>
                            {thread.unreadCount > 0 ? (
                              <span
                                className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white"
                                aria-label={`${thread.unreadCount} unread`}
                              >
                                {thread.unreadCount}
                              </span>
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1 text-left">
                            <p className={`truncate text-[13px] font-semibold ${isActive ? 'text-cyan-300' : 'text-white/90'}`}>{thread.title}</p>
                            <p className="truncate text-[11px] text-white/40">
                              {typeof thread.context?.lastMessagePreview === 'string' ? thread.context.lastMessagePreview : ''}
                            </p>
                          </div>
                          <span className="shrink-0 text-[11px] text-white/30">{thread.lastMessageAt ? new Date(thread.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                        </div>
                      );
                    })}
                </div>
                {/* Scroll to top arrow */}
                <button
                  type="button"
                  className="absolute right-2 top-2 z-10 rounded-full bg-white/10 p-1 text-white/50 hover:bg-cyan-500/20 hover:text-cyan-300"
                  style={{display: 'block'}}
                  onClick={() => { dmListRef.current?.scrollTo({top: 0, behavior: 'smooth'}); }}
                  aria-label="Scroll to top"
                >
                  <ArrowUp size={16} />
                </button>
              </div>
            </div>
            {/* Group chat conversation panel (bottom 50%) */}
            {activeDm && (
              <div className="flex flex-col min-h-0 flex-1 border-t border-white/10 bg-[#10122a]" style={{height: '50%'}}>
                {/* Conversation header */}
                <div className="flex items-center justify-between px-2 py-2 border-b border-white/10">
                  <span className="text-[14px] font-semibold text-indigo-300">{dmThreads.find(t => t.id === activeDm)?.title ?? activeDm}</span>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-[12px] text-white/40 hover:text-cyan-400"
                    onClick={() => setActiveDm(null)}
                  >
                    Close
                  </button>
                </div>
                {/* Conversation messages (reuse advanced DM logic) */}
                <div className="flex-1 overflow-y-auto px-2 py-3">
                  {dmLoading ? (
                    <div className="flex justify-center py-4"><span className="text-white/40">Loading…</span></div>
                  ) : dmMessages.length === 0 ? (
                    <div className="mb-2 text-[12px] text-white/40">No messages yet. Start the conversation!</div>
                  ) : (
                    dmMessages.map((msg, idx) => {
                      const isOutgoing = msg.senderUserId === userId;
                      const reactions = dmMsgReactions[msg.id] || [];
                      const handleReact = async (emoji: string) => {
                        const hasReacted = reactions.some((r: any) => Array.isArray(r.userIds) && r.userIds.includes(userId) && r.emoji === emoji);
                        const url = hasReacted ? getRemoveReactionUrl(activeDm, msg.id) : getAddReactionUrl(activeDm, msg.id);
                        await fetch(url, {
                          method: hasReacted ? 'DELETE' : 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ emoji }),
                        });
                        // Refresh messages
                        const res = await fetch(`/api/shared/chat/threads/${encodeURIComponent(activeDm)}/messages?limit=50`, { cache: 'no-store' });
                        const json = await res.json();
                        setDmMessages(Array.isArray(json?.messages) ? json.messages : []);
                        const nextReactions: Record<string, any[]> = {};
                        (json?.messages || []).forEach((msg: any) => {
                          nextReactions[msg.id] = getReactionsFromMetadata(msg.metadata);
                        });
                        setDmMsgReactions(nextReactions);
                      };
                      const getReactionTooltip = (r: any) => {
                        if (!Array.isArray(r.userIds) || !r.userIds.length) return '';
                        if (r.userIds.length === 1 && r.userIds[0] === userId) return 'You reacted';
                        if (r.userIds.includes(userId)) return `You and ${r.userIds.length - 1} others`;
                        return `${r.userIds.length} users`;
                      };
                      const handleMediaClick = (url: string | null | undefined) => {
                        const safeUrl = resolveMediaViewerUrl(url);
                        if (safeUrl) setMediaViewerUrl(safeUrl);
                      };
                      return (
                        <div key={msg.id} className={`mb-2 flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}>
                          <div className={`rounded-2xl px-3 py-2 text-[13px] max-w-[70%] ${isOutgoing ? 'rounded-tr-sm bg-indigo-500/15 text-white' : 'rounded-tl-sm bg-white/10 text-white/90'}`}>
                            <RichMessageRenderer message={msg} onImageClick={handleMediaClick} />
                            <div className="flex gap-1 mt-1 items-center">
                              {reactions.map((r: any) => (
                                <button
                                  key={r.emoji}
                                  type="button"
                                  onClick={() => handleReact(r.emoji)}
                                  className={`rounded-full px-1.5 py-0.5 text-xs border ${r.userIds?.includes(userId) ? 'bg-indigo-500/20 border-indigo-400 text-indigo-200' : 'border-white/10 text-white/60'}`}
                                  aria-label={`Reacted ${r.emoji}`}
                                  title={getReactionTooltip(r)}
                                >
                                  {r.emoji} {r.count}
                                </button>
                              ))}
                              <div className="flex gap-0.5 ml-1">
                                {QUICK_REACTIONS.map((emoji) => (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => handleReact(emoji)}
                                    className="opacity-70 hover:opacity-100 text-sm leading-none"
                                    aria-label={`React ${emoji}`}
                                  >
                                    {emoji}
                                  </button>
                                ))}
                                <button
                                  type="button"
                                  className="rounded-full px-1 py-0.5 text-xs border border-white/10 text-white/60 hover:bg-indigo-500/10 ml-1"
                                  aria-label="Add custom emoji"
                                  onClick={() => setEmojiPickerFor(msg.id)}
                                >
                                  <span role="img" aria-label="emoji">➕</span>
                                </button>
                              </div>
                            </div>
                            {emojiPickerFor === msg.id && (
                              <div className="absolute z-50 mt-2">
                                <EmojiPicker
                                  onSelect={emoji => {
                                    setEmojiPickerFor(null);
                                    handleReact(emoji);
                                  }}
                                  onClose={() => setEmojiPickerFor(null)}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                {/* Chat input bar (reuse DM logic) */}
                <div className="shrink-0 border-t border-white/[0.07] bg-[#0a0a1f] px-2.5 py-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={dmInput}
                    onChange={e => {
                      setDmInput(e.target.value);
                      setIsTyping(true);
                      if (typingTimeout.current) clearTimeout(typingTimeout.current);
                      fetch(`/api/shared/chat/threads/${encodeURIComponent(activeDm)}/typing`, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ isTyping: true }),
                      });
                      typingTimeout.current = setTimeout(() => {
                        setIsTyping(false)
                        stopTyping()
                      }, 2000);
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') handleSendDm(); }}
                    placeholder={`Message ${dmThreads.find(t => t.id === activeDm)?.title ?? ''}...`}
                    className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white placeholder:text-white/30 focus:border-indigo-400 focus:outline-none"
                    disabled={dmSending}
                  />
                  <button
                    type="button"
                    onClick={handleSendDm}
                    disabled={dmSending || !dmInput.trim()}
                    className="rounded-lg p-2 text-white/40 transition-colors hover:bg-indigo-500/10 hover:text-indigo-400 disabled:opacity-40"
                    aria-label="Send group message"
                  >
                    <Send size={18} strokeWidth={2} />
                  </button>
                </div>
                <div className="px-3 pb-1 pt-0.5 text-[12px] min-h-[18px]">
                  {otherTyping && <span className="text-indigo-300">Someone is typing…</span>}
                  {sendError && <span className="text-rose-400 ml-2">{sendError}</span>}
                  {lastReadLabel ? <span className="text-white/30 ml-2">{lastReadLabel}</span> : null}
                </div>
              </div>
            )}
            {/* End group chat split view */}
            {!activeDm && (
              <div className="mt-6 flex flex-col items-center rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-8 text-center">
                <Users className="mb-2 h-8 w-8 text-white/25" strokeWidth={1.5} aria-hidden />
                <p className="text-[13px] font-semibold text-white/45">No group chats yet</p>
                <p className="mt-1 max-w-[220px] text-[12px] text-white/30">Start a group chat with league members</p>
              </div>
            )}
          </div>
        ) : null}

        {activeTab === 'dms' ? (
          <div className="flex min-h-0 flex-1 flex-col px-3 py-4 [scrollbar-gutter:stable]">
            {/* Search bar */}
            <div className="mb-2 flex items-center gap-2">
              <input
                type="text"
                value={dmSearch}
                onChange={e => setDmSearch(e.target.value)}
                placeholder="Search DMs..."
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[13px] text-white placeholder:text-white/30 focus:border-cyan-400 focus:outline-none"
              />
            </div>
            {/* Split view: DM list (top), conversation (bottom) */}
            <div className={`flex flex-col min-h-0 flex-1 ${activeDm ? 'h-1/2' : 'h-full'}`}
                 style={{height: activeDm ? '50%' : '100%'}}>
              <div className="relative min-h-0 flex-1 overflow-y-auto" ref={dmListRef}>
                <div className="space-y-0">
                  {dmThreads
                    .filter((thread) => thread.threadType === 'dm' && thread.title.toLowerCase().includes(dmSearch.toLowerCase()))
                    .map((thread, index) => {
                      const isActive = activeDm === thread.id;
                      return (
                        <div
                          key={thread.id}
                          className={`flex cursor-pointer items-center gap-2.5 border-b border-white/[0.05] py-3 last:border-b-0 transition-colors ${isActive ? 'bg-white/[0.06]' : ''}`}
                          onClick={() => setActiveDm(thread.id)}
                          tabIndex={0}
                          role="button"
                          aria-pressed={isActive}
                        >
                          <div className="relative shrink-0">
                            <div
                              className={`flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold text-white bg-cyan-800`}
                              aria-hidden
                            >
                              {thread.title.slice(0, 2).toUpperCase()}
                            </div>
                            {thread.unreadCount > 0 ? (
                              <span
                                className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white"
                                aria-label={`${thread.unreadCount} unread`}
                              >
                                {thread.unreadCount}
                              </span>
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1 text-left">
                            <p className={`truncate text-[13px] font-semibold ${isActive ? 'text-cyan-300' : 'text-white/90'}`}>{thread.title}</p>
                            <p className="truncate text-[11px] text-white/40">
                              {typeof thread.context?.lastMessagePreview === 'string' ? thread.context.lastMessagePreview : ''}
                            </p>
                          </div>
                          <span className="shrink-0 text-[11px] text-white/30">{thread.lastMessageAt ? new Date(thread.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                        </div>
                      );
                    })}
                </div>
                {/* Scroll to top arrow */}
                <button
                  type="button"
                  className="absolute right-2 top-2 z-10 rounded-full bg-white/10 p-1 text-white/50 hover:bg-cyan-500/20 hover:text-cyan-300"
                  style={{display: 'block'}}
                  onClick={() => { dmListRef.current?.scrollTo({top: 0, behavior: 'smooth'}); }}
                  aria-label="Scroll to top"
                >
                  <ArrowUp size={16} />
                </button>
              </div>
            </div>
            {/* DM conversation panel (bottom 50%) */}
            {activeDm && (
              <div className="flex flex-col min-h-0 flex-1 border-t border-white/10 bg-[#10122a]" style={{height: '50%'}}>
                {/* Conversation header */}
                <div className="flex items-center justify-between px-2 py-2 border-b border-white/10">
                  <span className="text-[14px] font-semibold text-cyan-300">{dmThreads.find(t => t.id === activeDm)?.title ?? activeDm}</span>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-[12px] text-white/40 hover:text-cyan-400"
                    onClick={() => setActiveDm(null)}
                  >
                    Close
                  </button>
                </div>
                {/* Conversation messages */}
                <div className="flex-1 overflow-y-auto px-2 py-3">
                  {dmLoading ? (
                    <div className="flex justify-center py-4"><span className="text-white/40">Loading…</span></div>
                  ) : dmMessages.length === 0 ? (
                    <div className="mb-2 text-[12px] text-white/40">No messages yet. Start the conversation!</div>
                  ) : (
                    dmMessages.map((msg, idx) => {
                      const isOutgoing = msg.senderUserId === userId;
                      const reactions = dmMsgReactions[msg.id] || [];
                      // Reaction handlers
                      const handleReact = async (emoji: string) => {
                        const hasReacted = reactions.some((r: any) => Array.isArray(r.userIds) && r.userIds.includes(userId) && r.emoji === emoji);
                        const url = hasReacted ? getRemoveReactionUrl(activeDm, msg.id) : getAddReactionUrl(activeDm, msg.id);
                        await fetch(url, {
                          method: hasReacted ? 'DELETE' : 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ emoji }),
                        });
                        // Refresh messages
                        const res = await fetch(`/api/shared/chat/threads/${encodeURIComponent(activeDm)}/messages?limit=50`, { cache: 'no-store' });
                        const json = await res.json();
                        setDmMessages(Array.isArray(json?.messages) ? json.messages : []);
                        const nextReactions: Record<string, any[]> = {};
                        (json?.messages || []).forEach((msg: any) => {
                          nextReactions[msg.id] = getReactionsFromMetadata(msg.metadata);
                        });
                        setDmMsgReactions(nextReactions);
                      };
                      // Show who reacted (tooltip)
                      const getReactionTooltip = (r: any) => {
                        if (!Array.isArray(r.userIds) || !r.userIds.length) return '';
                        if (r.userIds.length === 1 && r.userIds[0] === userId) return 'You reacted';
                        if (r.userIds.includes(userId)) return `You and ${r.userIds.length - 1} others`;
                        return `${r.userIds.length} users`;
                      };
                      // Media click handler
                      const handleMediaClick = (url: string | null | undefined) => {
                        const safeUrl = resolveMediaViewerUrl(url);
                        if (safeUrl) setMediaViewerUrl(safeUrl);
                      };
                      return (
                        <>
                          <div key={msg.id} className={`mb-2 flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}>
                            <div className={`rounded-2xl px-3 py-2 text-[13px] max-w-[70%] ${isOutgoing ? 'rounded-tr-sm bg-cyan-500/15 text-white' : 'rounded-tl-sm bg-white/10 text-white/90'}`}>
                            {/* Media preview and rich rendering */}
                            <RichMessageRenderer message={msg} onImageClick={handleMediaClick} />
                            {/* Reactions bar */}
                            <div className="flex gap-1 mt-1 items-center">
                              {reactions.map((r: any) => (
                                <button
                                  key={r.emoji}
                                  type="button"
                                  onClick={() => handleReact(r.emoji)}
                                  className={`rounded-full px-1.5 py-0.5 text-xs border ${r.userIds?.includes(userId) ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200' : 'border-white/10 text-white/60'}`}
                                  aria-label={`Reacted ${r.emoji}`}
                                  title={getReactionTooltip(r)}
                                >
                                  {r.emoji} {r.count}
                                </button>
                              ))}
                              {/* Quick reactions */}
                              <div className="flex gap-0.5 ml-1">
                                {QUICK_REACTIONS.map((emoji) => (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => handleReact(emoji)}
                                    className="opacity-70 hover:opacity-100 text-sm leading-none"
                                    aria-label={`React ${emoji}`}
                                  >
                                    {emoji}
                                  </button>
                                ))}
                                {/* Custom emoji picker trigger */}
                                <button
                                  type="button"
                                  className="rounded-full px-1 py-0.5 text-xs border border-white/10 text-white/60 hover:bg-cyan-500/10 ml-1"
                                  aria-label="Add custom emoji"
                                  onClick={() => setEmojiPickerFor(msg.id)}
                                >
                                  <span role="img" aria-label="emoji">➕</span>
                                </button>
                              </div>
                            </div>
                            {/* Emoji picker popover */}
                            {emojiPickerFor === msg.id && (
                              <div className="absolute z-50 mt-2">
                                <EmojiPicker
                                  onSelect={emoji => {
                                    setEmojiPickerFor(null);
                                    handleReact(emoji);
                                  }}
                                  onClose={() => setEmojiPickerFor(null)}
                                />
                              </div>
                            )}
                            </div>
                          </div>
                          {/* Media viewer modal */}
                          {mediaViewerUrl && (
                            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setMediaViewerUrl(null)} role="dialog" aria-label="View media">
                              <button
                                type="button"
                                onClick={() => setMediaViewerUrl(null)}
                                className="absolute top-4 right-4 rounded-full p-2 text-white bg-black/50 hover:bg-black/70"
                                aria-label="Close"
                              >
                                ×
                              </button>
                              <img
                                src={mediaViewerUrl}
                                alt="Media preview"
                                className="max-w-full max-h-[90vh] object-contain rounded-lg"
                                onClick={e => e.stopPropagation()}
                              />
                              <a
                                href={mediaViewerUrl}
                                download
                                className="absolute bottom-8 right-8 rounded bg-cyan-600 px-4 py-2 text-white font-bold shadow-lg hover:bg-cyan-700"
                                aria-label="Download media"
                                onClick={e => e.stopPropagation()}
                              >
                                Download
                              </a>
                            </div>
                          )}
                        </>
                      );
                    })
                  )}
                </div>
                {/* Chat input bar */}
                <div className="shrink-0 border-t border-white/[0.07] bg-[#0a0a1f] px-2.5 py-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={dmInput}
                    onChange={e => {
                      setDmInput(e.target.value);
                      setIsTyping(true);
                      if (typingTimeout.current) clearTimeout(typingTimeout.current);
                      // Simulate typing event (POST to backend)
                      fetch(`/api/shared/chat/threads/${encodeURIComponent(activeDm)}/typing`, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ isTyping: true }),
                      });
                      typingTimeout.current = setTimeout(() => {
                        setIsTyping(false)
                        stopTyping()
                      }, 2000);
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') handleSendDm(); }}
                    placeholder={`Message ${dmThreads.find(t => t.id === activeDm)?.title ?? ''}...`}
                    className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white placeholder:text-white/30 focus:border-cyan-400 focus:outline-none"
                    disabled={dmSending}
                  />
                  <button
                    type="button"
                    onClick={handleSendDm}
                    disabled={dmSending || !dmInput.trim()}
                    className="rounded-lg p-2 text-white/40 transition-colors hover:bg-cyan-500/10 hover:text-cyan-400 disabled:opacity-40"
                    aria-label="Send DM"
                  >
                    <Send size={18} strokeWidth={2} />
                  </button>
                </div>
                {/* Typing indicator, read receipts, and error */}
                <div className="px-3 pb-1 pt-0.5 text-[12px] min-h-[18px]">
                  {otherTyping && <span className="text-cyan-300">The other user is typing…</span>}
                  {sendError && <span className="text-rose-400 ml-2">{sendError}</span>}
                  {lastReadLabel ? <span className="text-white/30 ml-2">{lastReadLabel}</span> : null}
                </div>
                </div>
            )}
            {/* End DM split view */}
            {!activeDm && (
              <>
                <div className="mt-6 flex flex-col items-center rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-8 text-center">
                  <Inbox className="mb-2 h-8 w-8 text-white/25" strokeWidth={1.5} aria-hidden />
                  <p className="text-[13px] font-semibold text-white/45">No other DMs yet</p>
                  <p className="mt-1 max-w-[220px] text-[12px] text-white/30">Start a conversation with a league member</p>
                </div>
                {discordConnected ? (
                  <div className="mt-3 border-t border-white/[0.05] pt-3">
                    <p className="mb-2 text-center text-[11px] text-white/30">Message league managers directly on Discord</p>
                    <a
                      href="https://discord.com/channels/@me"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#5865F2]/10 py-2 text-[12px] font-semibold text-[#5865F2] transition-colors hover:bg-[#5865F2]/20"
                    >
                      <DiscordIcon size={12} />
                      Open Discord DMs
                    </a>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
