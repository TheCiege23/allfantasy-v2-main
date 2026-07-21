import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getOrComputeManagerDNA, getCachedDNA } from '@/lib/manager-dna'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

const PostSchema = z.object({
  sleeper_username: z.string().min(1).max(40),
  league_ids: z.array(z.string().min(1)).min(1).max(10),
  force_refresh: z.boolean().optional().default(false),
})

export const POST = withApiUsage({ endpoint: "/api/legacy/manager-dna", tool: "LegacyManagerDna" })(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const parsed = PostSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const { league_ids, force_refresh } = parsed.data

    /*
     * Was `requireAuthOrOrigin`, which returns authenticated:true with a null user for any
     * caller that sets an Origin header — so this compute-intensive profiler was open, and
     * profiled whatever username the body named. Parse first so there is a single 403 path
     * comparing the body's username against the caller's own link.
     */
    const gate = await requireLegacySleeperIdentity(req, {
      requestedUsername: parsed.data.sleeper_username,
      rateLimit: { action: 'manager_dna', maxRequests: 5, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response

    const profile = await getOrComputeManagerDNA(gate.identity.sleeperUsername, league_ids, force_refresh)

    return NextResponse.json({
      ok: true,
      profile,
    })
  } catch (error) {
    console.error('Manager DNA error:', error)
    return NextResponse.json(
      { error: 'Failed to compute manager DNA profile' },
      { status: 500 },
    )
  }
})

const GetSchema = z.object({
  username: z.string().min(1).max(40),
})

export const GET = withApiUsage({ endpoint: "/api/legacy/manager-dna", tool: "LegacyManagerDna" })(async (req: NextRequest) => {
  const url = new URL(req.url)
  const parsed = GetSchema.safeParse({ username: url.searchParams?.get('username') })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Missing username parameter' }, { status: 400 })
  }

  // `?username=` named whoever the caller liked; it is now only compared, never read from.
  const gate = await requireLegacySleeperIdentity(req, {
    requestedUsername: parsed.data.username,
    rateLimit: { action: 'manager_dna_get', maxRequests: 30, windowMs: 60_000 },
  })
  if (!gate.ok) return gate.response

  try {
    const profile = await getCachedDNA(gate.identity.sleeperUsername)

    if (!profile) {
      return NextResponse.json(
        { ok: false, error: 'No DNA profile found. Compute one first via POST.' },
        { status: 404 },
      )
    }

    return NextResponse.json({
      ok: true,
      profile,
    })
  } catch (error) {
    console.error('Manager DNA GET error:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve manager DNA profile' },
      { status: 500 },
    )
  }
})

