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
