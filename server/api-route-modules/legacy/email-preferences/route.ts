import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isUndeliverableEmailDomain } from '@/lib/email/undeliverableDomains'
import { sendTradeAlertConfirmationEmail } from '@/lib/resend-client'

export const POST = withApiUsage({ endpoint: "/api/legacy/email-preferences", tool: "LegacyEmailPreferences" })(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const email = String(body.email || '').trim().toLowerCase()
    const sleeperUsername = String(body.sleeper_username || '').trim()
    const tradeAlerts = body.trade_alerts !== false

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
    }

    // Check if user is in early access list
    const earlyAccess = await prisma.earlyAccessSignup.findUnique({
      where: { email },
    })

    /*
     * If not on early access list, add them automatically.
     *
     * ⚠ THE THIRD WRITER TO EarlyAccessSignup, AND THE EASIEST TO MISS. The
     * other two live under `app/api/`; this one is a route MODULE under
     * `server/`, so an audit scoped to `app/` reports the table fully guarded
     * when it is not. It is public, unauthenticated, and adds ANY address it is
     * handed, which makes it a wide-open path onto the marketing list.
     *
     * Same reserved-domain guard as the other two — see
     * lib/email/undeliverableDomains.ts for why this is not an env check.
     * Preferences are still saved below: a test can still exercise the endpoint
     * end to end, it just does not land on a list we might one day email.
     */
    let wasAddedToEarlyAccess = false
    if (!earlyAccess && !isUndeliverableEmailDomain(email)) {
      await prisma.earlyAccessSignup.create({
        data: {
          email,
          source: 'trade_alerts',
        },
      })
      wasAddedToEarlyAccess = true
    }

    // Find legacy user if sleeper username provided
    let legacyUserId: string | null = null
    if (sleeperUsername) {
      const user = await prisma.legacyUser.findUnique({
        where: { sleeperUsername },
      })
      if (user) {
        legacyUserId = user.id
      }
    }

    // Check if user already has trade alerts enabled
    const existingPref = await prisma.emailPreference.findUnique({
      where: { email },
    })
    const wasAlreadyEnabled = existingPref?.tradeAlerts === true

    // Upsert email preference
    const emailPref = await prisma.emailPreference.upsert({
      where: { email },
      update: {
        legacyUserId: legacyUserId || undefined,
        sleeperUsername: sleeperUsername || undefined,
        tradeAlerts,
        unsubscribedAt: null,
        updatedAt: new Date(),
      },
      create: {
        email,
        legacyUserId,
        sleeperUsername: sleeperUsername || null,
        tradeAlerts,
        productUpdates: true,
      },
    })

    // Send confirmation email if newly enabling trade alerts
    if (tradeAlerts && !wasAlreadyEnabled) {
      try {
        await sendTradeAlertConfirmationEmail(email, sleeperUsername || 'Fantasy Manager')
      } catch (e) {
        console.error('Failed to send trade alert confirmation email:', e)
      }
    }

    return NextResponse.json({
      success: true,
      tradeAlerts: emailPref.tradeAlerts,
      message: wasAddedToEarlyAccess 
        ? 'You\'ve been added to Early Access and trade alerts are now enabled!'
        : 'Email preferences saved! You\'ll receive trade alerts when new trades are analyzed.',
      confirmationSent: tradeAlerts && !wasAlreadyEnabled,
      addedToEarlyAccess: wasAddedToEarlyAccess,
    })
  } catch (e) {
    console.error('email-preferences error', e)
    return NextResponse.json({ error: 'Failed to save preferences' }, { status: 500 })
  }
})

export const GET = withApiUsage({ endpoint: "/api/legacy/email-preferences", tool: "LegacyEmailPreferences" })(async (req: NextRequest) => {
  try {
    const email = req.nextUrl.searchParams?.get('email')
    const sleeperUsername = req.nextUrl.searchParams?.get('sleeper_username')

    if (!email && !sleeperUsername) {
      return NextResponse.json({ error: 'Email or sleeper_username required' }, { status: 400 })
    }

    const emailPref = await prisma.emailPreference.findFirst({
      where: {
        OR: [
          email ? { email: email.toLowerCase() } : {},
          sleeperUsername ? { sleeperUsername } : {},
        ].filter((o) => Object.keys(o).length > 0),
      },
    })

    if (!emailPref) {
      return NextResponse.json({ found: false })
    }

    return NextResponse.json({
      found: true,
      email: emailPref.email,
      tradeAlerts: emailPref.tradeAlerts,
      weeklyDigest: emailPref.weeklyDigest,
      productUpdates: emailPref.productUpdates,
    })
  } catch (e) {
    console.error('email-preferences GET error', e)
    return NextResponse.json({ error: 'Failed to get preferences' }, { status: 500 })
  }
})

