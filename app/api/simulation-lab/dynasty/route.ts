/**
 * POST /api/simulation-lab/dynasty — Simulation Lab sandbox (dynasty). Called by app/app/simulation-lab/page.tsx.
 * The handler (auth, validation, rate limit) lives in server/api-route-modules/simulation-lab/handlers.ts.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export { dynastyPOST as POST } from '@/server/api-route-modules/simulation-lab/handlers'
