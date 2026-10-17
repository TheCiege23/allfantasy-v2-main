'use client'

import { useState, useCallback, useRef } from 'react'
import Link from 'next/link'

// ─── TYPES ────────────────────────────────────────────────────────

type Platform = 'sleeper' | 'yahoo' | 'mfl' | 'espn' | 'fleaflicker' | 'fantrax'
type Step = 1 | 2 | 3 | 4 | 5

interface TransferOptions {
  copyDraftHistory:   boolean
  copyPlayoffHistory: boolean
  copyTradeHistory:   boolean
  copyWaiverHistory:  boolean
  copyRosters:        boolean
  copySettings:       boolean
}

interface LeaguePreview {
  name:             string
  season:           string | number
  sport:            string
  teamCount:        number
  format:           string
  managers:         { name: string; avatar?: string }[]
  rosterPositions:  string[]
  playoffTeams?:    number
  hasDraft:         boolean
}

interface ProgressEvent {
  step:      string
  progress:  number
  message:   string
  leagueId?: string
  error?:    string
}

// ─── PLATFORM CONFIG ──────────────────────────────────────────────

const PLATFORMS: {
  id: Platform; label: string; emoji: string; color: string;
  available: boolean; support: string
}[] = [
  {
    id: 'sleeper', label: 'Sleeper', emoji: '🌙', color: '#818cf8',
    available: true,
    support: 'Full transfer: settings, rosters, draft history, playoffs & trades'
  },
  {
    id: 'yahoo', label: 'Yahoo', emoji: '🏈', color: '#ef4444',
    available: false,
    support: 'Full transfer support — coming soon'
  },
  {
    id: 'mfl', label: 'MFL', emoji: '🏆', color: '#fbbf24',
    available: false,
    support: 'Full transfer support — coming soon'
  },
  {
    id: 'espn', label: 'ESPN', emoji: '🔴', color: '#f97316',
    available: false,
    support: 'Settings + rosters (draft history limited) — coming soon'
  },
  {
    id: 'fleaflicker', label: 'Fleaflicker', emoji: '🦊', color: '#34d399',
    available: false,
    support: 'Full transfer support — coming soon'
  },
  {
    id: 'fantrax', label: 'Fantrax', emoji: '📊', color: '#a78bfa',
    available: false,
    support: 'Scoring + rosters (no draft history) — coming soon'
  },
]

const PLATFORM_HELP: Record<Platform, string> = {
  sleeper:     'Go to your Sleeper league → Settings → scroll down → copy the League ID (looks like: 1234567890123456789)',
  yahoo:       'Go to your Yahoo league → Settings → League ID appears in the URL (looks like: 12345)',
  mfl:         'Log into MFL → League → Settings → copy the League ID from the URL',
  espn:        'Go to your ESPN league → Settings → League ID is in the URL after /league/',
  fleaflicker: 'Go to your Fleaflicker league → Settings → League ID is in the URL',
  fantrax:     'Go to your Fantrax league → Settings → League ID appears in the URL',
}

const TRANSFER_STEPS_INFO = [
  { key: 'validating', label: 'Validating league' },
  { key: 'settings',   label: 'Copying settings'  },
  { key: 'rosters',    label: 'Copying rosters'   },
  { key: 'drafts',     label: 'Draft history'     },
  { key: 'playoffs',   label: 'Playoff history'   },
  { key: 'trades',     label: 'Trade history'     },
  { key: 'complete',   label: 'Complete'           },
]

// ─── STEP INDICATOR ───────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const steps = ['Platform', 'League ID', 'Preview', 'Transferring', 'Done']
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {steps.map((label, i) => {
        const num    = (i + 1) as Step
        const done   = current > num
        const active = current === num
        return (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black transition-all ${
                done   ? 'bg-green-500 text-white' :
                active ? 'bg-gradient-to-br from-cyan-500 to-violet-500 text-white' :
                'bg-white/10 text-white/30'
              }`}>
                {done ? '✓' : num}
              </div>
              <span className={`text-[11px] font-semibold whitespace-nowrap ${
                active ? 'text-white/80' : done ? 'text-green-400' : 'text-white/25'
              }`}>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`w-12 h-0.5 mb-4 mx-1 transition-all ${
                done ? 'bg-green-500' : 'bg-white/10'
              }`}/>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── STEP 1 — PLATFORM ────────────────────────────────────────────

function PlatformStep({ onSelect }: { onSelect: (p: Platform) => void }) {
  const [hovered, setHovered] = useState<Platform | null>(null)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-white mb-1">Select Source Platform</h2>
        <p className="text-sm text-white/45">
          Choose where your league currently lives. We&apos;ll copy everything over exactly.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {PLATFORMS.map(p => (
          <button
            key={p.id}
            onClick={() => p.available && onSelect(p.id)}
            onMouseEnter={() => setHovered(p.id)}
            onMouseLeave={() => setHovered(null)}
            disabled={!p.available}
            className={`relative text-left rounded-2xl border p-5 transition-all duration-200 ${
              p.available
                ? 'cursor-pointer hover:scale-[1.02] active:scale-[0.98]'
                : 'cursor-not-allowed opacity-50'
            }`}
            style={{
              borderColor: p.available && hovered === p.id ? `${p.color}60` : 'rgba(255,255,255,0.08)',
              background:  '#0c0c1e',
              boxShadow:   p.available && hovered === p.id ? `0 0 24px ${p.color}20` : 'none',
            }}
          >
            {!p.available && (
              <div className="absolute top-3 right-3 text-[11px] font-black bg-white/10 text-white/40 rounded-full px-2 py-0.5">
                SOON
              </div>
            )}

            <div className="text-3xl mb-3">{p.emoji}</div>
            <div className="font-black text-white mb-1" style={p.available ? { color: p.color } : {}}>
              {p.label}
            </div>
            <p className="text-[11px] text-white/40 leading-relaxed">{p.support}</p>

            {p.available && (
              <div className="mt-3 text-[11px] font-bold" style={{ color: p.color }}>
                {hovered === p.id ? 'Select →' : '● Available'}
              </div>
            )}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-white/6 bg-white/2 p-4 text-sm text-white/40 text-center">
        🔒 We only read your league data. We never post, never charge, and never store credentials.
      </div>
    </div>
  )
}

// ─── STEP 2 — LEAGUE ID ───────────────────────────────────────────

function LeagueIdStep({
  platform, leagueId, onLeagueIdChange, options, onOptionsChange, onPreview, loading
}: {
  platform:         Platform
  leagueId:         string
  onLeagueIdChange: (v: string) => void
  options:          TransferOptions
  onOptionsChange:  (o: TransferOptions) => void
  onPreview:        () => void
  loading:          boolean
}) {
  const plat = PLATFORMS.find(p => p.id === platform)!

  const toggleOption = (key: keyof TransferOptions) => {
    onOptionsChange({ ...options, [key]: !options[key] })
  }

  const DATA_OPTIONS: { key: keyof TransferOptions; label: string; required: boolean }[] = [
    { key: 'copySettings',       label: 'Scoring settings & roster positions', required: true  },
    { key: 'copyRosters',        label: 'Manager names & rosters (exact copy)', required: true  },
    { key: 'copyDraftHistory',   label: 'Draft history — all rounds & picks',  required: false },
    { key: 'copyPlayoffHistory', label: 'Playoff bracket history',             required: false },
    { key: 'copyTradeHistory',   label: 'Trade history',                       required: false },
    { key: 'copyWaiverHistory',  label: 'Waiver wire history',                 required: false },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => window.history.back()}
          className="text-sm text-white/40 hover:text-white transition-colors"
        >
          ← Back
        </button>
        <div>
          <h2 className="text-2xl font-black text-white">
            <span style={{ color: plat.color }}>{plat.emoji} {plat.label}</span> League
          </h2>
          <p className="text-sm text-white/45">Enter your league ID to begin the transfer</p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-5 space-y-4">
        <div>
          <label className="text-[11px] font-bold text-white/40 uppercase tracking-widest mb-2 block">
            {plat.label} League ID
          </label>
          <input
            value={leagueId}
            onChange={e => onLeagueIdChange(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && leagueId.trim() && onPreview()}
            placeholder="e.g. 1048565026074173440"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/20 focus:border-cyan-500/50 focus:outline-none transition-colors font-mono"
          />
          <p className="text-[11px] text-white/30 mt-2">💡 {PLATFORM_HELP[platform]}</p>
        </div>

        <div>
          <p className="text-[11px] font-bold text-white/40 uppercase tracking-widest mb-3">
            What to transfer
          </p>
          <div className="space-y-2.5">
            {DATA_OPTIONS.map(opt => (
              <label key={opt.key} className="flex items-start gap-3 cursor-pointer group">
                <div
                  onClick={() => !opt.required && toggleOption(opt.key)}
                  className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 transition-all border ${
                    options[opt.key]
                      ? 'bg-cyan-500 border-cyan-500 text-black'
                      : 'border-white/20 bg-white/5'
                  } ${opt.required ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  {options[opt.key] && <span className="text-[11px] font-black">✓</span>}
                </div>
                <div>
                  <span className={`text-sm ${options[opt.key] ? 'text-white/80' : 'text-white/40'}`}>
                    {opt.label}
                  </span>
                  {opt.required && (
                    <span className="ml-2 text-[11px] text-cyan-400/60 font-bold uppercase tracking-wide">Required</span>
                  )}
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      <button
        onClick={onPreview}
        disabled={!leagueId.trim() || loading}
        className="w-full rounded-2xl py-4 text-sm font-black transition-all disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98]"
        style={{
          background: 'linear-gradient(135deg, #0891b2, #7c3aed)',
          boxShadow:  leagueId.trim() ? '0 8px 32px rgba(8,145,178,0.3)' : 'none',
        }}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10"/>
            </svg>
            Fetching league data...
          </span>
        ) : 'Preview League →'}
      </button>
    </div>
  )
}

// ─── STEP 3 — PREVIEW ─────────────────────────────────────────────

function PreviewStep({
  preview, platform, onConfirm, onBack, loading
}: {
  preview:   LeaguePreview
  platform:  Platform
  onConfirm: () => void
  onBack:    () => void
  loading:   boolean
}) {
  const plat = PLATFORMS.find(p => p.id === platform)!

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-black text-white mb-1">League Preview</h2>
        <p className="text-sm text-white/45">Verify the details below before transferring</p>
      </div>

      {/* League header */}
      <div className="rounded-3xl border overflow-hidden"
           style={{ borderColor: `${plat.color}40`, background: `radial-gradient(ellipse at top left, ${plat.color}15, #0c0c1e)` }}>
        <div className="h-0.5 w-full" style={{ background: `linear-gradient(90deg, transparent, ${plat.color}, transparent)` }}/>
        <div className="p-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">{plat.emoji}</span>
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: plat.color }}>{plat.label}</span>
          </div>
          <h3 className="text-3xl font-black text-white mb-1">{preview.name}</h3>
          <div className="flex flex-wrap gap-2 mt-3">
            {[
              preview.sport?.toUpperCase(),
              preview.format,
              `${preview.teamCount} teams`,
              `${preview.season} season`,
            ].filter(Boolean).map(tag => (
              <span key={tag} className="text-xs bg-white/8 border border-white/10 rounded-full px-3 py-1 text-white/60">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Managers list */}
      <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-5">
        <p className="text-[11px] font-bold text-white/40 uppercase tracking-widest mb-3">
          Managers ({preview.managers.length}) — copied exactly
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {preview.managers.map((m, i) => (
            <div key={i} className="flex items-center gap-2 rounded-xl bg-white/4 px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500/30 to-violet-500/30 flex items-center justify-center text-xs font-bold text-white/60 shrink-0">
                {m.name.charAt(0).toUpperCase()}
              </div>
              <span className="text-xs text-white/80 truncate font-semibold">{m.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* What will transfer */}
      <div className="rounded-2xl border border-green-500/20 bg-green-500/5 p-4">
        <p className="text-xs font-bold text-green-400 uppercase tracking-widest mb-2">✅ Ready to transfer</p>
        <div className="space-y-1">
          {[
            'League name (exact copy)',
            'All manager names (exact copy)',
            'Scoring settings & roster positions',
            preview.hasDraft ? 'Draft history — all rounds & picks' : null,
            'Playoff bracket history',
          ].filter(Boolean).map(item => (
            <div key={item} className="flex items-center gap-2 text-xs text-white/60">
              <span className="text-green-400">✓</span> {item}
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 rounded-2xl py-3.5 text-sm font-bold border border-white/15 text-white/60 hover:text-white hover:border-white/30 transition-all"
        >
          ← Back
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className="flex-[2] rounded-2xl py-3.5 text-sm font-black transition-all disabled:opacity-40 active:scale-[0.98]"
          style={{ background: 'linear-gradient(135deg, #059669, #0891b2)', boxShadow: '0 8px 24px rgba(5,150,105,0.3)' }}
        >
          Confirm & Transfer →
        </button>
      </div>
    </div>
  )
}

// ─── STEP 4 — PROGRESS ────────────────────────────────────────────

function ProgressStep({ events }: { events: ProgressEvent[] }) {
  const latest      = events[events.length - 1]
  const overallPct  = latest?.progress ?? 0
  const currentKey  = latest?.step ?? 'validating'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-white mb-1">Transferring League</h2>
        <p className="text-sm text-white/45">This usually takes 30–90 seconds</p>
      </div>

      {/* Progress bar */}
      <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-5">
        <div className="flex items-center justify-between text-sm mb-3">
          <span className="font-bold text-white">{latest?.message ?? 'Starting...'}</span>
          <span className="font-black text-cyan-400">{overallPct}%</span>
        </div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width:      `${overallPct}%`,
              background: 'linear-gradient(90deg, #0891b2, #7c3aed)',
              boxShadow:  '0 0 12px rgba(8,145,178,0.5)',
            }}
          />
        </div>
      </div>

      {/* Step tracker */}
      <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-5 space-y-2">
        {TRANSFER_STEPS_INFO.filter(s => s.key !== 'complete').map(s => {
          const isDone      = events.some(e => {
            const idx      = TRANSFER_STEPS_INFO.findIndex(x => x.key === e.step)
            const thisIdx  = TRANSFER_STEPS_INFO.findIndex(x => x.key === s.key)
            return idx > thisIdx
          })
          const isActive    = currentKey === s.key

          return (
            <div key={s.key} className={`flex items-center gap-3 rounded-xl px-4 py-2.5 transition-all ${
              isActive  ? 'bg-cyan-500/10 border border-cyan-500/20' : ''
            }`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 ${
                isDone   ? 'bg-green-500 text-white' :
                isActive ? 'border border-cyan-500 bg-transparent' :
                'bg-white/10 text-white/30'
              }`}>
                {isDone   ? '✓' :
                 isActive ? <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse block"/> :
                 ''}
              </div>
              <span className={`text-sm ${
                isDone   ? 'text-green-400' :
                isActive ? 'text-white font-semibold' :
                'text-white/30'
              }`}>{s.label}</span>
              {isActive && (
                <div className="ml-auto w-3 h-3 rounded-full border border-cyan-500 border-t-transparent animate-spin"/>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── STEP 5 — SUCCESS ─────────────────────────────────────────────

function SuccessStep({ leagueName, leagueId, onReset }: {
  leagueName: string; leagueId: string; onReset: () => void
}) {
  return (
    <div className="text-center space-y-6">
      <div className="text-7xl animate-bounce">🎉</div>
      <div>
        <h2 className="text-3xl font-black text-white mb-2">Transfer Complete!</h2>
        <p className="text-base text-white/55">
          <span className="font-bold text-white">&quot;{leagueName}&quot;</span> is now on AllFantasy.
        </p>
      </div>

      <div className="rounded-2xl border border-green-500/30 bg-green-500/8 p-5">
        <p className="text-sm text-white/60 mb-1">Your league was transferred with:</p>
        <div className="text-xs space-y-1">
          {['All manager names (exact copy)', 'Scoring settings & roster positions', 'Draft history', 'Playoff brackets'].map(item => (
            <div key={item} className="flex items-center gap-2 text-white/60">
              <span className="text-green-400">✓</span> {item}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          href={`/league/${leagueId}`}
          className="flex-1 rounded-2xl py-3.5 text-sm font-black text-center transition-all active:scale-[0.98]"
          style={{ background: 'linear-gradient(135deg, #059669, #0891b2)', boxShadow: '0 8px 24px rgba(5,150,105,0.3)' }}
        >
          View My League →
        </Link>
        <button
          onClick={onReset}
          className="flex-1 rounded-2xl py-3.5 text-sm font-bold border border-white/15 text-white/60 hover:text-white hover:border-white/30 transition-all"
        >
          Transfer Another League
        </button>
      </div>
    </div>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────

export default function LeagueTransferPage() {
  const [step,      setStep]      = useState<Step>(1)
  const [platform,  setPlatform]  = useState<Platform | null>(null)
  const [leagueId,  setLeagueId]  = useState('')
  const [preview,   setPreview]   = useState<LeaguePreview | null>(null)
  const [options,   setOptions]   = useState<TransferOptions>({
    copyDraftHistory:   true,
    copyPlayoffHistory: true,
    copyTradeHistory:   true,
    copyWaiverHistory:  false,
    copyRosters:        true,
    copySettings:       true,
  })
  const [events,    setEvents]    = useState<ProgressEvent[]>([])
  const [finalId,   setFinalId]   = useState<string | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const hasReachedDoneStep = useRef(false)

  const handleSelectPlatform = useCallback((p: Platform) => {
    setPlatform(p)
    setStep(2)
  }, [])

  const handlePreview = useCallback(async () => {
    if (!platform || !leagueId.trim()) return
    setLoading(true)
    setError(null)

    try {
      const res  = await fetch(`/api/league/transfer?platform=${platform}&leagueId=${leagueId.trim()}`)
      const data = await res.json()

      if (!data.available) {
        throw new Error(data.message ?? 'League not found')
      }

      setPreview(data.league)
      setStep(3)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch league')
    } finally {
      setLoading(false)
    }
  }, [platform, leagueId])

  const handleTransfer = useCallback(async () => {
    if (!platform || !leagueId.trim()) return
    setLoading(true)
    setError(null)
    setEvents([])
    setStep(4)
    hasReachedDoneStep.current = false

    try {
      const res = await fetch('/api/league/transfer', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ platform, leagueId: leagueId.trim(), options }),
      })

      if (!res.body) throw new Error('No response stream')

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6)
          if (raw === '[DONE]') break

          try {
            const event = JSON.parse(raw) as ProgressEvent
            setEvents(prev => [...prev, event])

            if (event.step === 'complete' && event.leagueId) {
              setFinalId(event.leagueId)
              setStep(5)
              hasReachedDoneStep.current = true
            }
            if (event.step === 'error') {
              setError(event.error ?? 'Transfer failed')
              setStep(3)
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Transfer failed')
      setStep(3)
    } finally {
      setLoading(false)
      if (!hasReachedDoneStep.current) {
        setStep(3)
      }
    }
  }, [platform, leagueId, options])

  const reset = useCallback(() => {
    setStep(1)
    setPlatform(null)
    setLeagueId('')
    setPreview(null)
    setEvents([])
    setFinalId(null)
    setError(null)
    setLoading(false)
  }, [])

  return (
    <div className="min-h-screen bg-[#07071a] text-white">
      {/* Header */}
      <div className="border-b border-white/6 bg-[#07071a]/80 backdrop-blur-xl sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-4">
          <Link href="/tools-hub" className="text-sm text-white/40 hover:text-white transition-colors">
            ← Tools Hub
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-cyan-400 uppercase tracking-widest">🔄 Commissioner Tool</span>
            </div>
            <h1 className="text-lg font-black text-white">League Transfer</h1>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        <StepIndicator current={step}/>

        {/* Error banner */}
        {error && (
          <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 flex items-center gap-3">
            <span>⚠️</span>
            <p className="text-sm text-red-300 flex-1">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">✕</button>
          </div>
        )}

        {step === 1 && <PlatformStep onSelect={handleSelectPlatform}/>}

        {step === 2 && platform && (
          <LeagueIdStep
            platform={platform}
            leagueId={leagueId}
            onLeagueIdChange={setLeagueId}
            options={options}
            onOptionsChange={setOptions}
            onPreview={handlePreview}
            loading={loading}
          />
        )}

        {step === 3 && preview && platform && (
          <PreviewStep
            preview={preview}
            platform={platform}
            onConfirm={handleTransfer}
            onBack={() => setStep(2)}
            loading={loading}
          />
        )}

        {step === 4 && <ProgressStep events={events}/>}

        {step === 5 && finalId && (
          <SuccessStep
            leagueName={preview?.name ?? 'Your League'}
            leagueId={finalId}
            onReset={reset}
          />
        )}
      </div>
    </div>
  )
}
