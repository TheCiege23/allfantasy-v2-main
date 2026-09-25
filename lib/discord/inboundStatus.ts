/**
 * Is Discord → AllFantasy ("two-way") actually running on a schedule?
 *
 * 🛑 FALSE ON PURPOSE, AND IT IS THE HONESTY SWITCH FOR THE WHOLE FEATURE.
 * `runDiscordInboundPass` (lib/discord/inboundPass.ts) exists, but nothing calls it on
 * a schedule: `/api/discord/poll-messages` is not in the cron registry, and the
 * registry is at its ceiling. Until the pass rides an existing frequent cron (the way
 * `/api/cron/alert-sweep` hosts the lineup and waiver checks), a "two-way" switch
 * would be a control that silently does nothing — so every screen reads this and
 * shows two-way as "not available yet".
 *
 * Flip it in the SAME commit that wires the host cron, never before. Its own module so
 * a screen can read it without importing the chat service the pass needs.
 */
export const DISCORD_INBOUND_SCHEDULED: boolean = false
