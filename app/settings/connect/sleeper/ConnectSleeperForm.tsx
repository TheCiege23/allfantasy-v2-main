"use client"

import Link from "next/link"
import { useState } from "react"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"

/**
 * The actual Sleeper linker. The page this replaces was a circular dead-end:
 * it said "link your account by importing a league" while the import pipeline's
 * commissioner gate REQUIRES the link — so a direct signup could never get
 * through. Discovery (/api/leagues/import/discover) both validates the handle
 * against Sleeper and stamps sleeperUserId/sleeperUsername on the profile
 * (first-write-wins), so one submit here unblocks the whole import funnel.
 *
 * 🛑 A 200 FROM DISCOVERY DOES NOT MEAN THE LINK WAS SAVED, and this form used to say "Linked as X …
 * the link is saved either way" on any 200. Discovery lists leagues for any valid handle, but it
 * only WRITES the link when this profile has none yet, and it cannot write one the unique key gives
 * to another login (it then answers `handleLinkedElsewhere: true`). Either way the next import step
 * refused with "Link your Sleeper account" after this form had said it was linked. So the outcome
 * is now read back from the profile, not inferred from the status code.
 */

type CurrentLink = { sleeperUserId: string; sleeperUsername: string | null } | null

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "linked"; displayName: string; leagueCount: number; already: boolean }
  | { kind: "linked-to-other"; current: string }
  | { kind: "handle-elsewhere"; handle: string }
  | { kind: "error"; message: string }

const CONNECTED_ACCOUNTS = "/settings?tab=connected"

/**
 * The page header (back link, title, intro). It lives here rather than in page.tsx because the page
 * is a server component, and the language is only known in the client (LanguageProviderClient).
 */
export function ConnectSleeperIntro() {
  const { t } = useOptionalLanguage()
  return (
    <>
      <Link
        href="/settings"
        className="mb-6 inline-block text-sm text-cyan-400/90 hover:text-cyan-300"
      >
        {t("settings.sleeperConnect.back")}
      </Link>
      <h1 className="text-xl font-bold">{t("settings.connected.connectSleeper")}</h1>
      <p className="mt-3 text-sm leading-relaxed text-white/55">{t("settings.sleeperConnect.intro")}</p>
    </>
  )
}

export default function ConnectSleeperForm({ currentLink = null }: { currentLink?: CurrentLink }) {
  // Optional: the form is rendered on its own in tests, outside any LanguageProviderClient.
  const { t, tInterpolate } = useOptionalLanguage()
  const [username, setUsername] = useState("")
  const [state, setState] = useState<State>({ kind: "idle" })

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const handle = username.trim()
    if (handle.length < 2) {
      setState({ kind: "error", message: t("settings.sleeperConnect.errorEnterUsername") })
      return
    }
    setState({ kind: "loading" })
    try {
      const res = await fetch("/api/leagues/import/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "sleeper", accountIdentifier: handle }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        account?: { displayName?: string; providerUserId?: string; accountIdentifier?: string }
        leagues?: unknown[]
        handleLinkedElsewhere?: boolean
      }
      if (!res.ok) {
        setState({
          kind: "error",
          message:
            typeof data.error === "string" && data.error
              ? data.error
              : t("settings.sleeperConnect.errorUnreachable"),
        })
        return
      }

      const displayName = data.account?.displayName || handle
      if (data.handleLinkedElsewhere) {
        setState({ kind: "handle-elsewhere", handle: data.account?.accountIdentifier || handle })
        return
      }

      // Read the link back: the profile is the only thing that says what discovery actually saved.
      const profileRes = await fetch("/api/user/profile", { cache: "no-store" })
      const profile = (await profileRes.json().catch(() => ({}))) as {
        sleeperUserId?: string | null
        sleeperUsername?: string | null
      }
      const savedId = profileRes.ok ? profile.sleeperUserId ?? null : null
      const foundId = data.account?.providerUserId ?? null

      if (savedId && foundId && savedId === foundId) {
        setState({
          kind: "linked",
          displayName,
          leagueCount: Array.isArray(data.leagues) ? data.leagues.length : 0,
          already: currentLink?.sleeperUserId === foundId,
        })
      } else if (savedId && foundId && savedId !== foundId) {
        setState({
          kind: "linked-to-other",
          current: profile.sleeperUsername || t("settings.sleeperConnect.anotherAccount"),
        })
      } else {
        setState({
          kind: "error",
          message: tInterpolate("settings.sleeperConnect.errorSaveFailed", { name: displayName }),
        })
      }
    } catch {
      setState({ kind: "error", message: t("settings.sleeperConnect.errorGeneric") })
    }
  }

  if (state.kind === "linked") {
    return (
      <div className="mt-6 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-5" role="status">
        <p className="text-sm font-semibold text-emerald-300">
          {tInterpolate(
            state.already ? "settings.sleeperConnect.alreadyLinkedAs" : "settings.sleeperConnect.linkedAs",
            { name: state.displayName },
          )}
        </p>
        <p className="mt-1 text-sm text-white/60">
          {state.leagueCount > 0
            ? tInterpolate(
                state.leagueCount === 1
                  ? "settings.sleeperConnect.foundLeaguesOne"
                  : "settings.sleeperConnect.foundLeaguesMany",
                { count: state.leagueCount },
              )
            : t("settings.sleeperConnect.noLeagues")}
        </p>
        <Link
          href="/import?provider=sleeper"
          className="mt-4 inline-flex min-h-[44px] items-center rounded-xl bg-cyan-500/20 px-4 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/30"
        >
          {t("settings.sleeperConnect.importLeagues")}
        </Link>
      </div>
    )
  }

  // Already linked when the page loaded: say so instead of offering a form that cannot change it.
  if (currentLink && state.kind === "idle") {
    return (
      <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5" data-testid="sleeper-current-link">
        <p className="text-sm font-semibold text-white">
          {currentLink.sleeperUsername
            ? tInterpolate("settings.sleeperConnect.linkedToSleeperAs", { name: currentLink.sleeperUsername })
            : t("settings.sleeperConnect.linkedToSleeper")}
        </p>
        <p className="mt-1 text-sm text-white/60">
          {t("settings.sleeperConnect.switchHint")}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/import?provider=sleeper"
            className="inline-flex min-h-[44px] items-center rounded-xl bg-cyan-500/20 px-4 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/30"
          >
            {t("settings.sleeperConnect.importLeagues")}
          </Link>
          <Link
            href={CONNECTED_ACCOUNTS}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-white/10 px-4 text-sm font-semibold text-white/80 hover:bg-white/5"
          >
            {t("settings.nav.connected")}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/45">
          {t("settings.sleeperConnect.usernameLabel")}
        </span>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t("settings.sleeperConnect.usernamePlaceholder")}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base text-white outline-none focus:border-cyan-400/40 sm:text-sm"
        />
      </label>
      {state.kind === "error" ? (
        <p className="text-sm text-rose-300" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.kind === "handle-elsewhere" ? (
        <p className="text-sm text-rose-300" role="alert" data-testid="sleeper-handle-elsewhere">
          {tInterpolate("settings.sleeperConnect.handleElsewhere", { handle: state.handle })}
        </p>
      ) : null}
      {state.kind === "linked-to-other" ? (
        <p className="text-sm text-amber-300" role="alert" data-testid="sleeper-linked-to-other">
          {tInterpolate("settings.sleeperConnect.linkedToOtherBefore", { current: state.current })}{" "}
          <Link href={CONNECTED_ACCOUNTS} className="font-semibold underline">
            {t("settings.sleeperConnect.linkedToOtherLink")}
          </Link>{" "}
          {t("settings.sleeperConnect.linkedToOtherAfter")}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={state.kind === "loading"}
        className="min-h-[44px] rounded-xl bg-cyan-500/20 px-4 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/30 disabled:opacity-50"
      >
        {state.kind === "loading" ? t("settings.sleeperConnect.checking") : t("settings.sleeperConnect.linkButton")}
      </button>
      <p className="text-xs text-white/40">
        {t("settings.sleeperConnect.readOnly")}
      </p>
    </form>
  )
}
