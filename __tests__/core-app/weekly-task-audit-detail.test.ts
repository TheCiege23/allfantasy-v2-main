import {describe,it,expect} from 'vitest'
import {fromAuditLog} from '@/lib/core-app/commissioner/timeline'
const row={id:'audit',entityType:'workspace_task',createdAt:new Date('2026-10-07T12:00:00Z'),actorName:'Manager',metadata:null}
describe('weekly task audit detail',()=>{
 it('shows the reviewed title for creation',()=>{expect(fromAuditLog({...row,actionType:'workspace.weekly_task_created',afterState:{title:'Review playoff settings',status:'open'}})).toMatchObject({title:'Saved a reviewed weekly task',detail:'Review playoff settings'})})
 it('shows before and after states, even for older entries without a title',()=>{expect(fromAuditLog({...row,actionType:'workspace.task_status_changed',beforeState:{status:'open'},afterState:{status:'in_progress'}}).detail).toBe('Open → In progress')})
 it('includes a title when stored and preserves other audit wording',()=>{expect(fromAuditLog({...row,actionType:'workspace.task_status_changed',beforeState:{status:'completed'},afterState:{status:'archived',title:'QA verification'}}).detail).toBe('QA verification · Completed → Archived');expect(fromAuditLog({...row,actionType:'commissioner_edit_faab'}).title).toBe('Adjusted a team’s FAAB')})
})
