import { createHash } from "crypto"

function h(s: string) {
  return createHash("sha256").update(s).digest("hex").slice(0, 32)
}

function worldCupEventKey(
  challengeId: string,
  parts: (string | number | null | undefined)[]
) {
  return h([challengeId, ...parts.map((p) => String(p ?? ""))].join("|"))
}

export const worldCupIdempotencyKeys = {
  challengeCreated: (challengeId: string) => worldCupEventKey(challengeId, ["create"]),
  userJoined: (challengeId: string, userId: string) =>
    worldCupEventKey(challengeId, ["join", userId]),
  entryCreated: (challengeId: string, entryId: string) =>
    worldCupEventKey(challengeId, ["entry", entryId]),
  bracketCompleted: (challengeId: string, entryId: string) =>
    worldCupEventKey(challengeId, ["complete", entryId]),
  bracketLocked: (challengeId: string) => worldCupEventKey(challengeId, ["locked"]),
  match: (challengeId: string, matchId: string, phase: string) =>
    worldCupEventKey(challengeId, ["match", matchId, phase]),
  upset: (challengeId: string, matchId: string, kind: string) =>
    worldCupEventKey(challengeId, ["upset", matchId, kind]),
  championBust: (challengeId: string, entryId: string, matchId: string) =>
    worldCupEventKey(challengeId, ["champ_bust", entryId, matchId]),
  firstPlace: (challengeId: string, entryId: string) =>
    worldCupEventKey(challengeId, ["first", entryId]),
  leadChange: (challengeId: string, from: string | null, to: string) =>
    worldCupEventKey(challengeId, ["lead", from ?? "none", to]),
  perfectRound: (challengeId: string, entryId: string, round: string) =>
    worldCupEventKey(challengeId, ["perfect", entryId, round]),
  noPerfect: (challengeId: string, round: string) =>
    worldCupEventKey(challengeId, ["no_perfect", round]),
  championAlive: (challengeId: string, count: number) =>
    worldCupEventKey(challengeId, ["champ_alive", count]),
  lockReminder: (challengeId: string, bucket: string) =>
    worldCupEventKey(challengeId, ["lock_rem", bucket]),
  /** One post per reminder window per challenge lock time (minute fingerprint). */
  lockReminderWindow: (
    challengeId: string,
    windowKey: string,
    lockAtMinuteFingerprint: string
  ) =>
    worldCupEventKey(challengeId, ["lr_win", windowKey, lockAtMinuteFingerprint]),
}
