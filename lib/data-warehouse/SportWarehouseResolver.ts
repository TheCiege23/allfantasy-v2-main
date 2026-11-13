/**
 * SportWarehouseResolver — sport-safe resolution for warehouse reads/writes.
 * Ensures sport-specific data is normalized without mixing incompatible structures.
 */

import { WAREHOUSE_SPORTS, type WarehouseSport } from './types'

/**
 * Returns whether the warehouse can store/query data for this sport.
 */
export function isSportSupported(sport: string): boolean {
  const u = sport?.toUpperCase?.() ?? ''
  return WAREHOUSE_SPORTS.includes(u as WarehouseSport)
}

