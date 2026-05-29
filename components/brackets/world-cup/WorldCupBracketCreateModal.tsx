"use client"
import { useMemo, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle, Info, Loader2, Lock, Trophy, Users } from "lucide-react"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"

const WC_LOGO_SRC = "/images/brackets/world-cup/af-world-cup-logo.png"

const MAX_USERS = 100
const MAX_ENTRIES = 5
const allowCreateWithTestFixtures = process.env.NEXT_PUBLIC_WORLD_CUP_ALLOW_CREATE_TEST_FIXTURES === "true"

export default function WorldCupBracketCreateModal() {
  const router = useRouter()
  // Hydration-safe: the active locale flows from the global
  // LanguageProviderClient which itself reads from <html data-lang>
  // (set by the server-side init script). useOptionalLanguage falls
  // back to the default value when no provider is mounted (test isolation),
  // so this never throws.
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])

  const [name, setName] = useState(() => t("wc.create.poolName.default"))
  const [visibility, setVisibility] = useState<"private" | "public">("private")
  const [lockStrategy, setLockStrategy] = useState<"per_match" | "tournament_start">("tournament_start")
  const [includeThirdPlace, setIncludeThirdPlace] = useState(false)
  const [seedTestFixtures, setSeedTestFixtures] = useState(false)
  const [maxUsers, setMaxUsers] = useState(MAX_USERS)
  const [maxEntries, setMaxEntries] = useState(MAX_ENTRIES)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<"idle" | "creating" | "opening">("idle")
  const [error, setError] = useState<string | null>(null)

  // Client-side validation
  const nameError = !name.trim() ? t("wc.create.poolName.error.blank") : null
  const maxUsersError =
    maxUsers < 2 || maxUsers > MAX_USERS
      ? t("wc.create.maxUsers.error", { max: MAX_USERS })
      : null
  const maxEntriesError =
    maxEntries < 1 || maxEntries > MAX_ENTRIES
      ? t("wc.create.maxEntries.error", { max: MAX_ENTRIES })
      : null
  const hasErrors = Boolean(nameError || maxUsersError || maxEntriesError)
  const lockRuleCopy =
    lockStrategy === "tournament_start"
      ? t("wc.create.lockRule.copyTournament")
      : t("wc.create.lockRule.copyPerMatch")

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (hasErrors) return
    setError(null)
    setLoading(true)
    setStatus("creating")

    try {
      const res = await fetch("/api/brackets/world-cup/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          seasonYear: 2026,
          visibility,
          pickLockStrategy: lockStrategy,
          includeThirdPlace,
          maxParticipants: maxUsers,
          maxEntriesPerParticipant: maxEntries,
          isTestMode: allowCreateWithTestFixtures && seedTestFixtures,
          seedTestFixtures: allowCreateWithTestFixtures && seedTestFixtures,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        const loginHref = `/login?callbackUrl=${encodeURIComponent("/brackets/world-cup/create")}`
        router.push(loginHref)
        if (typeof window !== "undefined") {
          window.setTimeout(() => {
            window.location.assign(loginHref)
          }, 0)
        }
        return
      }
      if (!res.ok) {
        throw new Error(
          data?.error ?? t("wc.create.error.requestFailed", { status: res.status })
        )
      }

      const createdId =
        data?.challengeId ??
        data?.id ??
        data?.challenge?.id ??
        (data?.challenge as any)?.challengeId

      if (!createdId) {
        throw new Error(t("wc.create.error.noId"))
      }

      setStatus("opening")
      router.push(`/brackets/world-cup/${createdId}${allowCreateWithTestFixtures && seedTestFixtures ? "?guided=1" : ""}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wc.create.error.generic"))
      setStatus("idle")
    } finally {
      setLoading(false)
    }
  }

  const submitLabel =
    status === "creating"
      ? t("wc.create.submit.creating")
      : status === "opening"
        ? t("wc.create.submit.opening")
        : t("wc.create.submit.idle")

  return (
    // `mode-readable` opts the create modal into the globals.css light-mode
    // rescue layer so muted form helpers and validation hints stay readable.
    <div data-wc-dark className="mode-readable fixed inset-0 z-50 flex flex-col bg-[#05070b] text-white">
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-white/10 bg-white/[0.04] p-2"
          aria-label={t("wc.create.goBack")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-black">{t("wc.create.header")}</h1>
          <p className="text-xs text-white/45">{t("wc.create.subheader")}</p>
        </div>
      </header>

      <main className="overflow-y-auto">
        <div className="mx-auto w-full max-w-xl px-3 py-4 pb-28 sm:px-4 sm:py-8 sm:pb-8">
          <form onSubmit={submit} className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] shadow-2xl shadow-black/40">
            {/* Title block */}
            <div className="flex items-center gap-3 border-b border-white/[0.08] bg-white/[0.02] px-4 py-4 sm:px-6">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-300/35 bg-cyan-300/10 p-1">
                <Image
                  src={WC_LOGO_SRC}
                  alt="AllFantasy World Cup"
                  width={44}
                  height={44}
                  className="h-full w-full object-contain"
                />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-black text-white">{t("wc.create.heroTitle")}</div>
                <div className="text-xs text-white/45">{t("wc.create.heroSubtitle")}</div>
              </div>
            </div>

            <div className="space-y-5 p-4 sm:p-6">

            {/* Pool name */}
            <div>
              <label className="block text-xs font-black uppercase tracking-[0.16em] text-white/45">
                {t("wc.create.poolName.label")}
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-3 text-sm font-bold text-white outline-none focus:border-cyan-300/60"
                required
                maxLength={80}
                placeholder={t("wc.create.poolName.placeholder")}
              />
              {nameError && <p className="mt-1 text-[11px] text-white/70">{nameError}</p>}
            </div>

            <div className="border-t border-white/[0.06]" />

            {/* Privacy */}
            <div>
              <label className="block text-xs font-black uppercase tracking-[0.16em] text-white/45">
                {t("wc.create.visibility.label")}
              </label>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setVisibility("private")}
                  className={`rounded-lg border p-3 text-left transition-colors ${visibility === "private" ? "border-cyan-300/60 bg-cyan-300/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"}`}
                >
                  <div className="flex items-center gap-1.5 text-sm font-black">
                    <Lock className="h-3.5 w-3.5" />
                    {t("wc.create.visibility.private")}
                  </div>
                  <div className="mt-0.5 text-xs text-white/45">{t("wc.create.visibility.privateHint")}</div>
                </button>
                <button
                  type="button"
                  onClick={() => setVisibility("public")}
                  className={`rounded-lg border p-3 text-left transition-colors ${visibility === "public" ? "border-cyan-300/60 bg-cyan-300/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"}`}
                >
                  <div className="flex items-center gap-1.5 text-sm font-black">
                    <Users className="h-3.5 w-3.5" />
                    {t("wc.create.visibility.public")}
                  </div>
                  <div className="mt-0.5 text-xs text-white/45">{t("wc.create.visibility.publicHint")}</div>
                </button>
              </div>
            </div>

            <div className="border-t border-white/[0.06]" />

            {/* Max users + max entries */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-black uppercase tracking-[0.16em] text-white/45">
                  {t("wc.create.maxUsers.label")}
                </label>
                <input
                  type="number"
                  min={2}
                  max={MAX_USERS}
                  value={maxUsers}
                  onChange={(e) => setMaxUsers(Math.min(MAX_USERS, Math.max(1, Number(e.target.value))))}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm font-bold text-white outline-none focus:border-cyan-300/60"
                />
                {maxUsersError
                  ? <p className="mt-1 text-[11px] text-white/70">{maxUsersError}</p>
                  : <p className="mt-1 text-[11px] text-white/35">{t("wc.create.maxUsers.hint", { max: MAX_USERS })}</p>}
              </div>
              <div>
                <label className="block text-xs font-black uppercase tracking-[0.16em] text-white/45">
                  {t("wc.create.maxEntries.label")}
                </label>
                <input
                  type="number"
                  min={1}
                  max={MAX_ENTRIES}
                  value={maxEntries}
                  onChange={(e) => setMaxEntries(Math.min(MAX_ENTRIES, Math.max(1, Number(e.target.value))))}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm font-bold text-white outline-none focus:border-cyan-300/60"
                />
                {maxEntriesError
                  ? <p className="mt-1 text-[11px] text-white/70">{maxEntriesError}</p>
                  : <p className="mt-1 text-[11px] text-white/35">{t("wc.create.maxEntries.hint", { max: MAX_ENTRIES })}</p>}
              </div>
            </div>

            <div className="border-t border-white/[0.06]" />

            {/* Lock rule */}
            <div>
              <label className="block text-xs font-black uppercase tracking-[0.16em] text-white/45">
                {t("wc.create.lockRule.label")}
              </label>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setLockStrategy("tournament_start")}
                  className={`rounded-lg border p-3 text-left transition-colors ${lockStrategy === "tournament_start" ? "border-cyan-300/60 bg-cyan-300/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"}`}
                >
                  <div className="text-sm font-black">{t("wc.create.lockRule.tournament")}</div>
                  <div className="mt-0.5 text-xs text-white/45">{t("wc.create.lockRule.tournamentHint")}</div>
                </button>
                <button
                  type="button"
                  onClick={() => setLockStrategy("per_match")}
                  className={`rounded-lg border p-3 text-left transition-colors ${lockStrategy === "per_match" ? "border-cyan-300/60 bg-cyan-300/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"}`}
                >
                  <div className="text-sm font-black">{t("wc.create.lockRule.perMatch")}</div>
                  <div className="mt-0.5 text-xs text-white/45">{t("wc.create.lockRule.perMatchHint")}</div>
                </button>
              </div>
            </div>

            {/* Scoring profile info */}
            <div className="flex items-start gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-3">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/50" />
              <div className="text-xs text-white/45">
                <span className="font-bold text-white/60">{t("wc.create.scoring.intro")}</span> {t("wc.create.scoring.values")}
              </div>
            </div>

            {/* Helper notes */}
            <ul className="space-y-1 text-[11px] text-white/40">
              <li>• {t(
                maxEntries === 1
                  ? "wc.create.helper.entriesOne"
                  : "wc.create.helper.entriesOther",
                { max: maxEntries }
              )}</li>
              <li>• {lockRuleCopy}</li>
              <li>• {t("wc.create.helper.leaderboard")}</li>
              {visibility === "private" && (
                <li>• {t("wc.create.helper.inviteLink")}</li>
              )}
            </ul>

            {/* Third-place */}
            <label className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm font-bold text-white/75">
              <input
                type="checkbox"
                checked={includeThirdPlace}
                onChange={(e) => setIncludeThirdPlace(e.target.checked)}
                className="h-4 w-4 rounded"
              />
              {t("wc.create.thirdPlace")}
            </label>

            {allowCreateWithTestFixtures && (
              <label className="flex items-start gap-3 rounded-lg border border-amber-300/20 bg-amber-500/[0.06] p-3 text-sm font-bold text-white/80">
                <input
                  type="checkbox"
                  checked={seedTestFixtures}
                  onChange={(e) => setSeedTestFixtures(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded"
                />
                <span>
                  <span className="block">{t("wc.create.testFixtures.label")}</span>
                  <span className="mt-0.5 block text-[11px] font-medium leading-5 text-white/80/70">
                    {t("wc.create.testFixtures.hint")}
                  </span>
                </span>
              </label>
            )}

            {status === "opening" && !error && (
              <div className="flex items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/10 p-3 text-sm text-white/90">
                <CheckCircle className="h-4 w-4 shrink-0" />
                {t("wc.create.openingSuccess")}
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-rose-400/25 bg-rose-400/10 p-3 text-sm text-white/85">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || hasErrors}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3.5 text-sm font-black text-black shadow-lg shadow-cyan-300/20 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />}
              {submitLabel}
            </button>

            </div>{/* end inner padding div */}
          </form>
        </div>
      </main>
    </div>
  )
}
