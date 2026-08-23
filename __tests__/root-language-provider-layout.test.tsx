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
const railwayStartHelpers = require("../scripts/railway-next-start.cjs") as {
  restoreDocumentShellIfNeeded: (
    html: string,
    req: { headers: { cookie?: string } }
  ) => { html: string; changed: boolean }
}

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
const railwayJsonSource = fs.readFileSync(path.join(process.cwd(), "railway.json"), "utf8")
const nixpacksSource = fs.readFileSync(path.join(process.cwd(), "nixpacks.toml"), "utf8")
const railwayStartSource = fs.readFileSync(path.join(process.cwd(), "scripts", "railway-next-start.cjs"), "utf8")
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
    const providersStart = layoutSource.indexOf("<AppProviders ")
    const chromeGate = layoutSource.indexOf("<SafeGlobalChrome metaPixelId")
    const providersEnd = layoutSource.indexOf("</AppProviders>")

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
    // Volatile chrome lives inside SafeGlobalChrome, not the root layout.
    expect(safeGlobalChromeSource).toContain('id="fb-root"')
    expect(safeGlobalChromeSource).toContain("connect.facebook.net")
    expect(safeGlobalChromeSource).toContain('id="meta-pixel"')
    expect(safeGlobalChromeSource).toContain("<AuthRouteGlobalChrome />")
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
    expect(layoutSource).not.toContain("beforeInteractive")
    expect(layoutSource).not.toContain("buildThemeInitScript")
    expect(layoutSource).not.toContain("buildLanguageInitScript")
    expect(layoutSource).not.toContain('id="af-body-start"')
    // Route-sensitive chrome must NOT appear directly in the root layout
    // — it must be reached only via <SafeGlobalChrome />.
    expect(layoutSource).not.toContain('id="meta-pixel"')
    expect(layoutSource).not.toContain('id="af-register-sw"')
    expect(layoutSource).not.toContain('id="af-unregister-sw"')
    expect(layoutSource).not.toContain('id="fb-root"')
    expect(layoutSource).not.toContain("connect.facebook.net")
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
    expect(signupContentSource).toContain("useOptionalLanguage")
    expect(loginContentSource).toContain("useOptionalLanguage")
    expect(modeToggleSource).toContain("useOptionalLanguage")
    expect(languageToggleSource).toContain("useOptionalLanguage")
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

  it("renders auth content as client-only islands with ssr:false dynamic imports", () => {
    // login/page.tsx must dynamic-import LoginContent with ssr:false
    expect(loginPageSource).toContain('from "next/dynamic"')
    expect(loginPageSource).toContain('import("./LoginContent")')
    expect(loginPageSource).toContain("ssr: false")
    expect(loginPageSource).toContain("<ClientOnlyAuthPage>")

    // signup/page.tsx must dynamic-import SignupContent with ssr:false
    expect(signupPageSource).toContain('from "next/dynamic"')
    expect(signupPageSource).toContain('import("./SignupContent")')
    expect(signupPageSource).toContain("ssr: false")
    expect(signupPageSource).toContain("<ClientOnlyAuthPage>")
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
    expect(railwayJsonSource).toContain("npm run start:railway")
    expect(railwayJsonSource).toContain('"/api/af-debug/sha"')
    expect(nixpacksSource).toContain('cmd = "npm run start:railway"')
    expect(nextConfigSource).toContain("const railwayDistDir")
    expect(nextConfigSource).toContain("RAILWAY_GIT_COMMIT_SHA")
    expect(nextConfigSource).toContain("isRailwayRuntime ? railwayDistDir : '.next'")
    expect(railwayStartSource).not.toContain("proxyRequest")
    expect(railwayStartSource).not.toContain("patchIfRailwayDroppedDocumentShell")
    expect(railwayStartSource).not.toContain("ensureBodyBoundary")
    expect(railwayStartSource).not.toContain("ensureRailwayStylesLink")
    expect(railwayStartSource).not.toContain("AF_NEXT_DIST_DIR")
    expect(layoutSource).not.toContain('id="af-railway-styles"')
    expect(layoutSource).not.toContain("data-af-railway-styles")
    expect(layoutSource).not.toContain("RAILWAY_GIT_COMMIT_SHA")
    expect(railwayStartSource).toContain("'start'")
    expect(railwayStartSource).toContain("'-H'")
    expect(railwayStartSource).toContain("'0.0.0.0'")
    expect(railwayStartSource).toContain("'127.0.0.1'")
    expect(railwayStartSource).toContain("restoreDocumentShellIfNeeded")
    expect(railwayStartSource).toContain("parseCookieHeader")
    expect(railwayStartSource).toContain("'af_lang'")
    expect(railwayStartSource).toContain("'af_mode'")
    expect(railwayStartSource).toContain('href="/railway-styles.css"')
    expect(railwayStartSource).toContain("x-af-railway-proxy")
    expect(railwayStartSource).toContain("x-af-railway-shell-normalized")
    expect(railwayStartSource).toContain("delete headers['accept-encoding']")
    expect(railwayStartSource).toContain("content-length")
    expect(railwayStartSource).not.toContain("/api/af-railway-health")
    expect(railwayStartSource).not.toContain("af-body-start")
    expect(railwayStartSource).not.toContain("useLanguage")
  })

  it("normalizes Railway HTML fragments without touching valid documents", () => {
    const fragment =
      '<meta charSet="utf-8"/><title>AllFantasy</title><div id="root">Loaded</div></body></html>'
    const normalized = railwayStartHelpers.restoreDocumentShellIfNeeded(fragment, {
      headers: { cookie: "af_lang=es; af_mode=legacy" },
    })

    expect(normalized.changed).toBe(true)
    expect(normalized.html).toMatch(/^<!DOCTYPE html><html lang="es" data-lang="es" data-mode="legacy"/)
    expect(normalized.html).toContain('<head><link rel="stylesheet" href="/railway-styles.css"/>')
    expect(normalized.html).toContain(
      '<body class="antialiased min-h-screen mode-readable" style="background:var(--bg);color:var(--text)">'
    )
    expect((normalized.html.match(/<html/g) ?? []).length).toBe(1)
    expect((normalized.html.match(/<body/g) ?? []).length).toBe(1)
    expect(normalized.html).toContain('</body></html>')

    const validDocument = '<!DOCTYPE html><html lang="en"><head></head><body>Loaded</body></html>'
    const untouched = railwayStartHelpers.restoreDocumentShellIfNeeded(validDocument, {
      headers: {},
    })
    expect(untouched).toEqual({ html: validDocument, changed: false })
  })

  it("cleans stale Railway build artifacts before Next builds", () => {
    expect(packageJsonSource).toContain('"prebuild": "node scripts/railway-clean-next-build.cjs && node scripts/railway-tailwind-prebuild.cjs"')
    expect(packageJsonSource).toContain('"build": "next build"')
    expect(packageJsonSource).toContain('"build:railway": "node scripts/railway-clean-next-build.cjs && node scripts/railway-tailwind-prebuild.cjs && next build"')
    expect(railwayJsonSource).toContain(
      "npx prisma generate && npm run build:railway"
    )
    expect(railwayJsonSource).not.toContain("railway-verify-next-build.cjs")
    expect(nixpacksSource).toContain('"npx prisma generate"')
    expect(nixpacksSource).toContain('"npm run build:railway"')
    expect(nixpacksSource).not.toContain("railway-patch-app-build-manifest.cjs")
    expect(nixpacksSource).not.toContain('"node scripts/railway-verify-next-build.cjs"')
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
    expect(railwayPrebuildSource).toContain("AF_RAILWAY_TAILWIND_PREBUILD")
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
    expect(railwayPrebuildSource).toContain("committed Railway fallback CSS")
    expect(railwayPrebuildSource).toContain("fs.copyFileSync(railwayStylesOut, globalsIn)")
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
