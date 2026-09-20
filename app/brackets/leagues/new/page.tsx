"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { ArrowLeft, Loader2, Globe, Lock, Trophy, Goal } from "lucide-react"
import { SUPPORTED_SPORTS, normalizeToSupportedSport } from "@/lib/sport-scope"
import { getRoundPointsSummary } from "@/lib/bracket-challenge"
import { CommissionerFanCredSetupNotice } from "@/components/legal/CommissionerFanCredSetupNotice"
import { createPlayoffBracketChallengeClient } from "@/lib/playoffs/playoffClientApi"
import { indefiniteArticleFor } from "@/lib/text/indefiniteArticle"
import { defaultPlayoffChallengeConfig, isAfCommissionerSubscriber, sanitizePlayoffChallengeConfig } from "@/lib/playoffs/playoffChallengeConfig"

const SCORING_OPTIONS = [
  { value: "momentum", label: "Standard (1-2-4-8-16-32)" },
  { value: "fancred_edge", label: "AF Edge (upset & leverage)" },
  { value: "accuracy_boldness", label: "Accuracy + Boldness" },
  { value: "streak_survival", label: "Streak & Survival" },
] as const

const SPORT_LABELS: Record<string, string> = {
  NFL: "NFL",
  NHL: "NHL",
  NBA: "NBA",
  MLB: "MLB",
  NCAAF: "NCAA Football",
  NCAAB: "NCAA Basketball",
  SOCCER: "Soccer",
}

const CHALLENGE_TYPE_OPTIONS = [
  {
    id: "playoff_challenge",
    label: "Playoff Challenge",
    description: "Sport-specific playoff bracket with locked progression and live standings.",
  },
  {
    id: "mens_ncaa",
    label: "Classic NCAA Board",
    description: "Traditional multi-round NCAA bracket board.",
  },
] as const

type ChallengeType = (typeof CHALLENGE_TYPE_OPTIONS)[number]["id"]

export default function NewBracketLeaguePage() {
  const { data: session } = useSession()
  const now = new Date()
  const defaultSeason = now.getFullYear()
  const searchParams = useSearchParams()

  const [name, setName] = useState("")
  const [season, setSeason] = useState<number>(defaultSeason)
  const [sport, setSport] = useState<string>("NCAAB")
  const [challengeType, setChallengeType] = useState<ChallengeType>("playoff_challenge")
  const [isPublic, setIsPublic] = useState(false)
  const [maxUsers, setMaxUsers] = useState(50)
  const [lockRule, setLockRule] = useState("series_start")
  const [scoringMode, setScoringMode] = useState<string>("momentum")
  const [maxEntriesPerUser, setMaxEntriesPerUser] = useState(1)
  const [tiebreakerEnabled, setTiebreakerEnabled] = useState(true)
  const [tiebreakerType, setTiebreakerType] = useState("championship_total_points")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAgeConfirm, setShowAgeConfirm] = useState(false)
  const [ageConfirming, setAgeConfirming] = useState(false)
  const router = useRouter()
  /*
   * 🛑 THE SPORTS LISTED HERE ARE THE ONLY ONES A POOL CAN BE CREATED FOR
   * SAFELY, and falling off this list is not a graceful degradation — it is a
   * dead end. Anything else drops through to `POST /api/bracket/leagues`, the
   * legacy BracketLeague stack, whose own league page renders "This pool has
   * been migrated" and offers no way into the pool. That is exactly what
   * picking MLB did before this line learned about it: the create succeeded,
   * the redirect landed, and the user got a wall.
   *
   * Keep this in step with the create API's `sport` enum in
   * app/api/brackets/playoffs/route.ts — they are the same decision written
   * twice, and only the API one is enforced.
   */
  const PLAYOFF_POOL_SPORTS = ["NBA", "NHL", "MLB"]
  const isPlayoffPool = challengeType === "playoff_challenge" && PLAYOFF_POOL_SPORTS.includes(sport)
  const isAfCommissioner = isAfCommissionerSubscriber(session?.user)

  useEffect(() => {
    const requestedSport = searchParams?.get("sport")
    const requestedType = searchParams?.get("challengeType")

    if (requestedSport) {
      const normalized = normalizeToSupportedSport(requestedSport)
      if (normalized === "SOCCER") {
        // Soccer pools live in the World Cup product, not the legacy BracketLeague stack.
        router.replace("/brackets/world-cup/create")
        return
      }
      setSport(normalized)
      if (normalized !== "NCAAB") {
        setChallengeType("playoff_challenge")
      }
    }

    if (requestedType === "mens_ncaa" || requestedType === "playoff_challenge") {
      setChallengeType(requestedType)
    }
  }, [searchParams, router])

  useEffect(() => {
    if (sport !== "NCAAB" && challengeType === "mens_ncaa") {
      setChallengeType("playoff_challenge")
    }
  }, [sport, challengeType])

  const sportLabel = useMemo(() => SPORT_LABELS[sport] ?? sport, [sport])
  const scoringSummary = useMemo(
    () => getRoundPointsSummary(challengeType === "playoff_challenge" ? { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32 } : undefined),
    [challengeType],
  )

  async function handleConfirmAge() {
    setAgeConfirming(true)
    try {
      const res = await fetch("/api/auth/confirm-age", { method: "POST" })
      if (res.ok) {
        setShowAgeConfirm(false)
        setError(null)
        setTimeout(() => submitPool(), 400)
      } else {
        setError("Failed to confirm age. Please try again.")
      }
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setAgeConfirming(false)
    }
  }

  async function submitPool() {
    setError(null)
    setShowAgeConfirm(false)
    setLoading(true)

    const returnTo = `/brackets/leagues/new?sport=${encodeURIComponent(sport)}&challengeType=${encodeURIComponent(challengeType)}`

    try {
      if (isPlayoffPool) {
        const playoffSport = sport.toLowerCase() as "nba" | "nhl" | "mlb"
        const config = sanitizePlayoffChallengeConfig(
          defaultPlayoffChallengeConfig({
            visibility: isPublic ? "public" : "private",
            maxParticipants: maxUsers,
            maxEntriesPerParticipant: maxEntriesPerUser,
            scoringStyle: scoringMode,
            lockRule,
          }),
          { afCommissionerEnabled: isAfCommissioner },
        )
        const result = await createPlayoffBracketChallengeClient({
          name: name.trim(),
          sport: playoffSport,
          seasonYear: season,
          isTestMode: false,
          visibility: isPublic ? "public" : "private",
          maxUsers,
          bracketsPerUser: maxEntriesPerUser,
          scoringStyle: scoringMode,
          lockRule,
          config,
        })
        router.push(result.redirectUrl)
        return
      }

      const res = await fetch("/api/bracket/leagues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          season,
          sport,
          maxManagers: 100,
          isPublic,
          scoringMode,
          bracketType: challengeType,
          maxEntriesPerUser,
          entriesPerUserFree: maxEntriesPerUser,
          tiebreakerEnabled,
          tiebreakerType,
          incompleteEntryPolicy: "invalid_incomplete",
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        if (data.error === "UNAUTHENTICATED") {
          router.push(`/login?callbackUrl=${encodeURIComponent(returnTo)}`)
          return
        }
        if (data.error === "AGE_REQUIRED") {
          setShowAgeConfirm(true)
          return
        }
        if (data.error === "VERIFICATION_REQUIRED") {
          router.push(`/verify?error=VERIFICATION_REQUIRED&returnTo=${encodeURIComponent(returnTo)}`)
          return
        }
        setError(data.error ?? "Failed to create pool")
        return
      }
      router.push(`/brackets/leagues/${data.leagueId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  async function createPool(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    await submitPool()
  }

  return (
    <div className="mode-surface mode-readable min-h-screen">
      <div className="p-4 sm:p-6 max-w-lg mx-auto">
        <button
          onClick={() => router.back()}
          className="mode-muted mb-8 flex items-center gap-2 text-sm transition"
          data-testid="bracket-create-back-button"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <h1 className="text-xl font-bold text-center mb-2">Create Bracket Pool</h1>
        <p className="text-center text-xs mb-8 mode-muted">
          Build {indefiniteArticleFor(sportLabel)} {sportLabel}{" "}
          {challengeType === "playoff_challenge" ? "Playoff Challenge" : "Classic NCAA"} pool.
        </p>

        <form onSubmit={createPool} className="space-y-6 pb-24 sm:pb-0" data-testid="bracket-create-form">
          <div>
            <label className="text-xs font-semibold" style={{ color: "var(--accent)" }}>Pool Name</label>
            <input
              className="mt-2 w-full bg-transparent border-b-2 pb-2 text-lg outline-none transition"
              style={{ borderColor: "var(--accent)", color: "var(--text)" }}
              placeholder="Madness"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
              autoFocus
              data-testid="bracket-create-name-input"
            />
          </div>

          <div className="mode-panel-soft rounded-xl p-3.5 space-y-3">
            <label className="text-xs font-semibold" style={{ color: "var(--accent)" }}>
              Sport
            </label>
            <div className="grid grid-cols-2 gap-2">
              {SUPPORTED_SPORTS.map((sportOption) => {
                const active = sport === sportOption
                return (
                  <button
                    key={sportOption}
                    type="button"
                    onClick={() => {
                      if (sportOption === "SOCCER") {
                        // Soccer pools live in the World Cup product — route there instead of creating a legacy BracketLeague row.
                        router.push("/brackets/world-cup/create")
                        return
                      }
                      setSport(sportOption)
                    }}
                    disabled={loading}
                    className="rounded-lg px-3 py-2 text-xs font-semibold text-left transition"
                    style={{
                      background: active
                        ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                        : "color-mix(in srgb, var(--panel2) 86%, transparent)",
                      border: `1px solid ${active ? "color-mix(in srgb, var(--accent) 45%, transparent)" : "var(--border)"}`,
                      color: active ? "var(--text)" : "var(--muted)",
                    }}
                    data-testid={`bracket-create-sport-${sportOption}`}
                  >
                    {SPORT_LABELS[sportOption] ?? sportOption}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mode-panel-soft rounded-xl p-3.5 space-y-2.5">
            <label className="text-xs font-semibold" style={{ color: "var(--accent)" }}>
              Challenge Type
            </label>
            {CHALLENGE_TYPE_OPTIONS.map((opt) => {
              const disabled = opt.id === "mens_ncaa" && sport !== "NCAAB"
              const active = challengeType === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => !disabled && setChallengeType(opt.id)}
                  disabled={disabled || loading}
                  className="w-full rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-45"
                  style={{
                    borderColor: active
                      ? "color-mix(in srgb, var(--accent) 45%, transparent)"
                      : "var(--border)",
                    background: active
                      ? "color-mix(in srgb, var(--accent) 10%, transparent)"
                      : "color-mix(in srgb, var(--panel2) 88%, transparent)",
                  }}
                  data-testid={`bracket-create-challenge-type-${opt.id}`}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {opt.id === "playoff_challenge" ? <Goal className="h-4 w-4" /> : <Trophy className="h-4 w-4" />}
                    <span>{opt.label}</span>
                  </div>
                  <p className="mt-1 text-[11px] mode-muted">{opt.description}</p>
                </button>
              )
            })}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold" style={{ color: "var(--accent)" }}>Tournament Year</label>
              <input
                type="number"
                min={2024}
                max={defaultSeason + 1}
                className="mt-2 w-full rounded-lg border px-3 py-2 text-sm bg-transparent"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
                value={season}
                onChange={(e) => setSeason(Number(e.target.value) || defaultSeason)}
                disabled={loading}
                data-testid="bracket-create-season-input"
              />
            </div>

            <div>
              <label className="text-xs font-semibold" style={{ color: "var(--accent)" }}>Scoring System</label>
              <select
                className="mt-2 w-full rounded-lg px-3 py-2 text-sm"
                style={{ border: "1px solid var(--border)", background: "color-mix(in srgb, var(--panel2) 88%, transparent)", color: "var(--text)" }}
                value={scoringMode}
                onChange={(e) => setScoringMode(e.target.value)}
                disabled={loading}
                data-testid="bracket-create-scoring-select"
              >
                {SCORING_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-xl p-3 text-xs" style={{ background: "color-mix(in srgb, var(--panel2) 90%, transparent)", border: "1px solid var(--border)" }}>
            <div className="font-semibold mb-1">Scoring preview</div>
            <div className="mode-muted">{scoringSummary}</div>
          </div>

          <div>
            <label className="text-xs font-semibold" style={{ color: "var(--accent)" }}>Pool Visibility</label>
            <div className="flex gap-3 mt-3">
              <button
                type="button"
                onClick={() => setIsPublic(false)}
                className="flex-1 flex items-center gap-3 rounded-xl p-3.5 transition"
                style={{
                  background: !isPublic ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'color-mix(in srgb, var(--panel2) 84%, transparent)',
                  border: `1.5px solid ${!isPublic ? "color-mix(in srgb, var(--accent) 38%, transparent)" : "var(--border)"}`,
                }}
                data-testid="bracket-create-visibility-private"
              >
                <Lock className="w-5 h-5 flex-shrink-0" style={{ color: !isPublic ? "var(--accent)" : "var(--muted2)" }} />
                <div className="text-left">
                  <div className="text-sm font-semibold" style={{ color: !isPublic ? "var(--text)" : "var(--muted)" }}>Private</div>
                  <div className="text-[10px] mt-0.5" style={{ color: !isPublic ? "var(--muted)" : "var(--muted2)" }}>
                    Invite only via code
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setIsPublic(true)}
                className="flex-1 flex items-center gap-3 rounded-xl p-3.5 transition"
                style={{
                  background: isPublic ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'color-mix(in srgb, var(--panel2) 84%, transparent)',
                  border: `1.5px solid ${isPublic ? "color-mix(in srgb, var(--accent) 38%, transparent)" : "var(--border)"}`,
                }}
                data-testid="bracket-create-visibility-public"
              >
                <Globe className="w-5 h-5 flex-shrink-0" style={{ color: isPublic ? "var(--accent)" : "var(--muted2)" }} />
                <div className="text-left">
                  <div className="text-sm font-semibold" style={{ color: isPublic ? "var(--text)" : "var(--muted)" }}>Public</div>
                  <div className="text-[10px] mt-0.5" style={{ color: isPublic ? "var(--muted)" : "var(--muted2)" }}>
                    Anyone can find & join
                  </div>
                </div>
              </button>
            </div>
          </div>

          <div className="mode-panel-soft rounded-xl p-3.5">
            <label className="text-xs font-semibold" style={{ color: "var(--accent)" }}>Max Users</label>
            <input
              type="number"
              min={2}
              max={500}
              className="mt-2 w-full rounded-lg border px-3 py-2 text-sm bg-transparent"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
              value={maxUsers}
              onChange={(e) => setMaxUsers(Number(e.target.value) || 50)}
              disabled={loading}
              data-testid="bracket-create-max-users-input"
            />
          </div>

          <div className="mode-panel-soft rounded-xl p-3.5">
            <label className="text-xs font-semibold" style={{ color: "var(--accent)" }}>Lock Rule</label>
            <select
              className="mt-2 w-full rounded-lg px-3 py-2 text-sm"
              style={{ border: "1px solid var(--border)", background: "color-mix(in srgb, var(--panel2) 88%, transparent)", color: "var(--text)" }}
              value={lockRule}
              onChange={(e) => setLockRule(e.target.value)}
              disabled={loading}
              data-testid="bracket-create-lock-rule-select"
            >
              <option value="series_start">Lock each series at start</option>
              <option value="pool_start">Lock all picks at pool start</option>
              <option value="none">No lock / test late picks</option>
            </select>
            <p className="mt-2 text-[11px] mode-muted">
              No-lock mode is for commissioner testing and late-pick pools. Standard pools should keep series start locks.
            </p>
          </div>

          <div className="mode-panel-soft rounded-xl p-3.5">
            <label className="text-xs font-semibold" style={{ color: "var(--accent)" }}>Entries Per User</label>
            <div className="mt-2 flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={10}
                value={maxEntriesPerUser}
                onChange={(e) => setMaxEntriesPerUser(Number(e.target.value))}
                disabled={loading}
                className="w-full"
                data-testid="bracket-create-max-entries-slider"
              />
              <span className="w-8 text-sm font-semibold mode-text">{maxEntriesPerUser}</span>
            </div>
          </div>

          <details
            className="mode-panel-soft rounded-xl p-3.5"
            data-testid="af-commissioner-options"
          >
            <summary className="cursor-pointer text-sm font-bold mode-text">
              AF Commissioner Options {isAfCommissioner ? "" : "(Locked Preview)"}
            </summary>
            <p className="mt-2 text-xs mode-muted">
              Premium controls are prepared for pool setup. AI tools flag issues for commissioner review only; they do not accuse, punish, remove, or ban users.
            </p>
            <div className="mt-3 grid gap-2 text-xs mode-muted">
              {[
                "Include NBA Play-In Tournament",
                "Exact series score picks",
                "Series length bonus",
                "Upset bonus",
                "Spread prediction",
                "Over/Under prediction",
                "Custom scoring values",
                "AI Anti-Collusion Monitor",
                "Duplicate Entry Detection",
                "AI Pool Health Report",
                "AI Scoring Explainer",
                "AI Dispute Assistant",
                "AI Bracket Integrity Check",
                "Auto-remind incomplete brackets",
                "Auto-lock entries at deadline",
                "Auto-recalculate after provider sync",
                "Auto-post scoring updates (requires chat)",
                "Hide picks until lock",
                "Approval required to join",
                "Password-protected pool",
                "Co-commissioners",
                "Custom pool logo and banner",
                "Export leaderboard and picks CSV",
              ].map((label) => (
                <label key={label} className="flex items-center gap-2 rounded-lg border px-2 py-1.5" style={{ borderColor: "var(--border)" }}>
                  <input type="checkbox" disabled={!isAfCommissioner || loading} data-testid={`af-commissioner-option-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            {!isAfCommissioner ? (
              <a
                href="/pricing"
                className="mt-3 inline-flex rounded-lg border px-3 py-2 text-xs font-semibold"
                style={{ borderColor: "var(--border)", color: "var(--accent)" }}
                data-testid="af-commissioner-upgrade-link"
              >
                Upgrade to AF Commissioner
              </a>
            ) : null}
          </details>

          <div className="mode-panel-soft rounded-xl p-3.5">
            <label className="text-xs font-semibold" style={{ color: "var(--accent)" }}>Tiebreaker</label>
            <div className="mt-2 space-y-2">
              <label className="flex items-center gap-2 text-sm mode-muted">
                <input
                  type="checkbox"
                  checked={tiebreakerEnabled}
                  onChange={(e) => setTiebreakerEnabled(e.target.checked)}
                  disabled={loading}
                  data-testid="bracket-create-tiebreak-toggle"
                />
                Enable championship total points tiebreaker
              </label>
              <select
                disabled={!tiebreakerEnabled || loading}
                value={tiebreakerType}
                onChange={(e) => setTiebreakerType(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm mode-text" style={{ border: "1px solid var(--border)", background: "color-mix(in srgb, var(--panel2) 88%, transparent)" }}
                data-testid="bracket-create-tiebreak-type-select"
              >
                <option value="championship_total_points">Championship Total Points</option>
              </select>
            </div>
          </div>

          <CommissionerFanCredSetupNotice dataTestId="bracket-create-paid-boundary-copy" />

          {showAgeConfirm && (
            <div className="rounded-xl p-4 space-y-3" style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)", border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}>
              <p className="mode-muted text-sm">
                You must confirm you are 18 or older to create a bracket pool.
              </p>
              <button
                type="button"
                onClick={handleConfirmAge}
                disabled={ageConfirming}
                className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-50 transition"
                style={{ background: "var(--accent)" }}
                data-testid="bracket-create-age-confirm-button"
              >
                {ageConfirming ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Confirming...
                  </span>
                ) : (
                  "I confirm I am 18 or older"
                )}
              </button>
            </div>
          )}

          {error && (
            <div className="rounded-xl p-3 text-sm" style={{ background: 'color-mix(in srgb, var(--accent-red-strong) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red-strong) 38%, transparent)', color: 'var(--accent-red)' }}>
              {error}
            </div>
          )}

          <div className="fixed bottom-0 left-0 right-0 p-4 sm:static sm:p-0">
            <button
              type="submit"
              disabled={!name.trim() || loading}
              className="w-full rounded-xl px-4 py-3.5 text-sm font-bold uppercase tracking-wider text-black disabled:opacity-40 transition"
              style={{ background: "var(--accent)" }}
              data-testid="bracket-create-submit-button"
            >
              {loading ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </span>
              ) : (
                "Create Pool"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

