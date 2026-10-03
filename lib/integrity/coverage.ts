import { resolveWriteAuthority } from '@/lib/league/write-authority'

export type IntegrityScanStatus = 'unsupported' | 'disabled' | 'never_scanned' | 'scanned'

export type IntegrityCoverage = {
  collusion: { status: IntegrityScanStatus; lastScannedAt: string | null }
  tanking: { status: IntegrityScanStatus; lastScannedAt: string | null }
}

/** A scan timestamp proves that a scan ran, not that every event was covered. */
export function buildIntegrityCoverage(input: {
  platform: string | null
  hasNativeRedraftSeason: boolean
  tankingEnabled: boolean
  lastCollusionScanAt: Date | null
  lastTankingScanAt: Date | null
}): IntegrityCoverage {
  const supported = resolveWriteAuthority(input.platform) === 'NATIVE' && input.hasNativeRedraftSeason
  const one = (enabled: boolean, at: Date | null): IntegrityCoverage['collusion'] => ({
    status: !supported ? 'unsupported' : !enabled ? 'disabled' : !at ? 'never_scanned' : 'scanned',
    lastScannedAt: at?.toISOString() ?? null,
  })
  return {
    // Collusion scanning is triggered by trade acceptance; the legacy setting
    // column does not gate the engine and must not be presented as an off switch.
    collusion: one(true, input.lastCollusionScanAt),
    tanking: one(input.tankingEnabled, input.lastTankingScanAt),
  }
}
