/**
 * Chimmy (@chimmy) — Zombie action intents for DM / league chat.
 * Keyword parsing + persistence: `lib/zombie/chimmy-zombie-persist.ts` → `zombie_chimmy_actions`.
 * Item execution / audits remain in the game engine.
 */
export type ZombieChimmyIntent =
  | 'use_serum'
  | 'use_weapon'
  | 'declare_bomb'
  | 'trigger_ambush'
  | 'query_inventory'
  | 'query_role'
  | 'query_rules'
  | 'query_week_state'
  | 'query_item_validity'
  | 'query_trade_validity'

