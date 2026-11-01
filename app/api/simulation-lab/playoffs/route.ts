/**
 * POST /api/simulation-lab/playoffs — Simulation Lab sandbox (playoffs). Called by app/app/simulation-lab/page.tsx.
 * The handler (auth, validation, rate limit) lives in server/api-route-modules/simulation-lab/handlers.ts.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export { playoffsPOST as POST } from '@/server/api-route-modules/simulation-lab/handlers'
