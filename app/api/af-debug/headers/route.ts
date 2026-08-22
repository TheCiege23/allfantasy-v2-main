import { NextResponse } from "next/server"
import { headers } from "next/headers"
import nodeFs from "node:fs"
import nodePath from "node:path"

/**
 * Safe diagnostic endpoint. Returns a small, non-secret slice of request
 * metadata so we can confirm whether the upstream proxy (Railway, Vercel, etc.)
 * preserves the middleware-injected `x-af-pathname` header that the root layout
 * historically relied on for auth-route detection.
 *
 * NOTE: Lives under `/api/af-debug/*` (not `/api/_debug/*`). Next.js App Router
 * treats folders prefixed with `_` as private opt-out-of-routing folders, so a
 * route file under `app/api/_debug/headers/route.ts` is intentionally excluded
 * from the build and 404s in production — which then renders the global
 * not-found page with full app chrome (Meta Pixel + FB SDK) and causes the
 * React hydration crash we are diagnosing.
 *
 * No cookies, no authorization, no env values are returned.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SAFE_HEADER_KEYS = [
  "x-af-pathname",
  "next-url",
  "x-next-url",
  "x-invoke-path",
  "x-matched-path",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-for",
  "x-vercel-deployment-url",
  "x-railway-edge",
  "host",
  "referer",
  "user-agent",
] as const


/**
 * Build introspection. Reports whether the DEPLOYED build output actually
 * contains the root layout, which distinguishes "the build dropped it" from
 * "the runtime skipped it". Returns only filenames, sizes and booleans --
 * never file contents, env values or secrets.
 */
function inspectBuild() {
  const fs = nodeFs
  const path = nodePath
  const cwd = process.cwd()
  // The layout's own signature: className="scroll-smooth" on <html>.
  const MARKER = "scroll-smooth"
  const out: Record<string, unknown> = {
    node: process.version,
    platform: process.platform,
    nodeEnv: process.env.NODE_ENV ?? null,
    afNextDistDir: process.env.AF_NEXT_DIST_DIR ?? null,
    cwd,
  }
  try {
    out.distDirsPresent = fs
      .readdirSync(cwd)
      .filter((n) => n === ".next" || n.startsWith(".next-"))
      .slice(0, 20)
  } catch {
    out.distDirsPresent = "unreadable"
  }
  const dist = path.join(cwd, process.env.AF_NEXT_DIST_DIR || ".next")
  out.distDir = dist
  try {
    out.buildId = fs.readFileSync(path.join(dist, "BUILD_ID"), "utf8").trim()
  } catch {
    out.buildId = null
  }
  // Does the server build contain the layout at all? The layout's markup is
  // compiled into <dist>/server/chunks/*.js -- verified against a known-good
  // local build, where it lands in exactly 3 of ~1056 chunk files.
  const hits: string[] = []
  let scanned = 0
  try {
    const chunkDir = path.join(dist, "server", "chunks")
    for (const name of fs.readdirSync(chunkDir)) {
      if (!name.endsWith(".js")) continue
      if (scanned >= 2000 || hits.length >= 8) break
      scanned++
      try {
        if (fs.readFileSync(path.join(chunkDir, name), "utf8").includes(MARKER)) {
          hits.push("server/chunks/" + name)
        }
      } catch { /* unreadable chunk */ }
    }
  } catch { /* no chunks dir */ }
  out.filesScanned = scanned
  out.layoutMarker = MARKER
  out.layoutMarkerFoundIn = hits
  out.layoutPresentInBuild = hits.length > 0
  try {
    const appDir = path.join(dist, "server", "app")
    out.serverAppEntries = fs.readdirSync(appDir).slice(0, 15)
  } catch {
    out.serverAppEntries = "unreadable"
  }
  // The route tree itself. If the layout is on disk but absent from these
  // manifests, Next has no way to wrap /page in it -- which is the difference
  // between "the build dropped it" and "the manifest lost it".
  try {
    const m = JSON.parse(
      fs.readFileSync(path.join(dist, "app-build-manifest.json"), "utf8"),
    ) as { pages?: Record<string, string[]> }
    const pages = m.pages ?? {}
    out.appBuildManifest = {
      totalKeys: Object.keys(pages).length,
      hasLayoutKey: Object.prototype.hasOwnProperty.call(pages, "/layout"),
      layoutFileCount: pages["/layout"]?.length ?? null,
      pageFileCount: pages["/page"]?.length ?? null,
      firstKeys: Object.keys(pages).slice(0, 6),
    }
  } catch (err) {
    out.appBuildManifest = "unreadable: " + (err instanceof Error ? err.message : String(err))
  }
  try {
    const m = JSON.parse(
      fs.readFileSync(path.join(dist, "server", "app-paths-manifest.json"), "utf8"),
    ) as Record<string, string>
    out.appPathsManifest = {
      totalKeys: Object.keys(m).length,
      rootPage: m["/page"] ?? null,
      hasRootLayout: Object.prototype.hasOwnProperty.call(m, "/layout"),
    }
  } catch (err) {
    out.appPathsManifest = "unreadable: " + (err instanceof Error ? err.message : String(err))
  }
  try {
    out.rootPageJsExists = fs.existsSync(path.join(dist, "server", "app", "page.js"))
  } catch {
    out.rootPageJsExists = "unknown"
  }
  return out
}

export async function GET(request: Request) {
  const headerList = await headers()
  const safeHeaders: Record<string, string | null> = {}
  for (const key of SAFE_HEADER_KEYS) {
    safeHeaders[key] = headerList.get(key)
  }

  const url = new URL(request.url)
  // ?build=1 adds deployed-build introspection (no secrets).
  const buildInfo = url.searchParams.get("build") === "1" ? inspectBuild() : undefined

  return NextResponse.json(
    {
      ok: true,
      requestUrl: {
        pathname: url.pathname,
        search: url.search,
      },
      headers: safeHeaders,
      build: buildInfo,
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    },
  )
}
