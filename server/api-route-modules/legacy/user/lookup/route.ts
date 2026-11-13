import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { validateRequestOrigin, forbiddenResponse } from '@/lib/api-auth'
import { getSleeperUser } from '@/lib/sleeper-client'
import { withApiUsage } from '@/lib/telemetry/usage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  username: z.string().min(1).max(100),
})

export const POST = withApiUsage({ endpoint: '/api/legacy/user/lookup', tool: 'LegacyUserLookup' })(
  async (request: NextRequest) => {
    /*
     * DELIBERATELY ORIGIN-ONLY. This resolves a handle against Sleeper's PUBLIC user endpoint
     * and returns only the public profile fields Sleeper itself serves to anyone; it reads no
     * AllFantasy row and keys nothing to a user. It is also the first step of the import /
     * guest-import flow, before any session exists, so requiring one would make onboarding
     * impossible. It used `requireAuthOrOrigin`, which behaves identically but reads as
     * authentication; it is spelled as what it is -- a CSRF / same-site check.
     */
    if (!validateRequestOrigin(request)) {
      return forbiddenResponse('Invalid request origin')
    }

    const body = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid input',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const username = parsed.data.username.trim()
    const user = await getSleeperUser(username)
    if (!user?.user_id) {
      return NextResponse.json({ error: 'Sleeper user not found' }, { status: 404 })
    }

    return NextResponse.json({
      user_id: user.user_id,
      username: user.username,
      display_name: user.display_name,
      avatar: user.avatar,
    })
  }
)
