/**
 * "Suspicious trade alerts": whether the commissioner is pinged when the collusion check flags a
 * settled trade. The check itself always runs and its flags are always on the integrity review page;
 * this only decides the alert. Stored in League.settings (no migration); absent = on, which is what
 * every league did before the switch existed.
 *
 * (`LeagueIntegritySettings.collusionMonitoringEnabled` is NOT this: it is named for monitoring, no
 * engine reads it, and monitoring is deliberately not optional.)
 */
export const TRADE_ALERTS_KEY = 'integrity_trade_alerts'

export function readTradeAlertsEnabled(settings: unknown): boolean {
  const v = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[TRADE_ALERTS_KEY] : undefined
  return v !== false
}
