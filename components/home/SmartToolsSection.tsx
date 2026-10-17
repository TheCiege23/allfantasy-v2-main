"use client"

import { useState } from "react"
import { Brain, Clock, DraftingCompass, Sparkles, PlayCircle } from "lucide-react"

const SUPPORTED_SPORTS = ["NFL", "NHL", "NBA", "MLB", "NCAAF", "NCAAB", "SOCCER"] as const

type AIRecommendation = {
  id: string
  player: string
  sport: string
  reason: string
}

type QuickDraftLeague = {
  id: string
  name: string
  sport: string
  startsIn: string
  entries: string
  draftType: string
}

type MockDraftConfig = {
  sport: string
  leagueType: string
  draftType: string
  aiEnabled: boolean
}

const MOCK_AI_RECS: AIRecommendation[] = [
  {
    id: "rec1",
    player: "Garrett Wilson",
    sport: "NFL",
    reason: "Target volume spike and friendly playoff schedule flagged by the AI trend model.",
  },
  {
    id: "rec2",
    player: "Tyrese Haliburton",
    sport: "NBA",
    reason: "Elite assist+usage combo in pace-up games, strong fit for 9-cat builds.",
  },
  {
    id: "rec3",
    player: "Elly De La Cruz",
    sport: "MLB",
    reason: "Power/speed projection with upside in stolen bases against weak batteries.",
  },
]

const MOCK_QUICK_DRAFTS: QuickDraftLeague[] = [
  {
    id: "qd1",
    name: "AllFantasy Best Ball Warmup",
    sport: "NFL",
    startsIn: "Starts in 12 min",
    entries: "6 / 12 filled",
    draftType: "Snake",
  },
  {
    id: "qd2",
    name: "Dynasty Startup Night Shift",
    sport: "NFL",
    startsIn: "Starts in 28 min",
    entries: "3 / 10 filled",
    draftType: "Auction",
  },
  {
    id: "qd3",
    name: "Hoops Fast Draft",
    sport: "NBA",
    startsIn: "Starts in 45 min",
    entries: "9 / 12 filled",
    draftType: "Snake",
  },
]

export default function SmartToolsSection() {
  const [mockConfig, setMockConfig] = useState<MockDraftConfig>({
    sport: "NFL",
    leagueType: "redraft",
    draftType: "snake",
    aiEnabled: true,
  })

  const [creatingMock, setCreatingMock] = useState(false)
  const [lastMockId, setLastMockId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleStartMock = () => {
    if (creatingMock) return
    setCreatingMock(true)
    setError(null)

    void (async () => {
      try {
        const res = await fetch("/api/mock-draft/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(mockConfig),
        })
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          setError(json?.error || "Unable to start mock draft. Please try again.")
          return
        }
        const json = await res.json()
        setLastMockId(String(json?.draftId || ""))
        // In a future step we can route to /af-legacy?screen=mock-draft&draftId=...
      } catch {
        setError("Unable to start mock draft. Please try again.")
      } finally {
        setCreatingMock(false)
      }
    })()
  }

  return (
    <section className="px-4 pb-8 pt-6 sm:px-6 sm:pb-10 sm:pt-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:gap-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white sm:text-base">
              Smart tools for your next move
            </h2>
            <p className="text-[11px] text-white/70 sm:text-xs">
              AI-powered suggestions, fast drafts, and mock rooms tuned for future-season prep.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {/* AI Player Recommendations */}
          <div className="flex flex-col rounded-2xl border border-emerald-400/35 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-white">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-400/60 bg-black/40">
                  <Brain className="h-4 w-4 text-emerald-300" />
                </div>
                <div className="leading-tight">
                  <p className="text-xs font-semibold">AI Player Recommendations</p>
                  <p className="text-[11px] text-emerald-100/80">Placeholder feed • wired for AI later</p>
                </div>
              </div>
            </div>
            <ul className="mt-1 space-y-2.5 text-xs">
              {MOCK_AI_RECS.map((rec) => (
                <li
                  key={rec.id}
                  className="rounded-xl border border-emerald-400/25 bg-black/40 px-2.5 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-white">{rec.player}</p>
                      <p className="text-[11px] text-emerald-100/80">{rec.sport}</p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
                      <Sparkles className="h-3 w-3" />
                      AI
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-emerald-50/90">{rec.reason}</p>
                </li>
              ))}
            </ul>
          </div>

          {/* Quick Draft */}
          <div className="flex flex-col rounded-2xl border border-cyan-400/40 bg-gradient-to-br from-cyan-500/15 via-cyan-500/5 to-transparent p-4">
            <div className="mb-2 flex items-center gap-2 text-white">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-cyan-400/60 bg-black/40">
                <Clock className="h-4 w-4 text-cyan-300" />
              </div>
              <div className="leading-tight">
                <p className="text-xs font-semibold">Quick Draft</p>
                <p className="text-[11px] text-cyan-100/85">Leagues starting soon (placeholder schedule)</p>
              </div>
            </div>
            <ul className="mt-1 space-y-2.5 text-xs">
              {MOCK_QUICK_DRAFTS.map((league) => (
                <li
                  key={league.id}
                  className="rounded-xl border border-cyan-400/30 bg-black/40 px-2.5 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-white">{league.name}</p>
                      <p className="text-[11px] text-cyan-100/85">
                        {league.sport} • {league.draftType}
                      </p>
                    </div>
                    <span className="text-[11px] font-medium text-cyan-100/90">
                      {league.startsIn}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-cyan-50/85">
                    <span>{league.entries}</span>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-full bg-cyan-400 px-2 py-0.5 text-[11px] font-semibold text-black shadow-sm"
                    >
                      <PlayCircle className="h-3 w-3" />
                      Join
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Mock Draft setup */}
          <div className="flex flex-col rounded-2xl border border-violet-400/45 bg-gradient-to-br from-violet-500/18 via-violet-500/5 to-transparent p-4">
            <div className="mb-2 flex items-center gap-2 text-white">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-violet-400/70 bg-black/40">
                <DraftingCompass className="h-4 w-4 text-violet-300" />
              </div>
              <div className="leading-tight">
                <p className="text-xs font-semibold">Mock Draft</p>
                <p className="text-[11px] text-violet-100/85">
                  Configure your room now • AI toggle ready for future coaching.
                </p>
              </div>
            </div>

            <div className="mt-1 space-y-2.5 text-xs text-white/80">
              <div className="space-y-1">
                <label className="text-[11px] text-white/80">Sport</label>
                <select
                  value={mockConfig.sport}
                  onChange={(e) =>
                    setMockConfig((cfg) => ({ ...cfg, sport: e.target.value }))
                  }
                  className="w-full rounded-xl border border-white/15 bg-black/40 px-2 py-1.5 text-xs outline-none"
                >
                  {SUPPORTED_SPORTS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-white/80">League type</label>
                <select
                  value={mockConfig.leagueType}
                  onChange={(e) =>
                    setMockConfig((cfg) => ({ ...cfg, leagueType: e.target.value }))
                  }
                  className="w-full rounded-xl border border-white/15 bg-black/40 px-2 py-1.5 text-xs outline-none"
                >
                  <option value="redraft">Redraft</option>
                  <option value="dynasty">Dynasty</option>
                  <option value="bestball">Best Ball</option>
                  <option value="keeper">Keeper</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-white/80">Draft type</label>
                <select
                  value={mockConfig.draftType}
                  onChange={(e) =>
                    setMockConfig((cfg) => ({ ...cfg, draftType: e.target.value }))
                  }
                  className="w-full rounded-xl border border-white/15 bg-black/40 px-2 py-1.5 text-xs outline-none"
                >
                  <option value="snake">Snake</option>
                  <option value="auction">Auction</option>
                  <option value="3rr">3rd-round reversal</option>
                </select>
              </div>

              <div className="mt-1 flex items-center justify-between gap-2 rounded-xl border border-violet-400/40 bg-black/40 px-2.5 py-1.5 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-violet-300" />
                  <div className="leading-tight">
                    <p className="font-semibold text-violet-50">AI assistance</p>
                    <p className="text-[11px] text-violet-100/80">
                      Let the AI suggest picks, tiers, and trade-offs.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setMockConfig((cfg) => ({ ...cfg, aiEnabled: !cfg.aiEnabled }))
                  }
                  className={`relative inline-flex h-6 w-10 items-center rounded-full border px-0.5 transition-colors ${
                    mockConfig.aiEnabled
                      ? "border-violet-300 bg-violet-400/80"
                      : "border-white/20 bg-black/60"
                  }`}
                  aria-pressed={mockConfig.aiEnabled}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-black transition-transform ${
                      mockConfig.aiEnabled ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <button
                type="button"
                onClick={handleStartMock}
                disabled={creatingMock}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full bg-violet-400 px-4 py-2 text-xs font-semibold text-black shadow-sm hover:bg-violet-300 disabled:opacity-50"
              >
                <PlayCircle className="h-4 w-4" />
                <span>{creatingMock ? "Creating mock draft..." : "Start mock draft"}</span>
              </button>

              {lastMockId && !error && (
                <p className="mt-1 text-[11px] text-violet-100/80">
                  Mock draft created. ID: <span className="font-mono">{lastMockId}</span>
                </p>
              )}
              {error && (
                <p className="mt-1 text-[11px] text-red-200/90">
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

