import { readFileSync } from "node:fs"
import path from "node:path"
import { NextResponse } from "next/server"

/**
 * Returns the build / deploy marker so we can verify which commit Railway is
 * actually running. Surfaces:
 *   - The `BUILD_SHA` env (set by Railway → Variables → `BUILD_SHA=${{RAILWAY_GIT_COMMIT_SHA}}`)
 *     when configured.
 *   - The `RAILWAY_GIT_COMMIT_SHA` env (auto-injected by Railway).
 *   - The Vercel commit SHA when running on Vercel.
 *   - `process.env.NEXT_PUBLIC_BUILD_SHA` (compile-time baked) as a last-resort
 *     fallback for any custom CI pipeline.
 *
 * No secrets are returned. Cache-Control is `no-store` so refreshes always show
 * the current deploy.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * The Next build id this server is ACTUALLY serving, read from the built `BUILD_ID` file.
 *
 * `lib/core-app/deployGuard` compares it across deployments: when it has not changed, a
 * background `router.refresh()` stays a soft update instead of a full page reload. It is read
 * from disk rather than repeated as a constant so the guard never trusts a pin that did not
 * take effect. `undefined` = not read yet; `null` = no file (`next dev`), which the guard
 * treats as "cannot say".
 */
let cachedBuildId: string | null | undefined
function readBuildId(): string | null {
  if (cachedBuildId !== undefined) return cachedBuildId
  try {
    const distDir = process.env.AF_NEXT_DIST_DIR || ".next"
    cachedBuildId = readFileSync(path.join(process.cwd(), distDir, "BUILD_ID"), "utf8").trim() || null
  } catch {
    cachedBuildId = null
  }
  return cachedBuildId
}

export async function GET() {
  const sha =
    process.env.BUILD_SHA ||
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_BUILD_SHA ||
    null

  return NextResponse.json(
    {
      ok: true,
      sha,
      capabilities: { bigBrotherDeadlines: 1 },
      shortSha: sha ? sha.slice(0, 9) : null,
      branch:
        process.env.RAILWAY_GIT_BRANCH ||
        process.env.VERCEL_GIT_COMMIT_REF ||
        null,
      deploymentId:
        process.env.RAILWAY_DEPLOYMENT_ID ||
        process.env.VERCEL_DEPLOYMENT_ID ||
        null,
      buildId: readBuildId(),
      nodeEnv: process.env.NODE_ENV || null,
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
