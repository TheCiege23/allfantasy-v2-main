/**
 * Is Discord → AllFantasy ("two-way") actually running on a schedule?
 *
 * `runDiscordInboundPass` is called by the authenticated five-minute
 * `/api/cron/notification-outbox-relay` schedule. Only commissioner-opted
 * `league_chat` channels with `syncInbound` enabled are read. This flag stays
 * coupled to that caller so a two-way switch never silently does nothing.
 *
 * Flip it in the SAME commit that wires the host cron, never before. Its own module so
 * a screen can read it without importing the chat service the pass needs.
 */
export const DISCORD_INBOUND_SCHEDULED: boolean = true
