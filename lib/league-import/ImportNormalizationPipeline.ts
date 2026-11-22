import { resolveProvider } from './ImportProviderResolver'
import { getAdapter } from './LeagueImportRegistry'
import type { NormalizedImportResult } from './types'
import type { ImportProvider } from './types'
import { DefaultExternalIdentityMapper } from './mappers/DefaultExternalIdentityMapper'

interface PipelineInput {
  provider: ImportProvider | string
  raw: unknown
}

/**
 * Single entry point: resolve provider, get adapter, normalize raw payload to AF-shaped result.
 * Does not create leagues or persist; use output with league creation or legacy transfer flow.
 */
export async function runImportNormalizationPipeline(input: PipelineInput): Promise<NormalizedImportResult> {
  const provider = typeof input.provider === 'string' ? resolveProvider(input.provider) : input.provider
  if (!provider) throw new Error(`Unsupported import provider: ${input.provider}`)
  const adapter = getAdapter(provider)
  const normalized = await adapter.normalize(input.raw)
  if (!normalized.identity_mappings || normalized.identity_mappings.length === 0) {
    const identityMappings = DefaultExternalIdentityMapper.buildMappings?.(provider, {
      source: normalized.source,
      rosters: normalized.rosters,
      player_map: normalized.player_map,
    })
    if (identityMappings && identityMappings.length > 0) {
      return {
        ...normalized,
        identity_mappings: identityMappings,
      }
    }
  }
  return normalized
}
