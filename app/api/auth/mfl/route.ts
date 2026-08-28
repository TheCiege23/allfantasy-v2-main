import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'

export const POST = withApiUsage({ endpoint: "/api/auth/mfl", tool: "AuthMfl" })(async (req: NextRequest) => {
  try {
    const { username, password, year } = await req.json()
    
    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
    }

    const apiYear = year || new Date().getFullYear()
    
    /*
     * Trades MFL credentials for a session cookie. NOT a data read — Postgres cannot
     * authenticate a user against MyFantasyLeague — so this is a permanent exception
     * rather than debt awaiting a migration, and it carries the auth marker instead of
     * `db-first-exception:`. The mFLConnection row written below is the RESULT of the
     * exchange, and that part IS DB-first.
     */
    const loginUrl = `https://api.myfantasyleague.com/${apiYear}/login` // db-first-auth-exchange: credentials for a session
    const loginRes = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `USERNAME=${encodeURIComponent(username)}&PASSWORD=${encodeURIComponent(password)}&JSON=1`
    })

    const loginData = await loginRes.json()
    
    if (loginData.error || !loginData.status?.MFL_USER_ID) {
      return NextResponse.json({ 
        error: loginData.error?.message || 'Invalid credentials' 
      }, { status: 401 })
    }

    const mflCookie = loginData.status.MFL_USER_ID
    const mflUserId = username

    const sessionId = crypto.randomUUID()
    
    await prisma.mFLConnection.upsert({
      where: { mflUsername: mflUserId },
      update: {
        mflCookie,
        year: apiYear,
        updatedAt: new Date()
      },
      create: {
        sessionId,
        mflUsername: mflUserId,
        mflCookie,
        year: apiYear
      }
    })

    const cookieStore = await cookies()
    cookieStore.set('mfl_session', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30
    })

    return NextResponse.json({
      success: true,
      username: mflUserId,
      year: apiYear
    })

  } catch (error: any) {
    console.error('MFL auth error:', error)
    return NextResponse.json(
      { error: error.message || 'Authentication failed' },
      { status: 500 }
    )
  }
})
