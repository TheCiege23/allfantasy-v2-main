/**
 * Learning hooks — persist via Prisma / events; used as light tie-breakers only.
 */

export interface ManagerTendencyProfile {
  managerId: string
  earlyReachRate: number
  lateValueRate: number
  positionRunParticipation: number
}

