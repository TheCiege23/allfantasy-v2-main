/**
 * The exploration engine.
 *
 * This is the part that makes it an *agent* rather than a script: it observes
 * the page, chooses what a given persona would plausibly do next, does it, and
 * judges the result against that persona's tolerance. It never has a hardcoded
 * selector path through a flow — missions state a goal, the explorer finds its
 * own way there, and the interesting output is where it could not.
 *
 * Decision-making has two modes:
 *   • heuristic (default) — deterministic, free, CI-safe, no API key.
 *   • llm (opt-in)        — set AGENT_TESTER_BRAIN=llm and ANTHROPIC_API_KEY to
 *                           let a model choose actions and judge screens.
 * The heuristic mode is not a degraded fallback; it catches the whole dead-end,
 * patience, session, and double-submit class on its own. The LLM adds judgement
 * about whether a screen actually makes sense to a human.
 */

import { expect, type Locator, type Page } from "@playwright/test"
import { type Archetype } from "./archetypes"
import {
  deadEnd,
  dedupe,
  doubleSubmit,
  fromConsoleMessage,
  fromPageError,
  fromResponse,
  fromSlowResponse,
  sessionLost,
  sortFindings,
  tinyTapTarget,
  type Finding,
} from "./detectors"
import { chooseAction, judgeScreen, type BrainDecision } from "./brain"

export type Mission = {
  id: string
  /** Stated in the user's terms — the explorer decides how to achieve it. */
  goal: string
  /** Where the persona starts. */
  startPath: string
  /**
   * Signals that the goal was reached. Any one matching ends the mission as a
   * success. Kept loose on purpose: an agent that only succeeds via one exact
   * selector is a script wearing a costume.
   */
  success: {
    urlPattern?: RegExp
    textPattern?: RegExp
  }
  /** Mission needs a writable target (creates accounts/leagues). */
  requiresWrites: boolean
}

/** A single affordance the persona can perceive and act on. */
type Affordance = {
  locator: Locator
  label: string
  kind: "button" | "link" | "input" | "select" | "checkbox"
  /** Rough visual prominence, used by the "scan" reading style. */
  prominence: number
}

export type RunResult = {
  archetype: string
  mission: string
  succeeded: boolean
  steps: number
  findings: Finding[]
  /** Narrative trail — what the persona did, in order. Goes in the report. */
  trail: string[]
}

function randBetween([min, max]: [number, number]): number {
  return min + Math.random() * (max - min)
}

/** Text a human would use to refer to a control. */
async function labelFor(locator: Locator): Promise<string> {
  const candidates = await Promise.all([
    locator.getAttribute("aria-label").catch(() => null),
    locator.getAttribute("placeholder").catch(() => null),
    locator.getAttribute("name").catch(() => null),
    locator.innerText().catch(() => null),
    locator.getAttribute("title").catch(() => null),
  ])
  const found = candidates.find((c) => c && c.trim().length > 0)
  return (found ?? "unlabelled control").trim().replace(/\s+/g, " ").slice(0, 60)
}

export class Explorer {
  private findings: Finding[] = []
  private trail: string[] = []
  private step = 0
  private visitedSignatures = new Set<string>()

  /**
   * Whether the real viewport is phone-sized. Resolved from the page rather than
   * from the archetype, so the project and the persona disagreeing cannot
   * produce bogus tap-target findings.
   */
  private isTouchViewport = false

  constructor(
    private readonly page: Page,
    private readonly archetype: Archetype,
    private readonly baseURL: string
  ) {
    const viewport = page.viewportSize()
    this.isTouchViewport = viewport ? viewport.width < 768 : false
  }

  /** Wire passive detectors. Call once, before navigating. */
  attachListeners(): void {
    this.page.on("console", (msg) => {
      const finding = fromConsoleMessage(msg, this.page.url())
      if (finding) this.record(finding)
    })

    this.page.on("pageerror", (error) => {
      this.record(fromPageError(error, this.page.url()))
    })

    this.page.on("response", (response) => {
      const finding = fromResponse(response, this.page.url())
      if (finding) this.record(finding)
    })
  }

  private record(finding: Finding): void {
    this.findings.push({
      ...finding,
      archetype: this.archetype.id,
      step: this.step,
    })
  }

  private note(line: string): void {
    this.trail.push(`${String(this.step).padStart(2, "0")}. ${line}`)
  }

  /** Human pacing between actions. */
  private async think(): Promise<void> {
    await this.page.waitForTimeout(randBetween(this.archetype.actionDelayMs))
  }

  /**
   * A cheap fingerprint of the current screen, used to notice that an action
   * changed nothing. Combines URL, title, and a coarse content measure — enough
   * to catch "the button did nothing" without being so sensitive that a blinking
   * cursor counts as a change.
   */
  private async screenSignature(): Promise<string> {
    const [url, title, bodyLength, visibleButtons] = await Promise.all([
      this.page.url(),
      this.page.title().catch(() => ""),
      this.page
        .evaluate(() => document.body?.innerText?.length ?? 0)
        .catch(() => 0),
      this.page.locator("button:visible").count().catch(() => 0),
    ])
    // Bucket the length so trivial text churn (timers, counters) does not read
    // as a real change, but a new panel or route does.
    return `${url}|${title}|${Math.floor(bodyLength / 50)}|${visibleButtons}`
  }

  /** Everything on screen the persona could plausibly act on. */
  private async perceive(): Promise<Affordance[]> {
    const affordances: Affordance[] = []

    const collect = async (
      selector: string,
      kind: Affordance["kind"],
      baseProminence: number
    ) => {
      const locators = this.page.locator(selector)
      const count = Math.min(await locators.count().catch(() => 0), 25)
      for (let i = 0; i < count; i++) {
        const locator = locators.nth(i)
        const visible = await locator.isVisible().catch(() => false)
        if (!visible) continue
        const enabled = await locator.isEnabled().catch(() => false)
        if (!enabled) continue

        const label = await labelFor(locator)
        const box = await locator.boundingBox().catch(() => null)

        // Prominence approximates "what the eye lands on": bigger and higher
        // wins. A scanning persona commits to the top of this ordering.
        const area = box ? box.width * box.height : 0
        const verticalBonus = box ? Math.max(0, 1200 - box.y) / 1200 : 0
        const prominence = baseProminence + area / 10_000 + verticalBonus * 2

        // Tap-target checks key off the ACTUAL viewport, not the archetype's
        // declared device. The two can disagree — a mobile persona run under
        // --project=desktop gets a desktop viewport — and keying off the
        // declaration would report tap-target failures against a 1280px window,
        // which is a false positive that trains people to ignore the report.
        if (this.isTouchViewport && box && kind !== "input") {
          if (box.width < 44 || box.height < 44) {
            this.record(
              tinyTapTarget(
                label,
                `${Math.round(box.width)}x${Math.round(box.height)}px`,
                this.page.url()
              )
            )
          }
        }

        affordances.push({ locator, label, kind, prominence })
      }
    }

    await collect('button:not([disabled])', "button", 3)
    await collect('[role="button"]', "button", 3)
    await collect('a[href]', "link", 1)
    await collect('input:not([type="hidden"]):not([type="checkbox"])', "input", 2)
    await collect('select', "select", 2)
    await collect('input[type="checkbox"]', "checkbox", 1)

    return affordances
  }

  /** Order affordances the way this persona's eye would. */
  private rank(affordances: Affordance[]): Affordance[] {
    switch (this.archetype.readingStyle) {
      case "scan":
        // Commits to the most visually dominant thing, ignores the rest.
        return [...affordances].sort((a, b) => b.prominence - a.prominence)
      case "careful":
        // Works top-to-bottom, reading as they go — form fields before buttons.
        return [...affordances].sort((a, b) => {
          const kindWeight = (k: Affordance["kind"]) =>
            k === "input" || k === "select" || k === "checkbox" ? 0 : 1
          return kindWeight(a.kind) - kindWeight(b.kind) || b.prominence - a.prominence
        })
      case "expert":
        // Goes for the action directly; skips reading.
        return [...affordances].sort((a, b) => {
          const kindWeight = (k: Affordance["kind"]) => (k === "button" ? 0 : 1)
          return kindWeight(a.kind) - kindWeight(b.kind) || b.prominence - a.prominence
        })
    }
  }

  /** Fill an input with something a human would actually type. */
  private async fillInput(affordance: Affordance, seed: string): Promise<void> {
    const type =
      (await affordance.locator.getAttribute("type").catch(() => null)) ?? "text"
    const name = affordance.label.toLowerCase()

    let value: string
    if (type === "email" || name.includes("email")) {
      // Reserved domain — cannot enter the marketing list even by accident.
      value = `agent.${seed}@example.com`
    } else if (type === "password" || name.includes("password")) {
      value = "Password123!"
    } else if (type === "tel" || name.includes("phone")) {
      value = "+15555550123"
    } else if (name.includes("user") || name.includes("handle")) {
      value = `agent${seed}`.slice(0, 20)
    } else if (name.includes("league") || name.includes("team")) {
      value = `Agent Test League ${seed.slice(-4)}`
    } else if (type === "number") {
      value = "10"
    } else {
      value = `Agent ${seed.slice(-4)}`
    }

    await affordance.locator.fill(value, { timeout: 10_000 })
    this.note(`typed into "${affordance.label}"`)
  }

  /**
   * Perform one action and judge what happened. Returns whether the screen
   * changed in a way the user could perceive.
   */
  private async act(affordance: Affordance, seed: string): Promise<boolean> {
    const before = await this.screenSignature()
    const startedAt = Date.now()

    try {
      if (affordance.kind === "input") {
        await this.fillInput(affordance, seed)
        return true // typing always "changes" the screen from the user's view
      }

      if (affordance.kind === "checkbox") {
        await affordance.locator.check({ timeout: 10_000 })
        this.note(`ticked "${affordance.label}"`)
        return true
      }

      if (affordance.kind === "select") {
        const options = affordance.locator.locator("option")
        const count = await options.count().catch(() => 0)
        if (count > 1) {
          await affordance.locator.selectOption({ index: 1 }, { timeout: 10_000 })
          this.note(`chose an option in "${affordance.label}"`)
          return true
        }
        return false
      }

      // Buttons and links.
      this.note(`clicked "${affordance.label}"`)

      if (this.archetype.quirks.doubleClicks && affordance.kind === "button") {
        // Deliberate impatience: two clicks in quick succession, the way a user
        // treats a button that has not visibly responded yet.
        await affordance.locator.click({ timeout: 15_000 })
        await this.page.waitForTimeout(120)
        await affordance.locator.click({ timeout: 5_000 }).catch(() => {
          /* second click may legitimately be blocked — that is the good outcome */
        })
      } else {
        await affordance.locator.click({ timeout: 15_000 })
      }
    } catch {
      this.note(`could not interact with "${affordance.label}"`)
      return false
    }

    // Give the app a moment to respond, bounded by this persona's patience.
    await this.page
      .waitForLoadState("networkidle", { timeout: this.archetype.patienceMs })
      .catch(() => {
        /* networkidle is best-effort; slow apps are the point, not an error */
      })

    const elapsed = Date.now() - startedAt
    const slow = fromSlowResponse(
      elapsed,
      this.archetype.patienceMs,
      `"${affordance.label}"`,
      this.page.url()
    )
    if (slow) this.record(slow)

    const after = await this.screenSignature()

    if (before === after) {
      // Nothing the user could perceive changed. Confirm it is not just a slow
      // render before calling it dead — one more look after a short beat.
      await this.page.waitForTimeout(1200)
      const recheck = await this.screenSignature()
      if (recheck === before) {
        this.record(deadEnd(affordance.label, this.page.url()))
        return false
      }
    }

    return true
  }

  /** Inject this persona's disruptive behaviours at plausible moments. */
  private async maybeMisbehave(): Promise<void> {
    const q = this.archetype.quirks

    if (q.reloadsMidFlow && Math.random() < 0.12) {
      this.note("reloaded the page mid-flow")
      await this.page.reload({ waitUntil: "domcontentloaded" }).catch(() => {})
    }

    if (q.usesBackButton && Math.random() < 0.15) {
      this.note("pressed the browser Back button")
      await this.page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {})
    }

    if (q.idlesMidFlow && Math.random() < 0.08) {
      // Simulates being pulled away. Long enough to expire a short-lived token
      // without making the suite unusably slow.
      const idleMs = Number(process.env.AGENT_TESTER_IDLE_MS ?? 45_000)
      this.note(`got distracted for ${Math.round(idleMs / 1000)}s`)

      const wasSignedIn = await this.isSignedIn()
      await this.page.waitForTimeout(idleMs)

      if (wasSignedIn) {
        const stillSignedIn = await this.isSignedIn()
        if (!stillSignedIn) {
          this.record(
            sessionLost(
              this.page.url(),
              `session was valid before a ${Math.round(idleMs / 1000)}s idle and gone after it`
            )
          )
        }
      }
    }
  }

  private async isSignedIn(): Promise<boolean> {
    try {
      const response = await this.page.request.get("/api/auth/session", {
        timeout: 10_000,
      })
      if (!response.ok()) return false
      const body = (await response.json().catch(() => null)) as {
        user?: { id?: string | null } | null
      } | null
      return Boolean(body?.user?.id)
    } catch {
      return false
    }
  }

  /** Did we reach the mission goal? */
  private async checkSuccess(mission: Mission): Promise<boolean> {
    if (mission.success.urlPattern?.test(this.page.url())) return true

    if (mission.success.textPattern) {
      const text = await this.page
        .evaluate(() => document.body?.innerText ?? "")
        .catch(() => "")
      if (mission.success.textPattern.test(text)) return true
    }

    return false
  }

  /** Run one mission to completion, exhaustion, or abandonment. */
  async run(mission: Mission): Promise<RunResult> {
    const seed = `${Date.now()}${Math.floor(Math.random() * 100)}`

    this.note(`started at ${mission.startPath} — goal: ${mission.goal}`)

    // Navigate against the PREFLIGHT-VALIDATED base URL rather than leaning on
    // the config's baseURL. The config reads its value from the environment at
    // load time; preflight is what actually validated the host against the
    // production denylist. Using the validated one keeps those from diverging.
    const target = this.baseURL
      ? new URL(mission.startPath, this.baseURL).toString()
      : mission.startPath

    await this.page.goto(target, { waitUntil: "domcontentloaded" })

    let succeeded = false

    for (this.step = 1; this.step <= this.archetype.maxSteps; this.step++) {
      if (await this.checkSuccess(mission)) {
        succeeded = true
        this.note("reached the goal")
        break
      }

      await this.think()
      await this.maybeMisbehave()

      const affordances = await this.perceive()
      if (affordances.length === 0) {
        this.record({
          severity: "blocker",
          title: "Screen has nothing to interact with",
          narrative:
            "The persona arrived and found no enabled, visible control at all. Either the page failed to render or it is a genuine dead end.",
          url: this.page.url(),
        })
        break
      }

      const ranked = this.rank(affordances)

      // Ask the brain which affordance to take. Heuristic mode returns the
      // top-ranked unvisited option; LLM mode reasons about the goal.
      const decision: BrainDecision = await chooseAction({
        goal: mission.goal,
        archetype: this.archetype,
        url: this.page.url(),
        affordances: ranked.map((a) => ({ label: a.label, kind: a.kind })),
        visited: [...this.visitedSignatures],
      })

      if (decision.kind === "give-up") {
        this.note(`gave up: ${decision.reason}`)
        this.record({
          severity: "major",
          title: "Persona abandoned the flow",
          narrative: `${this.archetype.label} stopped trying. Reason: ${decision.reason}`,
          url: this.page.url(),
        })
        break
      }

      const chosen = ranked[decision.index] ?? ranked[0]
      const signature = `${this.page.url()}::${chosen.label}`

      // Do not loop on the same control forever; a human would not either.
      if (this.visitedSignatures.has(signature) && ranked.length > 1) {
        const alternative = ranked.find(
          (a) => !this.visitedSignatures.has(`${this.page.url()}::${a.label}`)
        )
        if (alternative) {
          this.visitedSignatures.add(`${this.page.url()}::${alternative.label}`)
          await this.act(alternative, seed)
          continue
        }
      }

      this.visitedSignatures.add(signature)
      await this.act(chosen, seed)
    }

    if (!succeeded && this.step > this.archetype.maxSteps) {
      this.record({
        severity: "major",
        title: `Could not complete: ${mission.goal}`,
        narrative:
          `${this.archetype.label} spent ${this.archetype.maxSteps} interactions and never reached the goal. ` +
          "A flow that takes this many steps to fail is a flow users do not finish.",
        url: this.page.url(),
      })
    }

    // Optional LLM pass: does the final screen actually make sense to a person?
    const judgement = await judgeScreen({
      archetype: this.archetype,
      goal: mission.goal,
      url: this.page.url(),
      text: await this.page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? "").catch(() => ""),
    })
    if (judgement) this.record(judgement)

    return {
      archetype: this.archetype.id,
      mission: mission.id,
      succeeded,
      steps: this.step,
      findings: sortFindings(dedupe(this.findings)),
      trail: this.trail,
    }
  }
}

/**
 * Assertion helper for specs: fail the Playwright test when blockers were found,
 * but always emit the full report first so a failing run is still readable.
 */
export function assertNoBlockers(result: RunResult): void {
  const blockers = result.findings.filter((f) => f.severity === "blocker")
  expect(
    blockers,
    blockers.map((b) => `${b.title} — ${b.narrative}`).join("\n\n")
  ).toHaveLength(0)
}
