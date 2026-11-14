import type { IExternalScoringMapper } from '../../mappers/ExternalScoringMapper'
import type { SleeperImportPayload } from './types'

export const SleeperScoringMapper: IExternalScoringMapper<SleeperImportPayload> = {
  map(source) {
    const settings = source.league?.scoring_settings
    if (!settings || typeof settings !== 'object') return null
    const rules = Object.entries(settings).map(([stat_key, points_value]) => ({
      stat_key,
      points_value: Number(points_value),
    }))
    return {
      scoring_format: 'custom',
      rules,
      raw: settings as Record<string, unknown>,
    }
  },
}
