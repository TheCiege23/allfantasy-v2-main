/**
 * Slice 17 — pending Sleeper trades were invisible to AllFantasy.
 *
 * The importer never calls /transactions/, and the league Trades panel read
 * only AfLeagueTrade (AF-native proposals), so a real proposal sitting in a
 * user's Sleeper league rendered as "Active Trades 0" — and no analysis could
 * run on a trade the app had never heard of.
 */
import { describe, expect, it } from "vitest"
import {
  buildTradeAssetsForRoster,
  isPendingTradeStatus,
} from "@/lib/provider-trades/scanPendingSleeperTrades"

const players = {
  p1: { full_name: "C.J. Stroud", position: "QB", team: "HOU" },
  p2: { first_name: "Pat", last_name: "Bryant", position: "WR", team: "DEN" },
}

describe("isPendingTradeStatus", () => {
  it("accepts every spelling Sleeper uses for an open offer", () => {
    for (const s of ["pending", "PENDING", "proposed", "waiting", "requested"]) {
      expect(isPendingTradeStatus(s), s).toBe(true)
    }
  })

  it("rejects completed and unknown states (those are history, not offers)", () => {
    for (const s of ["complete", "failed", "vetoed", "", null, undefined]) {
      expect(isPendingTradeStatus(s as string), String(s)).toBe(false)
    }
  })
})

describe("buildTradeAssetsForRoster", () => {
  it("splits players by direction from the viewer's perspective", () => {
    // Viewer is roster 1: sends Stroud, receives Bryant.
    const result = buildTradeAssetsForRoster({
      tx: { drops: { p1: 1 }, adds: { p2: 1 }, draft_picks: [] },
      userRosterId: 1,
      players,
    })
    expect(result.assetsGiven.map((a) => a.playerName)).toEqual(["C.J. Stroud"])
    expect(result.assetsReceived.map((a) => a.playerName)).toEqual(["Pat Bryant"])
    expect(result.assetsGiven[0]!.position).toBe("QB")
  })

  it("mirrors correctly for the OTHER roster in the same trade", () => {
    const result = buildTradeAssetsForRoster({
      tx: { drops: { p1: 1 }, adds: { p2: 1 }, draft_picks: [] },
      userRosterId: 2,
      players,
    })
    // Roster 2 is uninvolved in these particular adds/drops.
    expect(result.assetsGiven).toEqual([])
    expect(result.assetsReceived).toEqual([])
  })

  it("assigns draft picks to the RECEIVING roster and debits the previous owner", () => {
    const tx = {
      drops: {},
      adds: {},
      draft_picks: [{ season: "2027", round: 1, roster_id: 2, previous_owner_id: 1 }],
    }
    const receiver = buildTradeAssetsForRoster({ tx: tx as never, userRosterId: 2, players })
    expect(receiver.assetsReceived[0]!.isPick).toBe(true)
    expect(receiver.assetsReceived[0]!.pickRound).toBe("2027 1st")
    expect(receiver.assetsGiven).toEqual([])

    // The roster giving the pick up must see it as an outgoing asset — the
    // original dashboard logic only ever credited the receiver, so the sender's
    // side of a pick trade silently showed as empty.
    const sender = buildTradeAssetsForRoster({ tx: tx as never, userRosterId: 1, players })
    expect(sender.assetsGiven[0]!.pickRound).toBe("2027 1st")
    expect(sender.assetsReceived).toEqual([])
  })

  it("uses ordinal suffixes correctly", () => {
    const rounds = [1, 2, 3, 4].map(
      (round) =>
        buildTradeAssetsForRoster({
          tx: { drops: {}, adds: {}, draft_picks: [{ season: "2027", round, roster_id: 1 }] } as never,
          userRosterId: 1,
          players,
        }).assetsReceived[0]!.pickRound,
    )
    expect(rounds).toEqual(["2027 1st", "2027 2nd", "2027 3rd", "2027 4th"])
  })

  it("handles a trade with no assets on either side without throwing", () => {
    const result = buildTradeAssetsForRoster({
      tx: { drops: {}, adds: {}, draft_picks: [] },
      userRosterId: 1,
      players,
    })
    expect(result.assetsGiven).toEqual([])
    expect(result.assetsReceived).toEqual([])
  })

  it("falls back to the raw id when a player is missing from the pool", () => {
    const result = buildTradeAssetsForRoster({
      tx: { drops: { unknown99: 1 }, adds: {}, draft_picks: [] },
      userRosterId: 1,
      players,
    })
    expect(result.assetsGiven[0]!.playerName).toBe("unknown99")
    expect(result.assetsGiven[0]!.position).toBe("—")
  })
})
