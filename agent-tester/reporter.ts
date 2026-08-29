/**
 * Report writer.
 *
 * The point of an agent tester is lost if the output reads like a test log. A
 * failing click-audit tells you a selector broke; this should tell you that the
 * casual returner could not get back into their league, and what they tried.
 * So: findings ordered by severity, each one narrated from the persona's side,
 * with the trail underneath for the developer who has to reproduce it.
 *
 * Writes both a Markdown file (for humans, committed or pasted into an issue)
 * and JSON (for CI to diff run over run).
 */

import fs from "node:fs"
import path from "node:path"
import { type RunResult } from "./explorer"
import { type Finding, type Severity } from "./detectors"

const OUT_DIR = process.env.AGENT_TESTER_OUT_DIR ?? "agent-tester/reports"

const SEVERITY_LABEL: Record<Severity, string> = {
  blocker: "BLOCKER",
  major: "MAJOR",
  minor: "MINOR",
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function renderFinding(finding: Finding, index: number): string {
  const lines: string[] = []
  lines.push(`#### ${index}. [${SEVERITY_LABEL[finding.severity]}] ${finding.title}`)
  lines.push("")
  lines.push(finding.narrative)
  lines.push("")
  lines.push(`- **Where:** ${finding.url}`)
  if (finding.archetype) lines.push(`- **Who:** ${finding.archetype}`)
  if (typeof finding.step === "number") lines.push(`- **Step:** ${finding.step}`)
  if (finding.evidence) {
    lines.push(`- **Detail:** \`${finding.evidence.replace(/`/g, "'")}\``)
  }
  lines.push("")
  return lines.join("\n")
}

export function renderMarkdown(results: RunResult[], meta: { baseURL: string }): string {
  const all = results.flatMap((r) => r.findings)
  const counts = {
    blocker: all.filter((f) => f.severity === "blocker").length,
    major: all.filter((f) => f.severity === "major").length,
    minor: all.filter((f) => f.severity === "minor").length,
  }

  const lines: string[] = []
  lines.push(`# Agent tester report`)
  lines.push("")
  lines.push(`**Target:** ${meta.baseURL}  `)
  lines.push(`**Run:** ${new Date().toISOString()}  `)
  lines.push(
    `**Findings:** ${counts.blocker} blocker, ${counts.major} major, ${counts.minor} minor`
  )
  lines.push("")

  // Headline: what actually happened to each persona. This is the part a
  // non-engineer reads and acts on.
  lines.push(`## What happened to each user`)
  lines.push("")
  for (const result of results) {
    const outcome = result.succeeded ? "completed the goal" : "**did not complete the goal**"
    const blockers = result.findings.filter((f) => f.severity === "blocker").length
    const suffix = blockers > 0 ? ` — hit ${blockers} blocker${blockers === 1 ? "" : "s"}` : ""
    lines.push(
      `- **${result.archetype}** on _${result.mission}_: ${outcome} in ${result.steps} steps${suffix}`
    )
  }
  lines.push("")

  if (all.length === 0) {
    lines.push(`## Findings`)
    lines.push("")
    lines.push(`No issues detected. Every persona reached its goal without tripping a detector.`)
    lines.push("")
    return lines.join("\n")
  }

  lines.push(`## Findings`)
  lines.push("")

  const bySeverity: Severity[] = ["blocker", "major", "minor"]
  let counter = 1
  for (const severity of bySeverity) {
    const group = all.filter((f) => f.severity === severity)
    if (group.length === 0) continue
    lines.push(`### ${SEVERITY_LABEL[severity]} (${group.length})`)
    lines.push("")
    for (const finding of group) {
      lines.push(renderFinding(finding, counter++))
    }
  }

  // Trails last — needed for reproduction, but they are noise above the fold.
  lines.push(`## Reproduction trails`)
  lines.push("")
  for (const result of results) {
    lines.push(`<details>`)
    lines.push(`<summary>${result.archetype} — ${result.mission}</summary>`)
    lines.push("")
    lines.push("```")
    lines.push(...result.trail)
    lines.push("```")
    lines.push("")
    lines.push(`</details>`)
    lines.push("")
  }

  return lines.join("\n")
}

/** Write both formats. Returns the markdown path. */
export function writeReport(results: RunResult[], meta: { baseURL: string }): string {
  ensureDir(OUT_DIR)
  const stamp = timestamp()

  const mdPath = path.join(OUT_DIR, `agent-report-${stamp}.md`)
  const jsonPath = path.join(OUT_DIR, `agent-report-${stamp}.json`)

  fs.writeFileSync(mdPath, renderMarkdown(results, meta), "utf8")
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({ target: meta.baseURL, at: new Date().toISOString(), results }, null, 2),
    "utf8"
  )

  // Also keep a stable "latest" so CI and humans have a fixed path to read.
  fs.writeFileSync(path.join(OUT_DIR, "latest.md"), renderMarkdown(results, meta), "utf8")

  return mdPath
}

/** Console summary — printed at the end of a run so the terminal is useful too. */
export function printSummary(results: RunResult[]): void {
  const all = results.flatMap((r) => r.findings)
  const blockers = all.filter((f) => f.severity === "blocker")
  const majors = all.filter((f) => f.severity === "major")

  // eslint-disable-next-line no-console
  console.log("\n──── AGENT TESTER ────")
  for (const result of results) {
    // eslint-disable-next-line no-console
    console.log(
      `  ${result.succeeded ? "✅" : "❌"} ${result.archetype} · ${result.mission} · ${result.steps} steps`
    )
  }
  if (blockers.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`\n  ${blockers.length} BLOCKER(S):`)
    for (const b of blockers) {
      // eslint-disable-next-line no-console
      console.log(`    • ${b.title} — ${b.url}`)
    }
  }
  if (majors.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`\n  ${majors.length} major:`)
    for (const m of majors.slice(0, 10)) {
      // eslint-disable-next-line no-console
      console.log(`    • ${m.title}`)
    }
  }
  // eslint-disable-next-line no-console
  console.log("──────────────────────\n")
}
