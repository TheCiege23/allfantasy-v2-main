"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, Lock, Save } from "lucide-react"
import { toast } from "sonner"
import { DEFAULT_WORLD_CUP_SCORING } from "@/lib/world-cup/worldCupBracketBuilder"

type BundleChallenge = {
  id: string
  name: string
  visibility: "public" | "private"
  inviteCode: string
  maxParticipants: number
  maxEntriesPerParticipant: number
  includeThirdPlace: boolean
}

type BundleScoring = {
  roundOf32Points: number
  roundOf16Points: number
  quarterFinalPoints: number
  semiFinalPoints: number
  finalPoints: number
  championBonusPoints: number
  thirdPlacePoints: number | null
}

type BundleLeague = {
  scoringStyle?: "standard" | "custom"
  tiebreakerFinalScore?: boolean
  allowLateJoin?: boolean
  showPublicPicks?: "after_lock" | "never" | "always"
  bracketBrainEnabled?: boolean
  inviteGateConfigured?: boolean
}

type BundleCommissioner = {
  enableSystemEvents: boolean
  enableUpsetAlerts: boolean
  enableLeaderboardAlerts: boolean
  enableChampionBustAlerts: boolean
  enableLockReminders: boolean
  enableAiSummaries: boolean
}

type LoadedPayload = {
  challenge: BundleChallenge
  scoring: BundleScoring
  leagueSettings: BundleLeague
  commissioner: BundleCommissioner
  hasAfPro: boolean
  isAdmin: boolean
  earlyPublicPicksAllowed: boolean
}

function AfProGateCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-cyan-400/20 bg-gradient-to-br from-cyan-400/10 to-transparent p-4">
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200/90" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-white">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-white/55">{body}</p>
          <Link
            href="/pricing"
            className="mt-3 inline-flex rounded-lg bg-cyan-300 px-4 py-2 text-xs font-black text-black"
          >
            Upgrade to AF Pro
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function WorldCupBracketSettingsPanel({
  challengeId,
  onSaved,
}: {
  challengeId: string
  onSaved?: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [payload, setPayload] = useState<LoadedPayload | null>(null)

  const [name, setName] = useState("")
  const [visibility, setVisibility] = useState<"public" | "private">("private")
  const [maxParticipants, setMaxParticipants] = useState(100)
  const [maxEntriesPerParticipant, setMaxEntriesPerParticipant] = useState(5)
  const [includeThirdPlace, setIncludeThirdPlace] = useState(false)

  const [scoringStyle, setScoringStyle] = useState<"standard" | "custom">("standard")
  const [roundOf32Points, setRoundOf32Points] = useState(DEFAULT_WORLD_CUP_SCORING.roundOf32Points)
  const [roundOf16Points, setRoundOf16Points] = useState(DEFAULT_WORLD_CUP_SCORING.roundOf16Points)
  const [quarterFinalPoints, setQuarterFinalPoints] = useState(DEFAULT_WORLD_CUP_SCORING.quarterFinalPoints)
  const [semiFinalPoints, setSemiFinalPoints] = useState(DEFAULT_WORLD_CUP_SCORING.semiFinalPoints)
  const [finalPoints, setFinalPoints] = useState(DEFAULT_WORLD_CUP_SCORING.finalPoints)
  const [championBonusPoints, setChampionBonusPoints] = useState(DEFAULT_WORLD_CUP_SCORING.championBonusPoints)
  const [thirdPlacePoints, setThirdPlacePoints] = useState(DEFAULT_WORLD_CUP_SCORING.thirdPlacePoints)

  const [tiebreakerFinalScore, setTiebreakerFinalScore] = useState(false)
  const [allowLateJoin, setAllowLateJoin] = useState(false)
  const [showPublicPicks, setShowPublicPicks] = useState<"after_lock" | "never" | "always">("after_lock")

  const [bracketBrainEnabled, setBracketBrainEnabled] = useState(true)
  const [joinPasswordInput, setJoinPasswordInput] = useState("")
  const [joinPasswordTouched, setJoinPasswordTouched] = useState(false)

  const [enableSystemEvents, setEnableSystemEvents] = useState(true)
  const [enableUpsetAlerts, setEnableUpsetAlerts] = useState(true)
  const [enableLeaderboardAlerts, setEnableLeaderboardAlerts] = useState(true)
  const [enableChampionBustAlerts, setEnableChampionBustAlerts] = useState(true)
  const [enableLockReminders, setEnableLockReminders] = useState(true)
  const [enableAiSummaries, setEnableAiSummaries] = useState(false)

  const hydrate = useCallback((p: LoadedPayload) => {
    setPayload(p)
    const c = p.challenge
    const s = p.scoring
    const l = p.leagueSettings
    const cm = p.commissioner

    setName(c.name)
    setVisibility(c.visibility)
    setMaxParticipants(c.maxParticipants)
    setMaxEntriesPerParticipant(c.maxEntriesPerParticipant)
    setIncludeThirdPlace(c.includeThirdPlace)

    setScoringStyle(l.scoringStyle ?? "standard")
    setRoundOf32Points(s.roundOf32Points)
    setRoundOf16Points(s.roundOf16Points)
    setQuarterFinalPoints(s.quarterFinalPoints)
    setSemiFinalPoints(s.semiFinalPoints)
    setFinalPoints(s.finalPoints)
    setChampionBonusPoints(s.championBonusPoints)
    setThirdPlacePoints(s.thirdPlacePoints ?? DEFAULT_WORLD_CUP_SCORING.thirdPlacePoints)

    setTiebreakerFinalScore(l.tiebreakerFinalScore ?? false)
    setAllowLateJoin(l.allowLateJoin ?? false)
    setShowPublicPicks(l.showPublicPicks ?? "after_lock")
    setBracketBrainEnabled(l.bracketBrainEnabled !== false)

    setJoinPasswordInput("")
    setJoinPasswordTouched(false)

    setEnableSystemEvents(cm.enableSystemEvents)
    setEnableUpsetAlerts(cm.enableUpsetAlerts)
    setEnableLeaderboardAlerts(cm.enableLeaderboardAlerts)
    setEnableChampionBustAlerts(cm.enableChampionBustAlerts)
    setEnableLockReminders(cm.enableLockReminders)
    setEnableAiSummaries(cm.enableAiSummaries)
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/brackets/world-cup/${challengeId}/settings`, { cache: "no-store" })
      const data = (await res.json().catch(() => ({}))) as LoadedPayload & { error?: string }
      if (!res.ok) {
        toast.error(data.error || "Could not load settings")
        return
      }
      hydrate(data)
    } finally {
      setLoading(false)
    }
  }, [challengeId, hydrate])

  useEffect(() => {
    void reload()
  }, [reload])

  const previewScoring = useMemo(() => {
    if (scoringStyle === "standard") return DEFAULT_WORLD_CUP_SCORING
    return {
      roundOf32Points,
      roundOf16Points,
      quarterFinalPoints,
      semiFinalPoints,
      finalPoints,
      championBonusPoints,
      thirdPlacePoints,
    }
  }, [
    scoringStyle,
    roundOf32Points,
    roundOf16Points,
    quarterFinalPoints,
    semiFinalPoints,
    finalPoints,
    championBonusPoints,
    thirdPlacePoints,
  ])

  const clientValidationError = useMemo(() => {
    if (maxParticipants < 1 || maxParticipants > 100) return "Max users must be between 1 and 100."
    if (maxEntriesPerParticipant < 1 || maxEntriesPerParticipant > 5) {
      return "Max brackets per user must be between 1 and 5."
    }
    if (scoringStyle === "custom") {
      const nums = [
        roundOf32Points,
        roundOf16Points,
        quarterFinalPoints,
        semiFinalPoints,
        finalPoints,
        championBonusPoints,
      ]
      if (nums.some((n) => !Number.isFinite(n) || n <= 0)) {
        return "Custom scoring values must be positive numbers."
      }
      if (includeThirdPlace && (!Number.isFinite(thirdPlacePoints) || thirdPlacePoints <= 0)) {
        return "Third-place points must be a positive number."
      }
    }
    return null
  }, [
    maxParticipants,
    maxEntriesPerParticipant,
    scoringStyle,
    roundOf32Points,
    roundOf16Points,
    quarterFinalPoints,
    semiFinalPoints,
    finalPoints,
    championBonusPoints,
    thirdPlacePoints,
    includeThirdPlace,
  ])

  async function handleSave() {
    if (!payload) return
    const err = clientValidationError
    if (err) {
      toast.error(err)
      return
    }
    if (
      showPublicPicks === "always" &&
      !payload.isAdmin &&
      !payload.earlyPublicPicksAllowed
    ) {
      toast.error(
        "Showing everyone’s picks before lock requires platform approval. Choose “After lock” or contact support."
      )
      return
    }

    const patch: Record<string, unknown> = {}

    if (name.trim() !== payload.challenge.name) patch.name = name.trim()
    if (visibility !== payload.challenge.visibility) patch.visibility = visibility
    if (maxParticipants !== payload.challenge.maxParticipants) patch.maxParticipants = maxParticipants
    if (maxEntriesPerParticipant !== payload.challenge.maxEntriesPerParticipant) {
      patch.maxEntriesPerParticipant = maxEntriesPerParticipant
    }
    if (includeThirdPlace !== payload.challenge.includeThirdPlace) {
      patch.includeThirdPlace = includeThirdPlace
    }

    if (scoringStyle !== (payload.leagueSettings.scoringStyle ?? "standard")) {
      patch.scoringStyle = scoringStyle
    }
    if (tiebreakerFinalScore !== (payload.leagueSettings.tiebreakerFinalScore ?? false)) {
      patch.tiebreakerFinalScore = tiebreakerFinalScore
    }
    if (allowLateJoin !== (payload.leagueSettings.allowLateJoin ?? false)) {
      patch.allowLateJoin = allowLateJoin
    }
    if (showPublicPicks !== (payload.leagueSettings.showPublicPicks ?? "after_lock")) {
      patch.showPublicPicks = showPublicPicks
    }
    if (bracketBrainEnabled !== (payload.leagueSettings.bracketBrainEnabled !== false)) {
      patch.bracketBrainEnabled = bracketBrainEnabled
    }

    if (joinPasswordTouched) {
      patch.joinPassword = joinPasswordInput.trim() === "" ? "" : joinPasswordInput
    }

    if (scoringStyle === "custom") {
      const prev = payload.scoring
      const nextRound = {
        roundOf32Points,
        roundOf16Points,
        quarterFinalPoints,
        semiFinalPoints,
        finalPoints,
        championBonusPoints,
        thirdPlacePoints: includeThirdPlace ? thirdPlacePoints : null,
      }
      const scoringPatch: Record<string, number | null> = {}
      if (nextRound.roundOf32Points !== prev.roundOf32Points) scoringPatch.roundOf32Points = nextRound.roundOf32Points
      if (nextRound.roundOf16Points !== prev.roundOf16Points) scoringPatch.roundOf16Points = nextRound.roundOf16Points
      if (nextRound.quarterFinalPoints !== prev.quarterFinalPoints) {
        scoringPatch.quarterFinalPoints = nextRound.quarterFinalPoints
      }
      if (nextRound.semiFinalPoints !== prev.semiFinalPoints) scoringPatch.semiFinalPoints = nextRound.semiFinalPoints
      if (nextRound.finalPoints !== prev.finalPoints) scoringPatch.finalPoints = nextRound.finalPoints
      if (nextRound.championBonusPoints !== prev.championBonusPoints) {
        scoringPatch.championBonusPoints = nextRound.championBonusPoints
      }
      const prevThird = prev.thirdPlacePoints ?? null
      const nextThird = includeThirdPlace ? thirdPlacePoints : null
      if (prevThird !== nextThird) scoringPatch.thirdPlacePoints = nextThird
      if (Object.keys(scoringPatch).length > 0) patch.scoring = scoringPatch
    }

    const cmPatch: Record<string, boolean> = {}
    if (enableSystemEvents !== payload.commissioner.enableSystemEvents) {
      cmPatch.enableSystemEvents = enableSystemEvents
    }
    if (enableUpsetAlerts !== payload.commissioner.enableUpsetAlerts) {
      cmPatch.enableUpsetAlerts = enableUpsetAlerts
    }
    if (enableLeaderboardAlerts !== payload.commissioner.enableLeaderboardAlerts) {
      cmPatch.enableLeaderboardAlerts = enableLeaderboardAlerts
    }
    if (enableChampionBustAlerts !== payload.commissioner.enableChampionBustAlerts) {
      cmPatch.enableChampionBustAlerts = enableChampionBustAlerts
    }
    if (enableLockReminders !== payload.commissioner.enableLockReminders) {
      cmPatch.enableLockReminders = enableLockReminders
    }
    if (enableAiSummaries !== payload.commissioner.enableAiSummaries) {
      cmPatch.enableAiSummaries = enableAiSummaries
    }
    if (Object.keys(cmPatch).length > 0) patch.commissioner = cmPatch

    if (Object.keys(patch).length === 0) {
      toast.message("No changes to save.")
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/brackets/world-cup/${challengeId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error((data as { error?: string }).error || "Could not save settings")
        return
      }
      const next = (data as { settings: Omit<LoadedPayload, "hasAfPro" | "isAdmin" | "earlyPublicPicksAllowed"> }).settings
      if (next) {
        hydrate({
          ...next,
          hasAfPro: (data as { hasAfPro?: boolean }).hasAfPro ?? payload.hasAfPro,
          isAdmin: (data as { isAdmin?: boolean }).isAdmin ?? payload.isAdmin,
          earlyPublicPicksAllowed:
            (data as { earlyPublicPicksAllowed?: boolean }).earlyPublicPicksAllowed ??
            payload.earlyPublicPicksAllowed,
        })
      } else {
        await reload()
      }
      toast.success("Settings saved.")
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  if (loading || !payload) {
    return (
      <div data-testid="world-cup-settings-loading" className="flex items-center gap-2 py-12 text-sm text-white/40">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading league settings…
      </div>
    )
  }

  const hasAfPro = payload.hasAfPro

  return (
    <div data-testid="world-cup-settings-panel" className="space-y-6 px-1 pb-10 sm:px-0">
      <header className="space-y-1">
        <h2 className="text-lg font-black text-white">League settings</h2>
        <p className="text-xs text-white/50">
          Identity, caps, scoring, visibility, and alerts — commissioner controls for your World Cup bracket pool.
        </p>
      </header>

      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-white/45">League identity</h3>
        <label className="mt-3 block text-xs text-white/70">
          League name
          <input
            data-testid="world-cup-settings-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
          />
        </label>
        <label className="mt-3 block text-xs text-white/70">
          Visibility
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as "public" | "private")}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
          >
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-white/70">
            Max users (cap 100)
            <input
              data-testid="world-cup-settings-max-users"
              type="number"
              min={1}
              max={100}
              value={maxParticipants}
              onChange={(e) => setMaxParticipants(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="block text-xs text-white/70">
            Max brackets per user (cap 5)
            <input
              data-testid="world-cup-settings-max-brackets"
              type="number"
              min={1}
              max={5}
              value={maxEntriesPerParticipant}
              onChange={(e) => setMaxEntriesPerParticipant(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            />
          </label>
        </div>
        <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-[11px] text-white/55">
          <span className="font-semibold text-white/70">Invite code</span>
          <div className="mt-1 font-mono text-sm text-cyan-100">{payload.challenge.inviteCode}</div>
        </div>
        <label className="mt-3 block text-xs text-white/70">
          Join password (optional)
          <input
            type="password"
            autoComplete="new-password"
            placeholder={
              payload.leagueSettings.inviteGateConfigured ? "Enter new password or leave blank to remove" : "Set a password"
            }
            value={joinPasswordInput}
            onChange={(e) => {
              setJoinPasswordInput(e.target.value)
              setJoinPasswordTouched(true)
            }}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
          />
          <span className="mt-1 block text-[10px] text-white/40">
            Stored securely — never shown again after save. Leave blank and save to clear.
          </span>
        </label>
      </section>

      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-white/45">Scoring</h3>
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          <label className="inline-flex cursor-pointer items-center gap-2 text-white/75">
            <input
              type="radio"
              name="wc-scoring-style"
              checked={scoringStyle === "standard"}
              onChange={() => setScoringStyle("standard")}
              className="accent-cyan-400"
            />
            Standard
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 text-white/75">
            <input
              type="radio"
              name="wc-scoring-style"
              checked={scoringStyle === "custom"}
              onChange={() => setScoringStyle("custom")}
              className="accent-cyan-400"
            />
            Custom
          </label>
        </div>

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-white/70">
          <input
            type="checkbox"
            checked={includeThirdPlace}
            onChange={(e) => setIncludeThirdPlace(e.target.checked)}
            className="h-4 w-4 accent-cyan-400"
          />
          Include third-place match (and third-place points when custom)
        </label>

        {scoringStyle === "custom" ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Num label="Round of 32" value={roundOf32Points} onChange={setRoundOf32Points} />
            <Num label="Round of 16" value={roundOf16Points} onChange={setRoundOf16Points} />
            <Num label="Quarterfinals" value={quarterFinalPoints} onChange={setQuarterFinalPoints} />
            <Num label="Semifinals" value={semiFinalPoints} onChange={setSemiFinalPoints} />
            <Num label="Final" value={finalPoints} onChange={setFinalPoints} />
            <Num label="Champion bonus" value={championBonusPoints} onChange={setChampionBonusPoints} />
            {includeThirdPlace ? (
              <Num label="Third-place game" value={thirdPlacePoints} onChange={setThirdPlacePoints} />
            ) : null}
          </div>
        ) : null}

        <div
          data-testid="world-cup-settings-scoring-preview"
          className="mt-4 rounded-lg border border-white/[0.06] bg-black/25 p-3"
        >
          <p className="text-[10px] font-bold uppercase tracking-wide text-white/40">Scoring preview</p>
          <ul className="mt-2 space-y-1 text-xs text-white/75">
            <li>Round of 32: {previewScoring.roundOf32Points} pts</li>
            <li>Round of 16: {previewScoring.roundOf16Points} pts</li>
            <li>Quarterfinals: {previewScoring.quarterFinalPoints} pts</li>
            <li>Semifinals: {previewScoring.semiFinalPoints} pts</li>
            <li>Final: {previewScoring.finalPoints} pts</li>
            <li className="font-semibold text-cyan-100/90">Champion bonus: {previewScoring.championBonusPoints} pts</li>
            {includeThirdPlace ? (
              <li>Third-place game: {previewScoring.thirdPlacePoints ?? "—"} pts</li>
            ) : null}
          </ul>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-white/45">Rules & visibility</h3>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-white/75">
          <input
            type="checkbox"
            checked={tiebreakerFinalScore}
            onChange={(e) => setTiebreakerFinalScore(e.target.checked)}
            className="h-4 w-4 accent-cyan-400"
          />
          Tiebreaker: final score prediction
        </label>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-white/75">
          <input
            type="checkbox"
            checked={allowLateJoin}
            onChange={(e) => setAllowLateJoin(e.target.checked)}
            className="h-4 w-4 accent-cyan-400"
          />
          Allow late join after bracket lock (off by default)
        </label>
        <label className="mt-3 block text-xs text-white/70">
          Show public picks
          <select
            data-testid="world-cup-settings-public-picks"
            value={showPublicPicks}
            onChange={(e) =>
              setShowPublicPicks(e.target.value as "after_lock" | "never" | "always")
            }
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
          >
            <option value="after_lock">Only after lock</option>
            <option value="never">Never (private picks)</option>
            <option value="always">Always (before lock)</option>
          </select>
          {!payload.isAdmin && !payload.earlyPublicPicksAllowed ? (
            <span className="mt-1 block text-[10px] text-amber-200/80">
              “Always” requires platform approval unless enabled for your environment.
            </span>
          ) : null}
        </label>
      </section>

      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-white/45">Alerts & reminders</h3>
        <p className="mt-2 text-[11px] text-white/45">
          System events and lock reminders work for every commissioner. AI-powered summaries require AF Pro.
        </p>
        <div className="mt-3 space-y-2">
          <Toggle label="Enable system events" checked={enableSystemEvents} onChange={setEnableSystemEvents} />
          <Toggle label="Upset alerts" checked={enableUpsetAlerts} onChange={setEnableUpsetAlerts} />
          <Toggle label="Leaderboard alerts" checked={enableLeaderboardAlerts} onChange={setEnableLeaderboardAlerts} />
          <Toggle label="Champion bust alerts" checked={enableChampionBustAlerts} onChange={setEnableChampionBustAlerts} />
          <Toggle label="Lock reminders" checked={enableLockReminders} onChange={setEnableLockReminders} />
        </div>

        {!hasAfPro ? (
          <div className="mt-4">
            <AfProGateCard
              title="AI summaries"
              body="Post AI-written recap and hype lines to your league feed when enabled."
            />
          </div>
        ) : (
          <div className="mt-4">
            <Toggle label="AI summaries (AF Pro)" checked={enableAiSummaries} onChange={setEnableAiSummaries} />
          </div>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-white/45">Bracket Brain</h3>
        <p className="mt-2 text-[11px] text-white/45">
          Lets commissioners generate Bracket Brain chat posts from the Commissioner tab. Requires AF Pro to run AI output.
        </p>
        {!hasAfPro ? (
          <div className="mt-3">
            <AfProGateCard
              title="Bracket Brain controls"
              body="Enable league-level Bracket Brain features and tune AI surfaces — upgrade to AF Pro."
            />
          </div>
        ) : (
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-white/75">
            <input
              data-testid="world-cup-settings-bracket-brain"
              type="checkbox"
              checked={bracketBrainEnabled}
              onChange={(e) => setBracketBrainEnabled(e.target.checked)}
              className="h-4 w-4 accent-cyan-400"
            />
            Enable Bracket Brain for this league
          </label>
        )}
      </section>

      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <button
          data-testid="world-cup-settings-save"
          type="button"
          disabled={saving || Boolean(clientValidationError)}
          onClick={() => void handleSave()}
          className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 py-2.5 text-xs font-black text-black transition active:scale-[0.97] disabled:opacity-40 hover:enabled:bg-cyan-200 sm:w-auto sm:min-h-0"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save settings
        </button>
        {clientValidationError ? (
          <span className="text-xs text-rose-200/90">{clientValidationError}</span>
        ) : null}
      </div>
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-xs text-white/75">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-cyan-400"
      />
    </label>
  )
}

function Num({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (n: number) => void
}) {
  return (
    <label className="block text-xs text-white/70">
      {label}
      <input
        type="number"
        min={1}
        step={1}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
      />
    </label>
  )
}
