import { resolveCollegeTeam, type CollegeTeamIndex, type CollegeTeamRecord } from './collegeTeamIdentity'

/** Fantrax CFB abbreviations, scoped to this provider so short aliases cannot leak into other feeds. */
const SCHOOLS: Record<string, string> = {
  wisc: 'Wisconsin', kan: 'Kansas', okla: 'Oklahoma', sacst: 'Sacramento State',
  missst: 'Mississippi State', soal: 'South Alabama', sofl: 'South Florida',
  ud: 'Delaware', rut: 'Rutgers', midtn: 'Middle Tennessee', miaoh: 'Miami (OH)',
  scar: 'South Carolina', ind: 'Indiana', nw: 'Northwestern', txam: 'Texas A&M', app: 'App State',
}

export function resolveFantraxCollegeTeam(team: string, index: CollegeTeamIndex): CollegeTeamRecord | null {
  const school = SCHOOLS[team.trim().toLowerCase()]
  return resolveCollegeTeam(school ?? team, index)
}
