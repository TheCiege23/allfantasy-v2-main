/**
 * 🛑 What a War Room trade analysis may NOT show (2026-09-29): a number on the War Room's own value
 * scale ("Value in 22.0 vs value out 11.0 (delta +11)", a pick "(tier 8.5)"), or any mention of its
 * private verdict ("verdict unavailable", "verdict weighted by …"). The verdict on every War Room is the
 * one grade (lib/decision-os/trade/warRoomTradeGrade.ts). Shared by the five War Room engine suites.
 */
export const WAR_ROOM_PRIVATE_SCALE = /value in -?[\d.]+|vs (?:value )?out -?[\d.]+|\(delta [+-]?[\d.]+\)|\(tier [\d.]+\)|value delta|verdict/i
