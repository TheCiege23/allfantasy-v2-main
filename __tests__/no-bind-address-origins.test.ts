import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * A guard for the whole class, not one bug.
 *
 * Next builds a route handler's `req.url` / `req.nextUrl` from the address the
 * server was BOUND to, so on Railway (`next start -H 0.0.0.0 -p 8080`) their
 * origin is `https://0.0.0.0:8080` — never the host the visitor reached. Anything
 * built from it is a dead end. Measured in production on 2026-09-02, before the
 * sweep: verification links, password-reset emails, both Yahoo entry points, beta
 * invite links, the admin health self-check and the internal proxy were all
 * pointing there, and /api/auth/logout returned 500.
 *
 * lib/http/relative-redirect.ts and lib/http/served-origin.ts hold the two right
 * answers — `relativeRedirect` when
 * the browser follows the URL, `getServedOrigin` when an absolute one is needed.
 */

const ROOTS = ["app", "lib", "middleware.ts"]

/** middleware runs in the edge adapter, where nextUrl DOES carry the real host. */
const EXEMPT = new Set(["middleware.ts"])

const BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /\bnextUrl\.origin\b/, why: "req.nextUrl.origin is the bind address in a route handler" },
  { pattern: /new URL\(\s*(?:req|request)\.url\s*\)\.origin/, why: "new URL(req.url).origin is the bind address" },
  {
    pattern: /(?:NextResponse|Response)\.redirect\(\s*new URL\([^)]*\b(?:req|request)\.url\b/,
    why: "a redirect built from req.url resolves against the bind address",
  },
  {
    pattern: /(?:NextResponse|Response)\.redirect\(\s*['"`]\//,
    why: "NextResponse.redirect throws on a relative URL (validateURL) — use relativeRedirect",
  },
]

/**
 * 🛑 THE INDIRECTION CASE, WHICH THE LINE-BY-LINE PATTERNS ABOVE CANNOT SEE.
 *
 * The four BANNED regexes all require `req.url` (or `.origin`) on the SAME LINE as the
 * use. This shape defeats every one of them by binding the request URL to a variable
 * first and then using it as a URL *base*:
 *
 *     const url = new URL(req.url);                              // no .origin
 *     NextResponse.redirect(new URL("/admin-login", url));       // no req.url
 *
 * That is not hypothetical. app/api/auth/admin-magic/consume/route.ts carried exactly
 * it, my sweep declared the class clear, and on 2026-09-04 an admin clicked a magic
 * link and landed on https://0.0.0.0:8080/admin. Fixed in cfa43d909 — by someone else,
 * because this guard said there was nothing left to find.
 *
 * So it is a two-pass check: collect the variables bound from a request URL, then flag
 * any `new URL(…, thatVar)` that uses one as a base. Reading `.searchParams` or
 * `.pathname` off such a variable is fine and stays unflagged — the bind address only
 * matters when it becomes the origin of something.
 */
function findRequestUrlBaseUses(src: string): { line: number; text: string }[] {
  const lines = src.split("\n")
  const bound = new Set<string>()

  for (const line of lines) {
    const m = line.match(
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new URL\(\s*(?:req|request)\.(?:url|nextUrl)\b/,
    )
    if (m) bound.add(m[1])
  }
  if (bound.size === 0) return []

  const out: { line: number; text: string }[] = []
  lines.forEach((line, i) => {
    for (const v of bound) {
      if (new RegExp(`new URL\\([^)]*,\\s*${v}\\s*[),]`).test(line)) {
        out.push({ line: i + 1, text: line.trim() })
        break
      }
    }
  })
  return out
}

function sourceFiles(root: string): string[] {
  const abs = path.resolve(process.cwd(), root)
  if (!fs.existsSync(abs)) return []
  if (fs.statSync(abs).isFile()) return [root]

  const out: string[] = []
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const rel = `${root}/${entry.name}`
    if (entry.isDirectory()) out.push(...sourceFiles(rel))
    else if (/\.tsx?$/.test(entry.name)) out.push(rel)
  }
  return out
}

/**
 * Strip comments before matching. The sweep left the banned strings in prose all
 * over the codebase explaining why they are banned; without this the guard fails
 * on its own documentation.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
}

describe("no user-facing URL is built from a route handler's bind address", () => {
  const files = ROOTS.flatMap(sourceFiles).filter((f) => !EXEMPT.has(f))

  it("finds source to scan (positive control for the walker itself)", () => {
    // Without this an empty file list would make every assertion below vacuously true.
    expect(files.length).toBeGreaterThan(500)
    expect(files).toContain("app/verify/email/route.ts")
    expect(files).toContain("lib/http/served-origin.ts")
    expect(files).toContain("lib/http/relative-redirect.ts")
  })

  it("catches the indirection shape that escaped the first sweep (real historical code)", () => {
    /*
     * ⚠ THE CONTROL IS THE ACTUAL PRE-FIX SOURCE, not a paraphrase. This is
     * app/api/auth/admin-magic/consume/route.ts as it stood before cfa43d909 — the
     * version an admin's magic-link click resolved against https://0.0.0.0:8080 on
     * 2026-09-04, after this guard had already declared the class clear.
     */
    const historical = [
      '  const url = new URL(req.url);',
      '  if (!token) {',
      '    return NextResponse.redirect(new URL("/admin-login?err=magic", url));',
      '  }',
      '  const res = NextResponse.redirect(new URL(next, url), { status: 303 });',
    ].join('\n')

    const hits = findRequestUrlBaseUses(stripComments(historical))
    expect(hits.length).toBe(2)
    expect(hits[0].text).toContain('/admin-login?err=magic')

    // And none of the line-by-line patterns sees it — which is why it shipped.
    for (const line of historical.split('\n')) {
      expect(BANNED.some(({ pattern }) => pattern.test(line))).toBe(false)
    }
  })

  it("does not flag reading searchParams off a request URL (that is fine)", () => {
    const benign = [
      '  const url = new URL(req.url)',
      '  const token = url.searchParams.get("token")',
      '  const next = url.pathname',
    ].join('\n')
    expect(findRequestUrlBaseUses(stripComments(benign))).toEqual([])
  })

  it("catches the pattern it is looking for (positive control for the matcher)", () => {
    const planted = `return NextResponse.redirect(new URL('/login', req.url))`
    expect(BANNED.some(({ pattern }) => pattern.test(stripComments(planted)))).toBe(true)
    expect(BANNED.some(({ pattern }) => pattern.test(stripComments(`const o = req.nextUrl.origin`)))).toBe(true)
  })

  it("has no remaining occurrences", () => {
    const offences: string[] = []

    for (const file of files) {
      const src = stripComments(fs.readFileSync(path.resolve(process.cwd(), file), "utf8"))
      src.split("\n").forEach((line, i) => {
        for (const { pattern, why } of BANNED) {
          if (pattern.test(line)) offences.push(`${file}:${i + 1}  ${why}\n    ${line.trim()}`)
        }
      })
      for (const hit of findRequestUrlBaseUses(src)) {
        offences.push(
          `${file}:${hit.line}  a variable bound from the request URL is used as a URL base — ` +
            `that base is the bind address\n    ${hit.text}`,
        )
      }
    }

    expect(offences, `\n${offences.join("\n")}\n`).toEqual([])
  })
})
