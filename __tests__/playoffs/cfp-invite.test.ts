import { describe, expect, it } from "vitest"
import { cfpInviteChallengeId, cfpInviteCode, isPrivateCfpPool, verifyCfpInvite } from "@/lib/playoffs/cfpInvite"

describe("secure CFP invitations", () => {
  const secret = "test-only-authentication-secret-at-least-32-characters"
  it("signs a pool-specific code, supports case-insensitive entry and rejects tampering", () => {
    const code = cfpInviteCode("cmw79xpf10008wmae48wlfp85", secret)
    expect(cfpInviteChallengeId(code)).toBe("cmw79xpf10008wmae48wlfp85")
    expect(verifyCfpInvite("cmw79xpf10008wmae48wlfp85", code.toLowerCase(), secret)).toBe(true)
    expect(verifyCfpInvite("differentpool", code, secret)).toBe(false)
    expect(verifyCfpInvite("cmw79xpf10008wmae48wlfp85", `${code.slice(0, -1)}${code.endsWith("0") ? "1" : "0"}`, secret)).toBe(false)
    expect(verifyCfpInvite("cmw79xpf10008wmae48wlfp85", code, "wrong-secret")).toBe(false)
    expect(verifyCfpInvite("cmw79xpf10008wmae48wlfp85", "CMW79XPF", secret)).toBe(false)
  })
  it("fails closed without a signing secret and protects legacy private CFP pools", () => {
    expect(() => cfpInviteCode("pool", "")).toThrow(/unavailable/)
    expect(verifyCfpInvite("pool", "anything", "")).toBe(false)
    expect(isPrivateCfpPool("ncaaf", null)).toBe(true)
    expect(isPrivateCfpPool("ncaaf", { visibility: "public" })).toBe(false)
    expect(isPrivateCfpPool("nba_cup", null)).toBe(false)
  })
})
