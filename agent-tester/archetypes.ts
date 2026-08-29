/**
 * User archetypes for the AllFantasy agent tester.
 *
 * WHY ARCHETYPES INSTEAD OF MORE SCRIPTED SPECS.
 * The existing e2e/ suite already encodes ~90 known-good paths. What it cannot
 * encode is the *shape of a person* — how fast they move, what they misread,
 * what they do when a page takes eight seconds, whether they trust a button.
 * Those behaviours produce a different failure set than a click-audit does, and
 * that set is where churn lives.
 *
 * Each archetype is a behavioural profile, not a script. The explorer reads
 * these knobs to decide pacing, patience, and which affordance to reach for
 * next, so the same mission produces genuinely different runs per persona.
 */

import { type Page } from "@playwright/test"

/** How the persona reads a screen before acting. */
export type ReadingStyle =
  /** Scans for the biggest/primary CTA and commits. Misses secondary affordances. */
  | "scan"
  /** Reads labels and helper text; more likely to find the correct control. */
  | "careful"
  /** Knows the product; goes straight for deep links and keyboard paths. */
  | "expert"

export type Archetype = {
  id: string
  label: string
  /** One line, used verbatim in the report so findings read as a human story. */
  premise: string

  readingStyle: ReadingStyle

  /**
   * Milliseconds of "thinking" between actions. Real users are not instant, and
   * several classes of bug (double-submit, optimistic-UI desync, race on a
   * debounced field) only appear at human latency — or only at machine speed.
   */
  actionDelayMs: [min: number, max: number]

  /**
   * How long the persona will stare at an unresponsive screen before treating it
   * as broken. This is the single most important knob: a 30s spinner is a pass
   * for a script and an abandonment for a human.
   */
  patienceMs: number

  /** Viewport + UA. Mobile personas surface layout and tap-target failures. */
  device: "desktop" | "mobile" | "tablet"

  /** Network shaping. "slow" approximates mid-tier mobile on cellular. */
  network: "fast" | "slow"

  /** Maximum interactions per mission before the run is called. */
  maxSteps: number

  /**
   * Behavioural quirks the explorer will deliberately inject. These are the
   * "interrupted user" behaviours that scripted suites never perform because a
   * script has no reason to press Back in the middle of its own happy path.
   */
  quirks: {
    /** Presses browser Back mid-flow, then tries to continue. */
    usesBackButton: boolean
    /** Reloads the page mid-flow (tests optimistic UI + form state retention). */
    reloadsMidFlow: boolean
    /** Double-clicks primary actions (tests idempotency / double-submit). */
    doubleClicks: boolean
    /** Backgrounds the tab for a while, then returns (tests session expiry). */
    idlesMidFlow: boolean
    /** Opens things in a second tab (tests cross-tab session/state handling). */
    opensSecondTab: boolean
    /** Submits forms with the Enter key rather than clicking. */
    submitsWithEnter: boolean
  }

  /**
   * Applied to the Playwright context before the run. Kept as a function so a
   * persona can set cookies, permissions, or emulation in one place.
   */
  setup?: (page: Page) => Promise<void>
}

const DESKTOP_FAST = { device: "desktop", network: "fast" } as const

export const ARCHETYPES: Record<string, Archetype> = {
  /**
   * The single most valuable persona for AllFantasy. Fantasy is seasonal: the
   * modal user has not opened the app since last season, remembers nothing, and
   * has a very short fuse. Every onboarding assumption is invalid for them.
   */
  casualReturner: {
    id: "casual-returner",
    label: "Casual returner",
    premise:
      "Played last season, has not opened the app since, remembers neither their password nor what the app is called.",
    readingStyle: "scan",
    actionDelayMs: [800, 2200],
    patienceMs: 6_000,
    ...DESKTOP_FAST,
    maxSteps: 40,
    quirks: {
      usesBackButton: true,
      reloadsMidFlow: false,
      doubleClicks: true,
      idlesMidFlow: false,
      opensSecondTab: false,
      submitsWithEnter: true,
    },
  },

  /**
   * Drafts in many leagues, moves fast, and hits rate limits and race
   * conditions that a paced user never reaches.
   */
  powerUser: {
    id: "power-user",
    label: "Power user",
    premise:
      "Runs six leagues, keeps three tabs open, and clicks the next thing before the last one finished.",
    readingStyle: "expert",
    actionDelayMs: [80, 300],
    patienceMs: 15_000,
    ...DESKTOP_FAST,
    maxSteps: 80,
    quirks: {
      usesBackButton: true,
      reloadsMidFlow: true,
      doubleClicks: true,
      idlesMidFlow: false,
      opensSecondTab: true,
      submitsWithEnter: true,
    },
  },

  /**
   * Reads every field and hesitates. Surfaces copy problems, unclear validation,
   * and anything that demands information the user does not want to give.
   */
  anxiousFirstTimer: {
    id: "anxious-first-timer",
    label: "Anxious first-timer",
    premise:
      "Never played fantasy. Reads every label, distrusts anything asking for a phone number, and quits if a form feels invasive.",
    readingStyle: "careful",
    actionDelayMs: [2000, 5000],
    patienceMs: 10_000,
    device: "mobile",
    network: "slow",
    maxSteps: 35,
    quirks: {
      usesBackButton: true,
      reloadsMidFlow: false,
      doubleClicks: false,
      idlesMidFlow: true,
      opensSecondTab: false,
      submitsWithEnter: false,
    },
  },

  /**
   * The archetype that breaks session handling. Starts a flow, gets pulled away,
   * comes back to a dead token — and finds out whether your app recovers
   * gracefully or dumps them at a login screen with their work gone.
   */
  interruptedUser: {
    id: "interrupted-user",
    label: "Interrupted user",
    premise:
      "Starts something, gets pulled away mid-form, comes back twenty minutes later and expects to continue.",
    readingStyle: "scan",
    actionDelayMs: [600, 1800],
    patienceMs: 8_000,
    device: "mobile",
    network: "slow",
    maxSteps: 30,
    quirks: {
      usesBackButton: true,
      reloadsMidFlow: true,
      doubleClicks: false,
      idlesMidFlow: true,
      opensSecondTab: true,
      submitsWithEnter: false,
    },
  },

  /**
   * Commissioners touch the widest surface area — settings, invites, scoring,
   * rosters — and their mistakes affect a whole league, so their failure modes
   * are the most expensive ones you have.
   */
  commissioner: {
    id: "commissioner",
    label: "Commissioner",
    premise:
      "Sets up the league for eleven other people, changes settings after the fact, and expects invites to just work.",
    readingStyle: "careful",
    actionDelayMs: [500, 1500],
    patienceMs: 20_000,
    ...DESKTOP_FAST,
    maxSteps: 70,
    quirks: {
      usesBackButton: true,
      reloadsMidFlow: true,
      doubleClicks: false,
      idlesMidFlow: false,
      opensSecondTab: true,
      submitsWithEnter: false,
    },
  },
}

export const ALL_ARCHETYPE_IDS = Object.keys(ARCHETYPES)

export function getArchetype(id: string): Archetype {
  const found = Object.values(ARCHETYPES).find((a) => a.id === id)
  if (!found) {
    throw new Error(
      `Unknown archetype "${id}". Known: ${Object.values(ARCHETYPES)
        .map((a) => a.id)
        .join(", ")}`
    )
  }
  return found
}

/** Playwright device descriptor name for an archetype's device class. */
export function deviceNameFor(archetype: Archetype): string {
  switch (archetype.device) {
    case "mobile":
      return "Pixel 5"
    case "tablet":
      return "iPad (gen 7)"
    default:
      return "Desktop Chrome"
  }
}
