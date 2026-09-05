import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { AppProviders } from "@/components/providers/AppProviders"
import { AuthPageShell } from "@/components/auth/AuthPageShell"
import { AuthRouteGlobalChrome } from "@/components/auth/AuthRouteGlobalChrome"
import LanguageToggle from "@/components/i18n/LanguageToggle"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"
import { ModeToggle } from "@/components/theme/ModeToggle"
import { ThemeProvider } from "@/components/theme/ThemeProvider"

const require = createRequire(import.meta.url)

vi.mock("next-auth/react", () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  signOut: vi.fn(),
  useSession: () => undefined,
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}))

beforeEach(() => {
  // happy-dom does not always provide a usable localStorage. Stub one so
  // components that touch storage during mount (LanguageProviderClient,
  // SessionIdleMonitor, etc.) don't throw inside these UI smoke tests.
  const memory = new Map<string, string>()
  const stub = {
    getItem: vi.fn((key: string) => (memory.has(key) ? memory.get(key)! : null)),
    setItem: vi.fn((key: string, value: string) => {
      memory.set(key, String(value))
    }),
    removeItem: vi.fn((key: string) => {
      memory.delete(key)
    }),
    clear: vi.fn(() => memory.clear()),
    key: vi.fn((index: number) => Array.from(memory.keys())[index] ?? null),
    get length() {
      return memory.size
    },
  } as unknown as Storage
  Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true })
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", { value: stub, configurable: true })
  }
})

const layoutSource = fs.readFileSync(path.join(process.cwd(), "app", "layout.tsx"), "utf8")
const appProvidersSource = fs.readFileSync(path.join(process.cwd(), "components", "providers", "AppProviders.tsx"), "utf8")
const signupPageSource = fs.readFileSync(path.join(process.cwd(), "app", "signup", "page.tsx"), "utf8")
const signupContentSource = fs.readFileSync(path.join(process.cwd(), "app", "signup", "SignupContent.tsx"), "utf8")
const loginPageSource = fs.readFileSync(path.join(process.cwd(), "app", "login", "page.tsx"), "utf8")
const loginContentSource = fs.readFileSync(path.join(process.cwd(), "app", "login", "LoginContent.tsx"), "utf8")
const signinPageSource = fs.readFileSync(path.join(process.cwd(), "app", "signin", "page.tsx"), "utf8")
const authPageShellSource = fs.readFileSync(path.join(process.cwd(), "components", "auth", "AuthPageShell.tsx"), "utf8")
// The live auth surface on both /login and /signup since the AuthV4 cutover.
const authV4Source = fs.readFileSync(path.join(process.cwd(), "components", "core-app", "screens", "AuthV4.tsx"), "utf8")
const clientOnlyAuthPageSource = fs.readFileSync(path.join(process.cwd(), "components", "auth", "ClientOnlyAuthPage.tsx"), "utf8")
const authRouteGlobalChromeSource = fs.readFileSync(path.join(process.cwd(), "components", "auth", "AuthRouteGlobalChrome.tsx"), "utf8")
const safeGlobalChromeSource = fs.readFileSync(path.join(process.cwd(), "components", "shell", "SafeGlobalChrome.tsx"), "utf8")
const globalAppShellSource = fs.readFileSync(path.join(process.cwd(), "components", "shared", "GlobalAppShell.tsx"), "utf8")
const languageProviderSource = fs.readFileSync(path.join(process.cwd(), "components", "i18n", "LanguageProviderClient.tsx"), "utf8")
const rootErrorSource = fs.readFileSync(path.join(process.cwd(), "app", "error.tsx"), "utf8")
const globalErrorSource = fs.readFileSync(path.join(process.cwd(), "app", "global-error.tsx"), "utf8")
const dashboardErrorSource = fs.readFileSync(path.join(process.cwd(), "app", "dashboard", "error.tsx"), "utf8")
const leagueRouteErrorSource = fs.readFileSync(path.join(process.cwd(), "app", "league", "[leagueId]", "error.tsx"), "utf8")
const dashboardUnavailableStateSource = fs.readFileSync(path.join(process.cwd(), "components", "dashboard", "DashboardUnavailableState.tsx"), "utf8")
const landingPageClientSource = fs.readFileSync(path.join(process.cwd(), "components", "landing", "LandingPageClient.tsx"), "utf8")
const homeTopNavSource = fs.readFileSync(path.join(process.cwd(), "components", "navigation", "HomeTopNav.tsx"), "utf8")
const syncProfilePreferencesSource = fs.readFileSync(path.join(process.cwd(), "components", "auth", "SyncProfilePreferences.tsx"), "utf8")
const middlewareSource = fs.readFileSync(path.join(process.cwd(), "middleware.ts"), "utf8")
const optionalSessionSource = fs.readFileSync(path.join(process.cwd(), "components", "auth", "useOptionalSession.ts"), "utf8")
const modeToggleSource = fs.readFileSync(path.join(process.cwd(), "components", "theme", "ModeToggle.tsx"), "utf8")
const languageToggleSource = fs.readFileSync(path.join(process.cwd(), "components", "i18n", "LanguageToggle.tsx"), "utf8")
const packageJsonSource = fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")
const nextConfigSource = fs.readFileSync(path.join(process.cwd(), "next.config.js"), "utf8")
/*
 * ⚠ railway.json and nixpacks.toml ARE GONE — Railway was disconnected from this
 * repo on 2026-08-27 and the site is served by Vercel alone. These were read at
 * module scope, so leaving the reads in place would throw on import and take the
 * whole file down rather than failing one assertion.
 *
 * The assertions that survived are the ones about package.json, next.config.js
 * and the layout: those files are shared with the Vercel build and the
 * `railway-` prefix on their scripts is a naming artefact, not a dependency.
 * `prebuild` in particular runs before EVERY build.
 */
const railwayStartSource = fs.readFileSync(path.join(process.cwd(), "scripts", "railway-next-start.cjs"), "utf8")
/*
 * ⚠ THE GUARD WAS FAILING ON ITS OWN DOCUMENTATION. railway-next-start.cjs must
 * not fabricate HTML — it used to run Next behind a proxy that wrapped
 * shell-less responses in a hand-built document, which React could not hydrate.
 * That code is long gone; what remains is a header comment EXPLAINING it, and
 * the comment necessarily quotes the very strings the test bans. Measured: all
 * four hits (`<!DOCTYPE html>`, `<html`, `<body`, `</head>`) are on lines 8-19,
 * inside the opening block comment, and `createServer`/`upstreamRes` do not
 * appear in the file at all.
 *
 * So the assertions run against the CODE. Deleting the comment would have made
 * the test pass by removing the only record of why the rule exists — the exact
 * trade this repo keeps refusing to make.
 *
 * Block comments and whole-line `//` only: an inline `//` is left alone so a
 * URL cannot swallow the rest of its line and hide a real violation behind it.
 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
}
const railwayStartCode = codeOnly(railwayStartSource)
/*
 * The layout with its comments removed, for assertions about STRUCTURE.
 * app/layout.tsx documents its own chrome in a JSDoc block that writes
 * `<SafeGlobalChrome />` in prose, so an indexOf for the tag finds the
 * explanation ~21KB before the element and concludes the chrome is mounted
 * outside AppProviders. Ordering checks read this; text checks read the source.
 */
const layoutCode = codeOnly(layoutSource)
const railwayCleanSource = fs.readFileSync(path.join(process.cwd(), "scripts", "railway-clean-next-build.cjs"), "utf8")
const railwayVerifySource = fs.readFileSync(path.join(process.cwd(), "scripts", "railway-verify-next-build.cjs"), "utf8")
const railwayPrebuildSource = fs.readFileSync(path.join(process.cwd(), "scripts", "railway-tailwind-prebuild.cjs"), "utf8")
const railwayStylesSource = fs.readFileSync(path.join(process.cwd(), "public", "railway-styles.css"), "utf8")
const uiDocumentSources = [
  ["app/layout.tsx", layoutSource],
  ["components/providers/AppProviders.tsx", appProvidersSource],
  ["app/signup/page.tsx", signupPageSource],
  ["app/login/page.tsx", loginPageSource],
  ["app/signin/page.tsx", signinPageSource],
] as const

describe("root language provider layout", () => {
  function StrictLanguageProbe() {
    const { t } = useLanguage()
    return <span>{t("common.guest")}</span>
  }

  it("wraps global controls and children with AppProviders unconditionally", () => {
    const providersStart = layoutCode.indexOf("<AppProviders ")
    /*
     * ⚠ MATCHED ON THE TAG, NOT ON A PROP. This read `<SafeGlobalChrome metaPixelId`
     * and had been failing since the pixel moved out of SafeGlobalChrome into
     * <MetaPixelPageViewTracker>: indexOf returned -1, so the assertion below
     * compared -1 against a real offset and reported the chrome as mounted
     * OUTSIDE AppProviders, which was never true.
     *
     * What this test is for is the ORDER — chrome inside the provider — and the
     * prop list is not part of that. Pinning a prop here means every future
     * signature change reads as a layout regression.
     *
     * ⚠ AND IT READS `layoutCode`, NOT `layoutSource`. The tag appears in this
     * file's own JSDoc too ("delegate every piece of route-sensitive chrome …
     * to `<SafeGlobalChrome />`"), ~21KB above the element — so a prop-agnostic
     * match against the raw source finds the sentence, not the JSX, and the
     * ordering assertion fails on a layout that is correct.
     */
    const chromeGate = layoutCode.indexOf("<SafeGlobalChrome")
    const providersEnd = layoutCode.indexOf("</AppProviders>")

    expect(providersStart).toBeGreaterThan(-1)
    expect(chromeGate).toBeGreaterThan(providersStart)
    expect(providersEnd).toBeGreaterThan(chromeGate)
  })

  it("delegates auth-route detection to a client component (no x-af-pathname dependency)", () => {
    // Layout must not read or branch on the proxy-injected header.
    expect(layoutSource).not.toMatch(/get\(['"]x-af-pathname['"]\)/)
    expect(layoutSource).not.toMatch(/\bisAuthRoute\b/)
    expect(layoutSource).not.toContain("isAuthRoutePath")
    expect(layoutSource).not.toContain("headers()")

    // Layout must mount the client-side route-aware chrome wrapper.
    expect(layoutSource).toContain("<SafeGlobalChrome")
    expect(layoutSource).toContain('from \'@/components/shell/SafeGlobalChrome\'')
  })

  it("SafeGlobalChrome bails out on every auth-route prefix via usePathname", () => {
    expect(safeGlobalChromeSource).toContain('"use client"')
    expect(safeGlobalChromeSource).toContain("usePathname")
    expect(safeGlobalChromeSource).toContain('"/login"')
    expect(safeGlobalChromeSource).toContain('"/signup"')
    expect(safeGlobalChromeSource).toContain('"/signin"')
    expect(safeGlobalChromeSource).toContain('"/auth"')
    expect(safeGlobalChromeSource).toContain("return null")
    /*
     * Volatile chrome lives inside SafeGlobalChrome, not the root layout.
     *
     * ⚠ THE FACEBOOK SDK IS THE THING THAT HAS TO BE HERE, and it is named
     * exactly now. This block used to assert a bare "connect.facebook.net",
     * which both this file and the layout satisfy for DIFFERENT scripts —
     * measured: SafeGlobalChrome loads sdk.js (1 occurrence), the layout loads
     * fbevents.js (4). A host-level match cannot tell those apart, so it would
     * pass while the SDK sat in the wrong file.
     *
     * The SDK specifically must be route-gated: it needs the #fb-root div, and
     * mounting it on /login rendered a second copy of that id.
     */
    expect(safeGlobalChromeSource).toContain('id="fb-root"')
    expect(safeGlobalChromeSource).toContain("connect.facebook.net/en_US/sdk.js")
    expect(safeGlobalChromeSource).toContain("<AuthRouteGlobalChrome />")
    /*
     * ⚠ `id="meta-pixel"` WAS ASSERTED HERE AND HAS NOT EXISTED SINCE THE PIXEL
     * MOVED. The page-view tracker is its own client component now, mounted from
     * the layout. Re-pointed rather than deleted, because the property worth
     * guarding survived the move: it calls useSearchParams(), which de-opts
     * everything above it to the nearest Suspense boundary — and in the ROOT
     * layout, with no boundary, that is the whole document. The layout stopped
     * emitting <!DOCTYPE html> on every App Router route the last time this was
     * unguarded, so the boundary is the assertion, not the id.
     */
    const trackerAt = layoutSource.indexOf("<MetaPixelPageViewTracker")
    const suspenseAt = layoutSource.lastIndexOf("<Suspense", trackerAt)
    expect(trackerAt).toBeGreaterThan(-1)
    expect(suspenseAt).toBeGreaterThan(-1)
    expect(layoutSource.slice(suspenseAt, trackerAt)).not.toContain("</Suspense>")
  })

  it("keeps root layout free of pre-hydration document mutations", () => {
    // Next should own the document head wrapper. Manually rendering a head tag in
    // the App Router root layout caused Railway to stream malformed HTML with
    // missing opening document tags.
    const headOpen = "      <" + "head>"
    const headClose = "      </" + "head>"
    expect(layoutSource).not.toContain(headOpen)
    expect(layoutSource).not.toContain(headClose)
    // Do not mutate <html> from localStorage before React hydrates. If stored
    // language/theme differs from the server cookies, React bails out at the
    // document root and attempts to append a second <html>.
    expect(layoutSource).not.toContain("af-init-mode")
    expect(layoutSource).not.toContain("af-init-lang")
    expect(layoutSource).not.toContain("buildThemeInitScript")
    expect(layoutSource).not.toContain("buildLanguageInitScript")
    expect(layoutSource).not.toContain('id="af-body-start"')
    /*
     * ⚠ THIS BANNED THE WORD `beforeInteractive`, WHICH IS NOT THE HAZARD.
     * The hazard is writing <html>'s attributes from stored state before React
     * hydrates; `beforeInteractive` was standing in for it, and the proxy broke
     * the moment a script used that strategy for something harmless. Measured:
     * the only one in the layout is
     *     <Script id="gtm-init" strategy="beforeInteractive">
     *       window.dataLayer = window.dataLayer || [];
     * — one assignment to a JS global, touching no DOM at all. Next also
     * REQUIRES beforeInteractive scripts to live in the root layout, so the old
     * assertion banned the only legal place to put one.
     *
     * Named directly instead, which is strictly stronger: it holds for every
     * script strategy, not just this one. `documentElement` itself is not
     * banned — the pixel loader legitimately reads
     * `(b.head || b.body || b.documentElement).appendChild(t)` to inject a
     * <script>, which appends a node React does not own rather than changing an
     * attribute React will diff.
     */
    expect(layoutSource).not.toMatch(/documentElement\s*\.\s*setAttribute/)
    expect(layoutSource).not.toMatch(/documentElement\s*\.\s*(lang|dir|className)\s*=/)
    expect(layoutSource).not.toMatch(/documentElement\s*\.\s*(dataset|classList)\s*\./)
    /*
     * Route-sensitive chrome must NOT appear directly in the root layout — it
     * must be reached only via <SafeGlobalChrome />.
     *
     * ⚠ "connect.facebook.net" WAS BANNED WHOLESALE AND THAT IS NOT THE RULE.
     * Two different Facebook scripts share that host and only one of them is
     * route-sensitive:
     *   sdk.js      — the SDK. Needs #fb-root, is gated on the pathname, and
     *                 belongs in SafeGlobalChrome. Still banned here.
     *   fbevents.js — the Pixel bootstrap. Deliberately ungated: it is gated
     *                 only on the NEXT_PUBLIC_META_PIXEL_ID env var, so it
     *                 renders identically on server and client on every route.
     *                 That makes it not a hydration hazard, which is what this
     *                 test is about. Added on purpose in 8d62d3525 to fire the
     *                 pixel as early as possible.
     * The old blanket ban could only be satisfied by deleting deliberate
     * analytics, so it sat red instead — and a red test guards nothing.
     */
    expect(layoutSource).not.toContain('id="meta-pixel"')
    expect(layoutSource).not.toContain('id="af-register-sw"')
    expect(layoutSource).not.toContain('id="af-unregister-sw"')
    expect(layoutSource).not.toContain('id="fb-root"')
    expect(layoutSource).not.toContain("connect.facebook.net/en_US/sdk.js")
  })

  it("preloads the NextAuth session unconditionally (no auth-route bypass)", () => {
    expect(layoutSource).toContain("getServerSession")
    expect(layoutSource).not.toContain("if (!isAuthRoute)")
    // Session preload is wrapped in try/catch so it can never crash the document.
    expect(layoutSource).toMatch(/try\s*{[^}]*getServerSession/s)
  })

  it("keeps LanguageProviderClient outside all runtime providers inside AppProviders", () => {
    const languageStart = appProvidersSource.indexOf("<LanguageProviderClient>")
    const sessionStart = appProvidersSource.indexOf("<SessionAppProvider")
    const themeStart = appProvidersSource.indexOf("<ThemeProvider>")
    const themeEnd = appProvidersSource.indexOf("</ThemeProvider>")
    const sessionEnd = appProvidersSource.indexOf("</SessionAppProvider>")
    const languageEnd = appProvidersSource.indexOf("</LanguageProviderClient>")

    expect(languageStart).toBeGreaterThan(-1)
    expect(sessionStart).toBeGreaterThan(languageStart)
    expect(themeStart).toBeGreaterThan(sessionStart)
    expect(themeEnd).toBeGreaterThan(themeStart)
    expect(sessionEnd).toBeGreaterThan(themeEnd)
    expect(languageEnd).toBeGreaterThan(sessionEnd)
  })

  it("renders ModeToggle inside AppProviders without a missing language context", () => {
    render(
      <AppProviders>
        <ModeToggle />
      </AppProviders>
    )

    expect(screen.getByRole("button", { name: /current theme/i })).toBeInTheDocument()
  })

  it("documents the strict hook contract and production provider coverage", () => {
    const preventExpectedError = (event: ErrorEvent) => {
      if (event.error instanceof Error && event.error.message.includes("useLanguage must be used")) {
        event.preventDefault()
      }
    }
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    window.addEventListener("error", preventExpectedError)

    try {
      expect(() => render(<StrictLanguageProbe />)).toThrow(
        "useLanguage must be used within LanguageProviderClient"
      )
    } finally {
      window.removeEventListener("error", preventExpectedError)
      consoleError.mockRestore()
    }

    render(
      <AppProviders>
        <StrictLanguageProbe />
      </AppProviders>
    )

    expect(screen.getByText(/guest/i)).toBeInTheDocument()
  })

  it("renders language-dependent toggles without LanguageProviderClient", () => {
    render(
      <>
        <ThemeProvider>
          <ModeToggle />
        </ThemeProvider>
        <LanguageToggle />
      </>
    )

    expect(screen.getByRole("combobox", { name: /language/i })).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /current theme/i }).length).toBeGreaterThan(0)
  })

  it("switches languages back to English without stale translated copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => null,
      }))
    )

    function LanguageLabelProbe() {
      const { t } = useLanguage()
      return <span data-testid="language-label">{t("common.language")}</span>
    }

    render(
      <AppProviders>
        <LanguageLabelProbe />
        <LanguageToggle />
      </AppProviders>
    )

    expect(screen.getByTestId("language-label")).toHaveTextContent("Language")

    fireEvent.change(screen.getByRole("combobox", { name: /language/i }), {
      target: { value: "es" },
    })

    await waitFor(() => {
      expect(screen.getByTestId("language-label")).toHaveTextContent("Idioma")
      expect(document.documentElement).toHaveAttribute("lang", "es")
      expect(document.documentElement).toHaveAttribute("data-lang", "es")
    })

    fireEvent.change(screen.getByRole("combobox", { name: /idioma/i }), {
      target: { value: "en" },
    })

    await waitFor(() => {
      expect(screen.getByTestId("language-label")).toHaveTextContent("Language")
      expect(document.documentElement).toHaveAttribute("lang", "en")
      expect(document.documentElement).toHaveAttribute("data-lang", "en")
    })
    expect(screen.queryByText("Idioma")).not.toBeInTheDocument()
  })

  it("uses optional language only for auth and global toggle fallbacks", () => {
    expect(languageProviderSource).toContain("export function useOptionalLanguage")
    expect(modeToggleSource).toContain("useOptionalLanguage")
    expect(languageToggleSource).toContain("useOptionalLanguage")
    /*
     * ⚠ THE TWO ASSERTIONS REMOVED HERE PINNED FILES THAT NOTHING RENDERS ANY
     * MORE. LoginContent and SignupContent were replaced by <AuthV4> on both
     * auth pages; a caller census in all four import forms finds them named
     * only inside the rollback COMMENTS in app/login/page.tsx and
     * app/signup/page.tsx, nowhere in code. (app/admin-login imports its own
     * AdminLoginContent, a different file — the near-identical name is why this
     * looked reachable.) `loginContentSource` had 0 occurrences of the hook, so
     * this test could never pass while it pointed there.
     *
     * The invariant is about the LIVE auth path, so it is asserted against the
     * live auth path below. AuthV4 satisfies it the strongest way available: it
     * calls neither hook, so it cannot throw on a missing provider at all.
     * Asserted as "does not call the strict hook" rather than "calls the
     * optional one", or this goes red again the day it starts translating.
     */
    expect(authV4Source).not.toMatch(/\buseLanguage\s*\(/)
    for (const [file, source] of [
      ["app/login/page.tsx", loginPageSource],
      ["app/signup/page.tsx", signupPageSource],
    ] as const) {
      expect(source, `${file} must not call the strict language hook`).not.toMatch(
        /\buseLanguage\s*\(/
      )
    }
  })

  it("keeps dashboard and league error fallbacks provider-safe", () => {
    for (const [file, source] of [
      ["app/dashboard/error.tsx", dashboardErrorSource],
      ["app/league/[leagueId]/error.tsx", leagueRouteErrorSource],
      ["components/dashboard/DashboardUnavailableState.tsx", dashboardUnavailableStateSource],
    ] as const) {
      expect(source, `${file} should use the provider-safe fallback hook`).toContain("useOptionalLanguage")
      expect(source, `${file} should not require LanguageProviderClient to render`).not.toMatch(
        /\buseLanguage\s*\(/
      )
    }
  })

  it("keeps root error boundaries independent of language providers", () => {
    for (const [file, source] of [
      ["app/error.tsx", rootErrorSource],
      ["app/global-error.tsx", globalErrorSource],
    ] as const) {
      expect(source, `${file} must not import the language provider`).not.toContain(
        "LanguageProviderClient"
      )
      expect(source, `${file} must not call the strict language hook`).not.toMatch(
        /\buseLanguage\s*\(/
      )
      expect(source, `${file} must not depend on optional provider context either`).not.toContain(
        "useOptionalLanguage"
      )
    }

    expect(rootErrorSource, "route-level root errors must not render document tags").not.toMatch(
      /<\/?(?:html|head|body)(?:\s|>|$)/i
    )
    expect(globalErrorSource, "global-error replaces the root layout and must render <html>").toMatch(
      /<html(?:\s|>|$)/i
    )
    expect(globalErrorSource, "global-error replaces the root layout and must render <body>").toMatch(
      /<body(?:\s|>|$)/i
    )
    expect(globalErrorSource).toContain("data-mode=\"dark\"")
  })

  it("keeps homepage and root chrome language reads provider-safe", () => {
    for (const [file, source] of [
      ["components/landing/LandingPageClient.tsx", landingPageClientSource],
      ["components/navigation/HomeTopNav.tsx", homeTopNavSource],
      ["components/auth/SyncProfilePreferences.tsx", syncProfilePreferencesSource],
    ] as const) {
      expect(source, `${file} should use the fallback language hook`).toContain("useOptionalLanguage")
      expect(source, `${file} should not crash if mounted before LanguageProviderClient`).not.toMatch(
        /\buseLanguage\s*\(/
      )
    }
  })

  it("uses optional session fallbacks for global auth chrome", () => {
    expect(optionalSessionSource).toContain("export function useOptionalSession")
    expect(optionalSessionSource).toContain('status: "unauthenticated"')
    expect(modeToggleSource).toContain("useOptionalSession")
    expect(languageToggleSource).toContain("useOptionalSession")
  })

  it("does not nest full app providers inside auth pages", () => {
    expect(signupPageSource).not.toContain("<AppProviders>")
    expect(loginPageSource).not.toContain("<AppProviders>")
  })

  it("uses the minimal auth page shell for login and signup", () => {
    expect(authPageShellSource).toContain('data-auth-page-shell="true"')
    // AuthPageShell must be a server-stable component (no "use client")
    expect(authPageShellSource).not.toContain('"use client"')
    expect(authPageShellSource).not.toContain("GlobalShellClient")
    expect(authPageShellSource).not.toContain("AppProviders")
    expect(authPageShellSource).not.toContain("LanguageToggle")
    expect(authPageShellSource).not.toContain("ModeToggle")
    expect(authPageShellSource).not.toContain("ServiceWorkerRegistration")
    expect(authPageShellSource).not.toContain("useSession")
    expect(authPageShellSource).not.toContain("document.")
    expect(loginPageSource).toContain("<AuthPageShell>")
    expect(signupPageSource).toContain("<AuthPageShell>")
  })

  it("renders auth content as client-only islands", () => {
    /*
     * ⚠ RENAMED FROM "...with ssr:false dynamic imports", BECAUSE THE MECHANISM
     * CHANGED AND THE REQUIREMENT DID NOT. Both pages used to reach their form
     * through `dynamic(() => import("./LoginContent"), { ssr: false })`; since
     * the AuthV4 cutover they import <AuthV4> directly and get the client-only
     * boundary from <ClientOnlyAuthPage> instead. Asserting `next/dynamic` was
     * asserting the old plumbing, so it failed on a page that still satisfies
     * the rule perfectly.
     *
     * What must stay true is that no auth FORM is server-rendered — that is
     * what stopped a real hydration crash on these routes. So the boundary is
     * asserted directly, including that ClientOnlyAuthPage still defers (it
     * renders a boot shell until a mount effect flips it), because a component
     * of that name that forgot to defer would satisfy a name-only check.
     */
    for (const [file, source] of [
      ["app/login/page.tsx", loginPageSource],
      ["app/signup/page.tsx", signupPageSource],
    ] as const) {
      expect(source, `${file} must wrap its auth form in the client-only boundary`).toContain(
        "<ClientOnlyAuthPage>"
      )
      const boundaryAt = source.indexOf("<ClientOnlyAuthPage>")
      const formAt = source.indexOf("<AuthV4")
      expect(formAt, `${file} should render the AuthV4 form`).toBeGreaterThan(-1)
      expect(formAt, `${file} must render the form INSIDE the boundary`).toBeGreaterThan(boundaryAt)
    }

    expect(clientOnlyAuthPageSource).toContain('"use client"')
    expect(clientOnlyAuthPageSource).toMatch(/useState\s*\(\s*false\s*\)/)
    expect(clientOnlyAuthPageSource).toMatch(/if\s*\(\s*!\s*mounted\s*\)/)
  })

  it("keeps ClientOnlyAuthPage provider-free and global-chrome-free", () => {
    expect(clientOnlyAuthPageSource).toContain('"use client"')
    expect(clientOnlyAuthPageSource).not.toContain("AppProviders")
    expect(clientOnlyAuthPageSource).not.toContain("GlobalShellClient")
    expect(clientOnlyAuthPageSource).not.toContain("useSession")
    expect(clientOnlyAuthPageSource).not.toContain("useLanguage")
    expect(clientOnlyAuthPageSource).not.toContain("usePathname")
    expect(clientOnlyAuthPageSource).not.toContain("ServiceWorkerRegistration")
    expect(clientOnlyAuthPageSource).not.toContain("AuthRouteGlobalChrome")
    expect(clientOnlyAuthPageSource).not.toContain("ModeToggle")
    expect(clientOnlyAuthPageSource).not.toContain("LanguageToggle")
    expect(clientOnlyAuthPageSource).not.toContain("document.")
    expect(clientOnlyAuthPageSource).not.toContain("window.")
  })

  it("keeps auth pages free of global chrome, toggles, and PWA install imports", () => {
    for (const [file, source] of [
      ["app/login/page.tsx", loginPageSource],
      ["app/login/LoginContent.tsx", loginContentSource],
      ["app/signup/page.tsx", signupPageSource],
      // Symmetric with LoginContent above. Both are now rollback-only files
      // (see the language-hook test), but while they sit on disk they are one
      // import away from being live again, so they are held to the same rule.
      ["app/signup/SignupContent.tsx", signupContentSource],
    ] as const) {
      expect(source, `${file} should not import GlobalShellClient`).not.toContain("GlobalShellClient")
      expect(source, `${file} should not import ModeToggle`).not.toContain("ModeToggle")
      expect(source, `${file} should not import LanguageToggle`).not.toContain("LanguageToggle")
      expect(source, `${file} should not import PWA install logic`).not.toMatch(
        /ServiceWorkerRegistration|beforeinstallprompt|navigator\.serviceWorker|PWAClient|Install/
      )
    }
    expect(signupPageSource).not.toContain("useThemeMode")
  })

  it("renders AuthPageShell without provider context", () => {
    render(
      <AuthPageShell>
        <div>Auth child</div>
      </AuthPageShell>
    )

    expect(screen.getByText("Auth child")).toBeInTheDocument()
  })

  it("renders global chrome on non-auth routes", () => {
    render(
      <AppProviders>
        <AuthRouteGlobalChrome />
      </AppProviders>
    )

    expect(screen.getByRole("button", { name: /current theme/i })).toBeInTheDocument()
  })

  it("bypasses global shell chrome for auth routes", () => {
    expect(middlewareSource).toContain('"x-af-pathname"')
    expect(globalAppShellSource).toContain('"/login"')
    expect(globalAppShellSource).toContain('"/signup"')
    expect(globalAppShellSource).toContain('"/signin"')
    expect(globalAppShellSource).toContain("isAuthShellBypassPath")
    expect(globalAppShellSource.indexOf("return <>{children}</>")).toBeLessThan(
      globalAppShellSource.indexOf("<GlobalShellClient")
    )
  })

  it("redirects /signin to the canonical login route", () => {
    expect(signinPageSource).toContain('redirect("/login")')
  })

  it("keeps document tags confined to the root layout", () => {
    expect(fs.existsSync(path.join(process.cwd(), "pages", "_document.tsx"))).toBe(false)

    for (const [file, source] of uiDocumentSources) {
      const hasDocumentTag = /<\/?html|<\/?body/.test(source)
      expect(hasDocumentTag, `${file} should not render html/body outside root layout`).toBe(
        file === "app/layout.tsx"
      )
    }
  })

  it("uses the guarded Next start path for Railway production", () => {
    expect(packageJsonSource).toContain('"start": "next start"')
    expect(packageJsonSource).toContain('"start:railway": "node scripts/railway-next-start.cjs"')
    /*
     * ⚠ THE next.config.js RAILWAY ASSERTIONS ARE GONE, AND MUST NOT COME BACK.
     * They required `const railwayDistDir`, `RAILWAY_GIT_COMMIT_SHA` and the
     * `isRailwayRuntime ? railwayDistDir : '.next'` switch to be PRESENT. That
     * code has already been removed from next.config.js, and Railway was
     * disconnected from this repo on 2026-08-27 — so a test demanding it is not
     * merely stale, it points the next reader at re-adding dead host logic.
     *
     * The negative assertions below are the ones worth keeping: they pin that
     * the layout and the start script carry nothing Railway-shaped.
     */
    expect(layoutSource).not.toContain('id="af-railway-styles"')
    expect(layoutSource).not.toContain("data-af-railway-styles")
    expect(layoutSource).not.toContain("RAILWAY_GIT_COMMIT_SHA")

    // The start script starts Next and nothing else. It used to run Next on
    // PORT+1 behind a proxy that wrapped shell-less HTML in a hand-built
    // <html>/<body>, which React could not hydrate: #418 escalated to #423 and
    // the client re-render tore the document down, so every page flashed and
    // then went blank. Anything that rewrites HTML here brings that back.
    expect(railwayStartCode).toContain("'start'")
    expect(railwayStartCode).toContain("'-H'")
    expect(railwayStartCode).not.toContain("createServer")
    expect(railwayStartCode).not.toContain("restoreDocumentShellIfNeeded")
    expect(railwayStartCode).not.toContain("x-af-railway-proxy")
    expect(railwayStartCode).not.toContain("x-af-railway-shell-normalized")
    expect(railwayStartCode).not.toContain("<!DOCTYPE html>")
    expect(railwayStartCode).not.toContain('href="/railway-styles.css"')
    expect(railwayStartCode).not.toContain("delete headers['accept-encoding']")
    expect(railwayStartCode).not.toContain("useLanguage")
    // The stripper must actually be stripping. Without this, a change that
    // emptied `railwayStartCode` would turn every `not.toContain` above green
    // for the worst possible reason — the file-that-cannot-fail, in a helper.
    expect(railwayStartCode).toContain("spawn")
  })

  it("serves Next's HTML unmodified", () => {
    // A document that arrives without a shell must be fixed in the render, not
    // patched in transit. Fabricating <html>/<body> the server never rendered is
    // a hydration mismatch at the document root, and the page ends up blank
    // rather than merely unstyled.
    expect(railwayStartCode).not.toMatch(/http\.createServer|createServer\(/)
    expect(railwayStartCode).not.toContain("upstreamRes")
    expect(railwayStartCode).not.toContain("<body")
    expect(railwayStartCode).not.toContain("<html")
    expect(railwayStartCode).not.toContain("</head>")
    // Same positive control as above: prove the stripped source is still real.
    expect(railwayStartCode).toContain("spawn")
  })

  it("cleans stale Railway build artifacts before Next builds", () => {
    /*
     * ⚠ THESE PINNED WHOLE SCRIPT STRINGS AND BROKE ON EVERY LEGITIMATE
     * ADDITION. What they guard is that the clean step runs BEFORE the tailwind
     * prebuild, and both before the build — an ordering. Spelling the command
     * out end to end also asserts that nothing else may ever be added, which is
     * a different and much stronger claim, and it is the one that failed:
     *   prebuild      gained `node scripts/verify-node-modules.cjs &&` in front
     *   build         gained the --max-old-space-size + readlink-shim wrapper
     *                 that exists because next build OOMs at the default heap
     *   build:railway gained the loader-cache purge and the postbuild CSS audit
     * Every one of those is deliberate, so the assertions were demanding a
     * revert. Parsed and ordered instead, which still catches a dropped or
     * reordered step.
     */
    const scripts = (JSON.parse(packageJsonSource) as { scripts: Record<string, string> }).scripts
    for (const key of ["prebuild", "build:railway"] as const) {
      const cleanAt = scripts[key].indexOf("railway-clean-next-build.cjs")
      const tailwindAt = scripts[key].indexOf("railway-tailwind-prebuild.cjs")
      expect(cleanAt, `${key} must run the Railway clean step`).toBeGreaterThan(-1)
      expect(tailwindAt, `${key} must run the tailwind prebuild`).toBeGreaterThan(cleanAt)
    }
    // The build must end at `next build`, however it is wrapped to get there.
    expect(scripts.build).toMatch(/(^|[/\s])next(\/dist\/bin\/next)?\s+build\b/)
    expect(scripts["build:railway"]).toMatch(/(^|[/\s])next(\/dist\/bin\/next)?\s+build\b/)
    expect(scripts["build:railway"].indexOf("railway-tailwind-prebuild.cjs")).toBeLessThan(
      scripts["build:railway"].search(/(^|[/\s])next(\/dist\/bin\/next)?\s+build\b/)
    )
    /*
     * ⚠ THE ROOT LAYOUT NO LONGER CARRIES ANYTHING RAILWAY-SPECIFIC, and these
     * two assertions were what pinned it there. The unconditional
     * `<link href="/railway-styles.css">` existed to compensate for Railway's
     * CSS-extraction failure; it shipped on EVERY response, Vercel included,
     * which is a per-page request for a stylesheet that platform never needs.
     * Production is Vercel, so the tag was removed rather than re-gated —
     * removing it is hydration-safe in a way re-gating is not, because both
     * server and client now render nothing (see the comment history on
     * `useRailwayStylesFallback`, where a server-only env gate crashed
     * hydration on every page).
     *
     * The rest of this block still guards the Railway build scripts, which are
     * retained and inert: they self-disable unless RAILWAY_* is set.
     */
    /*
     * 🛑 THREE ASSERTIONS HERE PINNED THE SHAPE THAT CAUSED AN INCIDENT, and
     * this is the one worth reading twice. They required
     *     AF_RAILWAY_TAILWIND_PREBUILD
     *     "committed Railway fallback CSS"
     *     fs.copyFileSync(railwayStylesOut, globalsIn)
     * — the old prebuild, which opened by copying the committed
     * public/railway-styles.css over globals.css and exiting WITHOUT COMPILING
     * whenever that file cleared 100KB. It is committed and was 671KB, so the
     * branch fired on every build: Railway shipped CSS frozen at 2026-05-31 for
     * nearly three months and the site rendered essentially unstyled.
     *
     * The script was rewritten on 2026-08-25 to fix exactly that, and these
     * assertions have been red ever since — so the guard was sitting here
     * demanding the regression back, and nobody could see it, because a test
     * that is already failing reports nothing new.
     *
     * Replaced with the rule the incident produced, in the script's own words:
     * A CACHED ARTIFACT IS NOT EVIDENCE THAT COMPILATION SUCCEEDED. It may only
     * be used when compilation has been attempted and has actually failed.
     */
    // Compilation is attempted: the Tailwind CLI runs as its own process.
    expect(railwayPrebuildSource).toContain("'node_modules', '.bin', 'tailwindcss'")
    expect(railwayPrebuildSource).toMatch(/execSync\(\s*cmd/)
    // The fallback still exists and is still known about.
    expect(railwayPrebuildSource).toContain("railway-styles.css")
    // ...but shipping it is reachable ONLY behind the explicit escape hatch,
    // and exactly once. A second copy site is how the shortcut comes back.
    expect(railwayPrebuildSource).toContain("AF_ALLOW_STALE_RAILWAY_CSS")
    const staleCopies = railwayPrebuildSource.match(/copyFileSync\(\s*fallbackCss\s*,\s*globalsCss\s*\)/g) ?? []
    expect(staleCopies).toHaveLength(1)
    expect(railwayPrebuildSource.indexOf("allowStaleFallback")).toBeLessThan(
      railwayPrebuildSource.indexOf("copyFileSync(fallbackCss, globalsCss)")
    )
    // The fallback is refreshed only FROM a compile that already succeeded.
    expect(railwayPrebuildSource).toContain("copyFileSync(compiledTmp, fallbackCss)")
    // And a compile that produces too little CSS is a failure, not a pass.
    expect(railwayPrebuildSource).toContain("MIN_RAILWAY_CSS_BYTES = 100_000")
    expect(railwayCleanSource).toContain("path.join(repoRoot, '.next')")
    expect(railwayCleanSource).toContain("removePath(nextDir)")
    expect(railwayCleanSource).not.toContain("'.next', 'cache', 'webpack'")
    expect(railwayCleanSource).not.toContain("for (const entry")
    expect(railwayVerifySource).toContain("BLOCKED: /layout has no CSS assets")
    expect(railwayVerifySource).toContain("client reference manifests with layout CSS")
    expect(railwayVerifySource).toContain("app-build-manifest.json")
    expect(railwayVerifySource).toContain("process.env.AF_NEXT_DIST_DIR || '.next'")
    expect(railwayCleanSource).toContain("RAILWAY_GIT_COMMIT_SHA")
    expect(railwayVerifySource).toContain("MIN_TOTAL_CSS_BYTES = 100_000")
    expect(railwayVerifySource).not.toContain("public/railway-styles.css")
    expect(railwayVerifySource).not.toContain("hasLargeRailwayFallbackCss")
    expect(railwayPrebuildSource).toContain("RAILWAY_GIT_COMMIT_SHA")
    expect(railwayPrebuildSource).toContain("AF_NEXT_DIST_DIR?.startsWith('.next-railway')")
    expect(railwayPrebuildSource).not.toContain("AF_NEXT_DIST_DIR === '.next-railway'")
    expect(railwayStylesSource.length).toBeGreaterThan(100_000)
  })

  it("does not require build-time Google font fetches for the root document", () => {
    expect(layoutSource).not.toContain("next/font/google")
    expect(layoutSource).not.toContain("Inter(")
    expect(layoutSource).not.toContain("--font-inter")
  })
})
