/**
 * POST /api/simulation-lab/season — Simulation Lab sandbox (season). Called by app/app/simulation-lab/page.tsx.
 * The handler (auth, validation, rate limit) lives in server/api-route-modules/simulation-lab/handlers.ts.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export { seasonPOST as POST } from '@/server/api-route-modules/simulation-lab/handlers'
