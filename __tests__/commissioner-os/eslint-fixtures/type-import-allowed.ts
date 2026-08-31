// FIXTURE — must NOT be reported. A type import erases at compile time and
// creates no runtime dependency; banning it would force a hand-written
// duplicate of a generated type for no benefit.
import type { League } from '@prisma/client'
export type L = League
