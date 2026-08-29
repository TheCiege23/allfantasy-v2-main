/**
 * Issue detectors.
 *
 * A scripted spec fails when an assertion it declared is violated. An agent has
 * declared nothing, so it needs a standing definition of "this is wrong" that
 * holds on any page it wanders onto. That is what lives here.
 *
 * Design rule: every detector reports in the user's terms, not the DOM's.
 * "Submitted the form and nothing happened for 9s" is actionable at 8am on a
 * Monday. "expected locator to be visible" is not.
 */

import { type ConsoleMessage, type Page, type Response } from "@playwright/test"

export type Severity = "blocker" | "major" | "minor"

export type Finding = {
  severity: Severity
  /** Short, human. Becomes the report headline. */
  title: string
  /** What the persona experienced, in plain language. */
  narrative: string
  /** Where it happened. */
  url: string
  /** Optional machine detail for a developer to chase. */
  evidence?: string
  /** Which archetype hit it. Filled in by the explorer. */
  archetype?: string
  /** Step index within the run. */
  step?: number
}

/**
 * Console/network noise that is not worth waking anyone for. Kept deliberately
 * short — an over-eager ignore list is how real errors get filtered into
 * silence. Add to it only with a reason.
 */
const IGNORED_CONSOLE_PATTERNS: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /Download the React DevTools/i,
    why: "React's standard dev-mode nag, not an app error.",
  },
  {
    pattern: /\[Fast Refresh\]/i,
    why: "Next dev-server HMR chatter.",
  },
  {
    pattern: /Extension context invalidated/i,
    why: "Browser-extension noise from the host profile, not the app.",
  },
]

/**
 * Third-party hosts whose failures are not the app's fault. A blocked analytics
 * beacon is not a product bug and reporting it drowns the signal.
 */
const THIRD_PARTY_HOSTS = [
  "google-analytics.com",
  "googletagmanager.com",
  "facebook.net",
  "facebook.com",
  "connect.facebook.net",
  "doubleclick.net",
  "sentry.io",
  "vercel-insights.com",
  "vitals.vercel-insights.com",
]

function isThirdParty(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return THIRD_PARTY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  } catch {
    return false
  }
}

export function shouldIgnoreConsole(text: string): boolean {
  return IGNORED_CONSOLE_PATTERNS.some(({ pattern }) => pattern.test(text))
}

/** Console errors → findings. Page errors (uncaught exceptions) outrank logs. */
export function fromConsoleMessage(msg: ConsoleMessage, url: string): Finding | null {
  if (msg.type() !== "error") return null
  const text = msg.text()
  if (shouldIgnoreConsole(text)) return null
  if (isThirdParty(msg.location()?.url ?? "")) return null

  return {
    severity: "minor",
    title: "JavaScript error in the console",
    narrative:
      "The page logged an error while the user was on it. It did not necessarily break anything visible, but it is unhandled.",
    url,
    evidence: text.slice(0, 500),
  }
}

/** Uncaught exceptions are always at least major — something did break. */
export function fromPageError(error: Error, url: string): Finding {
  return {
    severity: "major",
    title: "Unhandled exception crashed part of the page",
    narrative:
      "An uncaught JavaScript exception fired. In React this usually means a component tree unmounted, so the user is looking at a blank area or a stale screen.",
    url,
    evidence: `${error.name}: ${error.message}`.slice(0, 500),
  }
}

/** Failed requests. 5xx is the app's fault; 4xx depends. */
export function fromResponse(response: Response, pageUrl: string): Finding | null {
  const status = response.status()
  const url = response.url()

  if (status < 400) return null
  if (isThirdParty(url)) return null

  // data: and blob: URLs are not parseable as network resources and never
  // represent a server fault; guard so pathname extraction below cannot throw.
  let pathname = url
  try {
    pathname = new URL(url).pathname
  } catch {
    return null
  }

  // A 401 on an auth endpoint during a logged-out probe is expected behaviour.
  const isAuthProbe = /\/api\/auth\/(session|csrf|providers)/.test(url)
  if (status === 401 && isAuthProbe) return null

  if (status >= 500) {
    return {
      severity: "blocker",
      title: `Server error ${status} on ${pathname}`,
      narrative:
        "The server returned a 5xx. Whatever the user was trying to do at this moment did not happen, and the app may or may not have told them so.",
      url: pageUrl,
      evidence: `${status} ${url}`,
    }
  }

  if (status === 429) {
    return {
      severity: "major",
      title: "Rate limited",
      narrative:
        "The user was rate limited. If this fired during normal-paced use, the limit is too tight for real behaviour.",
      url: pageUrl,
      evidence: `429 ${url}`,
    }
  }

  if (status === 404) {
    return {
      severity: "major",
      title: `Dead link or missing resource (404)`,
      narrative: "Something the page asked for does not exist. Users see this as a broken feature.",
      url: pageUrl,
      evidence: `404 ${url}`,
    }
  }

  return {
    severity: "minor",
    title: `Request failed with ${status}`,
    narrative: "A request the page depends on was rejected.",
    url: pageUrl,
    evidence: `${status} ${url}`,
  }
}

/**
 * The patience detector — the one a scripted suite structurally cannot have,
 * because a script's timeout is a machine tolerance and this is a human one.
 */
export function fromSlowResponse(
  elapsedMs: number,
  patienceMs: number,
  what: string,
  url: string
): Finding | null {
  if (elapsedMs <= patienceMs) return null

  const seconds = (elapsedMs / 1000).toFixed(1)
  const budget = (patienceMs / 1000).toFixed(1)

  return {
    severity: elapsedMs > patienceMs * 2 ? "major" : "minor",
    title: `${what} took ${seconds}s`,
    narrative:
      `This persona gives up after ${budget}s. The screen was unresponsive for ${seconds}s, ` +
      "so a real user in this mood would have left or hit the button again.",
    url,
    evidence: `elapsed=${Math.round(elapsedMs)}ms patience=${patienceMs}ms`,
  }
}

/**
 * Dead-end detector: the user clicked something and the page did not change in
 * any way they could perceive — no navigation, no DOM mutation, no network.
 * This is the single most common real-world complaint ("the button does nothing")
 * and it is invisible to assertion-based tests.
 */
export function deadEnd(label: string, url: string): Finding {
  return {
    severity: "major",
    title: `"${label}" appears to do nothing`,
    narrative:
      `The user clicked "${label}" and nothing observable happened — no navigation, no new content, ` +
      "no network request. From their side the control is broken.",
    url,
  }
}

/** Session died mid-flow and the app did not recover gracefully. */
export function sessionLost(url: string, detail: string): Finding {
  return {
    severity: "blocker",
    title: "Session dropped mid-flow",
    narrative:
      "The user was signed in, stepped away, and came back to find themselves logged out — with whatever they had entered gone. " +
      "This is the interrupted-user failure mode and it reads as data loss.",
    url,
    evidence: detail,
  }
}

/** Form submitted twice produced two effects. */
export function doubleSubmit(url: string, detail: string): Finding {
  return {
    severity: "blocker",
    title: "Double-click created a duplicate",
    narrative:
      "An impatient double-click on the primary action was processed twice. Users double-click constantly when a button feels slow.",
    url,
    evidence: detail,
  }
}

/** Accessibility/usability: tap target too small on a mobile persona. */
export function tinyTapTarget(label: string, size: string, url: string): Finding {
  return {
    severity: "minor",
    title: `"${label}" is hard to tap`,
    narrative:
      `The control measures ${size}, under the 44x44px minimum. On a phone this produces mis-taps, ` +
      "which users experience as the app being unresponsive rather than as their own error.",
    url,
  }
}

/** Deduplicate findings that repeat across steps. */
export function dedupe(findings: Finding[]): Finding[] {
  const seen = new Map<string, Finding>()
  for (const f of findings) {
    const key = `${f.severity}|${f.title}|${f.evidence ?? ""}`
    if (!seen.has(key)) seen.set(key, f)
  }
  return [...seen.values()]
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  blocker: 0,
  major: 1,
  minor: 2,
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  )
}
