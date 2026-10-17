import {
  formatPickLabel,
  getSlotInRoundForOverall,
} from "@/lib/live-draft-engine/DraftOrderService";
import { resolvePickOwner } from "@/lib/live-draft-engine/PickOwnershipResolver";
import type {
  DraftType,
  TradedPickRecord,
} from "@/lib/live-draft-engine/types";
import type { PickSlot, TradedAwayPick } from "./draftHq";
type SlotOrderRow = { slot: number; rosterId: string; displayName: string };

export function computePickInventory(input: {
  myRosterId: string;
  slotOrder: readonly SlotOrderRow[];
  tradedPicks: readonly TradedPickRecord[];
  rounds: number;
  teamCount: number;
  draftType: string;
  thirdRoundReversal: boolean;
}): { held: PickSlot[]; tradedAway: TradedAwayPick[] } {
  const { myRosterId, slotOrder, rounds, teamCount } = input;
  const held: PickSlot[] = [];
  const tradedAway: TradedAwayPick[] = [];
  if (teamCount <= 0 || rounds <= 0) return { held, tradedAway };

  // Anything but snake runs in slot order every round, as the old arithmetic had it.
  const draftType: DraftType =
    input.draftType.toLowerCase() === "snake" ? "snake" : "linear";
  const tradedPicks = [...input.tradedPicks];

  for (let overall = 1; overall <= rounds * teamCount; overall += 1) {
    const round = Math.ceil(overall / teamCount);
    const slot = getSlotInRoundForOverall({
      overall,
      teamCount,
      draftType,
      thirdRoundReversal: input.thirdRoundReversal,
    });
    const original = slotOrder.find((e) => e.slot === slot);
    const owner = resolvePickOwner(round, slot, [...slotOrder], tradedPicks);
    if (!original || !owner) continue;

    const label = formatPickLabel(overall, teamCount);
    const pickInRound = ((overall - 1) % teamCount) + 1;
    const wasMine = original.rosterId === myRosterId;
    if (owner.rosterId === myRosterId) {
      held.push({
        round,
        pickInRound,
        overall,
        label,
        // A pick that left and came back is simply yours again.
        acquiredFrom: wasMine
          ? null
          : owner.tradedPickMeta?.previousOwnerName ||
            original.displayName ||
            "another team",
      });
    } else if (wasMine) {
      tradedAway.push({
        round,
        overall,
        label,
        to: owner.displayName || "another team",
      });
    }
  }
  return { held, tradedAway };
}
