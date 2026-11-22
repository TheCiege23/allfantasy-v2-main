import { NextResponse } from 'next/server'
import { hasDatabaseUrl } from '@/lib/env/database-url'
import { validateProductionEnv, type EnvFeatureStatus } from '@/lib/env/validateProductionEnv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || 'G-LY788DCM6K'

  let database: { configured: boolean; connected: boolean; error?: string } = {
    configured: hasDatabaseUrl(process.env),
    connected: false,
  }

  // Only load Prisma when a URL exists — otherwise `@/lib/prisma` throws at import time.
  if (database.configured) {
    try {
      const { prisma } = await import('@/lib/prisma')
      await prisma.$queryRaw`SELECT 1`
      database = { ...database, connected: true }
    } catch (e) {
      // This route is public: a Prisma message names the database host ("Can't reach database
      // server at <host>:5432"). Keep the detail in the server log, not the response.
      console.error('[health] database check failed:', e instanceof Error ? e.message.slice(0, 500) : e)
      database = { ...database, connected: false, error: 'query_failed' }
    }
  }

  // Env validation — expose validity + feature flags (no error text in response).
  let envStatus: { valid: boolean; errorCount: number; features: EnvFeatureStatus } = {
    valid: false,
    errorCount: -1,
    features: {
      redis: false,
      redisFull: false,
      sentry: false,
      aiProviders: false,
      email: false,
      stripe: false,
    },
  }
  try {
    const result = validateProductionEnv()
    envStatus = {
      valid: result.valid,
      errorCount: result.errors.length,
      features: result.features,
    }
  } catch {
    // Non-fatal — health check must always respond
  }

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    database,
    env: envStatus,
    analytics: {
      gaMeasurementId,
      hasMetaPixelId: Boolean(process.env.NEXT_PUBLIC_META_PIXEL_ID),
      env: process.env.NODE_ENV || 'development',
    },
  })
}
