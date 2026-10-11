import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { validateWeeklyTask } from '@/lib/core-app/commissionerWeeklyPlan'
import { prisma } from '@/lib/prisma'
import { reconcileLeagueTasks,readLeagueTasks } from '@/lib/commissioner-workspace/taskStore'
export const dynamic='force-dynamic'
async function handle(req:Request){
  const session=await getServerSession(authOptions as never) as {user?:{id?:string}}|null,userId=session?.user?.id
  if(!userId)return NextResponse.json({error:'Unauthorized'},{status:401})
  const leagueId=new URL(req.url).searchParams.get('league')??''
  try{await assertCommissioner(leagueId,userId)}catch{return NextResponse.json({error:'Commissioner only'},{status:403})}
  if(req.method==='GET'){
    await reconcileLeagueTasks(leagueId)
    return NextResponse.json({tasks:(await readLeagueTasks(leagueId)).filter(t=>t.sourceKey.startsWith('operational:')||t.sourceKey.startsWith('weekly:')),checkedAt:new Date().toISOString()},{headers:{'Cache-Control':'private, no-store'}})
  }
  let body:Record<string,unknown>
  try{body=await req.json()}catch{return NextResponse.json({error:'Invalid JSON'},{status:400})}
  if(!body||typeof body!=='object'||Array.isArray(body))return NextResponse.json({error:'Invalid task'},{status:400})
  if(req.method==='POST'){
    const task=validateWeeklyTask(body)
    if(!task || (task.issueId && !task.issueId.startsWith(`${leagueId}:`)))return NextResponse.json({error:'Invalid weekly task'},{status:400})
    const saved=await prisma.$transaction(async tx=>{
      if(!await isCommissioner(leagueId,userId,tx))return null
      const sourceKey=`weekly:task:${task.requestId}`
      const created=await tx.commissionerWorkspaceTask.createMany({data:[{
        leagueId,sourceKey,title:task.title,description:task.description,dueAt:task.dueAt,
        priority:'standard',status:'open',automationCandidate:false,
        relatedLinks:[{label:'Your Week',moduleId:'week',href:`/core/week?league=${encodeURIComponent(leagueId)}${task.issueId ? `#weekly-issue-${encodeURIComponent(task.issueId)}` : ''}`}],
      }],skipDuplicates:true})
      const row=await tx.commissionerWorkspaceTask.findFirst({where:{leagueId,sourceKey}})
      if(created.count&&row)await tx.leagueAuditLog.create({data:{leagueId,userId,actionType:'workspace.weekly_task_created',entityType:'workspace_task',entityId:row.id,afterState:{title:task.title,status:'open'},metadata:{source:'reviewed-weekly-plan'}}})
      return row
    })
    if(!saved)return NextResponse.json({error:'Commissioner only'},{status:403})
    return NextResponse.json({saved:true,id:saved.id},{headers:{'Cache-Control':'private, no-store'}})
  }
  const statuses=['open','in_progress','waiting_on_manager','waiting_on_league_vote','completed','archived']
  if(typeof body.id!=='string'||typeof body.expectedStatus!=='string'||typeof body.expectedUpdatedAt!=='string'||!Number.isFinite(Date.parse(body.expectedUpdatedAt))||typeof body.status!=='string'||!statuses.includes(body.status))return NextResponse.json({error:'Invalid task update'},{status:400})
  const updated=await prisma.$transaction(async tx=>{
    if(!await isCommissioner(leagueId,userId,tx))return 'forbidden' as const
    const task=await tx.commissionerWorkspaceTask.findFirst({where:{id:body.id as string,leagueId},select:{title:true}})
    const count=await tx.commissionerWorkspaceTask.updateMany({where:{id:body.id as string,leagueId,status:body.expectedStatus as string,updatedAt:new Date(body.expectedUpdatedAt as string),OR:[{sourceKey:{startsWith:'operational:'}},{sourceKey:{startsWith:'weekly:'}}]},data:{status:body.status as string,resolvedAt:body.status==='completed'?new Date():null,autoResolvedAt:null}})
    if(count.count!==1)return false
    await tx.leagueAuditLog.create({data:{leagueId,userId,actionType:'workspace.task_status_changed',entityType:'workspace_task',entityId:body.id as string,beforeState:{status:body.expectedStatus as string},afterState:{status:body.status as string,...(task?.title?{title:task.title}:{})}}})
    return true
  })
  if(updated==='forbidden')return NextResponse.json({error:'Commissioner only'},{status:403})
  return updated?NextResponse.json({updated:true}):NextResponse.json({error:'Task changed. Reload the queue.'},{status:409})
}
export const GET=handle,PATCH=handle,POST=handle
