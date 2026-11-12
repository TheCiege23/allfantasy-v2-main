import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { runMonteCarloSimulation, saveSimulationRun, getSimulationHistory, SimulationScenario } from '@/lib/simulation-engine'
import { validateRequestOrigin, forbiddenResponse } from '@/lib/api-auth'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { checkMilestoneBadges } from '@/lib/badge-engine'
import { prisma } from '@/lib/prisma'

export const GET = withApiUsage({ endpoint: "/api/legacy/simulations", tool: "LegacySimulations" })(async (request: NextRequest) => {
  /*
   * Was `requireAuthOrOrigin` (passes anonymous callers with a matching `Origin` header) and
   * then returned the simulation history of whatever `username` was named. The param is now
   * only compared; the history is the caller's own.
   */
  const { searchParams } = new URL(request.url)
  const gate = await requireLegacySleeperIdentity(request, {
    allowGuest: true,
    requestedUsername: searchParams?.get('username'),
  })
  if (!gate.ok) return gate.response
  const username = gate.identity.sleeperUsername

  try {
    const history = await getSimulationHistory(username, 10)
    return NextResponse.json({ simulations: history, count: history.length })
  } catch (error) {
    console.error('Failed to fetch simulation history:', error)
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 })
  }
})

export const POST = withApiUsage({ endpoint: "/api/legacy/simulations", tool: "LegacySimulations" })(async (request: NextRequest) => {
  // CSRF protection for a state-changing call -- legitimate, but NOT authentication.
  if (!validateRequestOrigin(request)) return forbiddenResponse('Invalid request origin')

  const ip = getClientIp(request)
  const rateLimitResult = consumeRateLimit({
    scope: 'legacy',
    action: 'simulation_run',
    ip,
    maxRequests: 5,
    windowMs: 60000,
  })

  if (!rateLimitResult.success) {
    return NextResponse.json({
      error: 'Rate limited. Please wait before trying again.',
      retryAfter: rateLimitResult.retryAfterSec,
    }, { status: 429 })
  }

  try {
    const body = await request.json()
    const { leagueId, scenario, iterations = 1000 } = body

    // Writes a SimulationRun and milestone badges for `username` -- the caller's own only.
    const gate = await requireLegacySleeperIdentity(request, {
      allowGuest: true,
      requestedUsername: typeof body?.username === 'string' ? body.username : null,
    })
    if (!gate.ok) return gate.response
    const username = gate.identity.sleeperUsername

    if (!scenario) {
      return NextResponse.json({ error: 'Username and scenario required' }, { status: 400 })
    }

    const simScenario: SimulationScenario = {
      type: scenario.type || 'trade',
      description: scenario.description || 'Trade simulation',
      assets: {
        giving: (scenario.giving || []).map((a: any) => ({
          name: a.name || 'Unknown',
          position: a.position || 'Unknown',
          value: a.value || 500,
        })),
        receiving: (scenario.receiving || []).map((a: any) => ({
          name: a.name || 'Unknown',
          position: a.position || 'Unknown',
          value: a.value || 500,
        })),
      },
      leagueContext: scenario.leagueContext,
      weatherImpact: scenario.weatherImpact,
    }

    const clampedIterations = Math.min(Math.max(iterations, 100), 10000)
    const result = runMonteCarloSimulation(simScenario, clampedIterations)

    const simId = await saveSimulationRun(
      username,
      username,
      leagueId,
      simScenario,
      result
    )

    const simCount = await prisma.simulationRun.count({ where: { userId: username } })
    const newBadges = await checkMilestoneBadges(username, username, 'simulation', simCount)

    return NextResponse.json({
      simulationId: simId,
      result,
      newBadges: newBadges.length > 0 ? newBadges : undefined,
    })
  } catch (error) {
    console.error('Simulation failed:', error)
    return NextResponse.json({ error: 'Simulation failed' }, { status: 500 })
  }
})

