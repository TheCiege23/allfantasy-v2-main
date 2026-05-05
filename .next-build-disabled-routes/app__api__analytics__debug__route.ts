import { NextResponse } from 'next/server'

export async function GET() {
  const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || 'G-LY788DCM6K'

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    analytics: {
      gaMeasurementId,
      hasMetaPixelId: Boolean(process.env.NEXT_PUBLIC_META_PIXEL_ID),
      env: process.env.NODE_ENV || 'development',
    },
  })
}
