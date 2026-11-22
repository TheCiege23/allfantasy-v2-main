import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useAnalysisUnlock } from '@/components/chimmy/useAnalysisUnlock'
import type { SendChimmyMessageResult } from '@/lib/chimmy-chat/ChimmyChatService'

it('does not treat a generic Retry as consent to an unattempted price', async () => {
 const approvedRequest=vi.fn();const {result}=renderHook(()=>useAnalysisUnlock(vi.fn(),vi.fn()))
 act(()=>result.current.register('preview',approvedRequest))
 expect(await result.current.retryIfAttempted()).toBe(false)
 expect(approvedRequest).not.toHaveBeenCalled()
})
it('recovers the same approved callback after a lost response', async () => {
 const apply=vi.fn();const error=vi.fn();const busy=vi.fn();const approvedRequest=vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce({ok:true,response:'Delivered once'})
 const {result}=renderHook(()=>useAnalysisUnlock(apply,error,busy))
 act(()=>result.current.register('same-receipt',approvedRequest))
 await act(async()=>{await result.current.unlock('same-receipt')})
 expect(error).toHaveBeenCalledTimes(1);expect(apply).not.toHaveBeenCalled()
 await act(async()=>{expect(await result.current.retryIfAttempted()).toBe(true)})
 expect(approvedRequest).toHaveBeenCalledTimes(2);expect(apply).toHaveBeenCalledWith('same-receipt',expect.objectContaining({response:'Delivered once'}))
 expect(busy.mock.calls.map(([value])=>value)).toEqual([true,false,true,false])
})
it('blocks a second send or retry while an approved request is still processing', async () => {
 let finish!:(value:SendChimmyMessageResult)=>void
 const pending=new Promise<SendChimmyMessageResult>(resolve=>{finish=resolve});const request=vi.fn(()=>pending)
 const {result}=renderHook(()=>useAnalysisUnlock(vi.fn(),vi.fn()));const older=result.current
 act(()=>older.register('same-receipt',request))
 let execution!:Promise<void>;act(()=>{execution=older.unlock('same-receipt')})
 expect(older.isBusy()).toBe(true);expect(await older.retryIfAttempted()).toBe(true)
 await older.unlock('same-receipt');expect(request).toHaveBeenCalledTimes(1)
 await act(async()=>{finish({ok:true,response:'Full answer'});await execution})
 expect(older.isBusy()).toBe(false)
})
it('requires a fresh explicit unlock after receiving a replacement price preview', async () => {
 const newPrice=vi.fn().mockResolvedValue({ok:true,response:'Newly approved answer'})
 const firstPrice=vi.fn().mockResolvedValue({ok:true,response:'Review the updated price',unlock:newPrice})
 const {result}=renderHook(()=>useAnalysisUnlock(vi.fn(),vi.fn()))
 act(()=>result.current.register('same-receipt',firstPrice))
 await act(async()=>{await result.current.unlock('same-receipt')})
 expect(await result.current.retryIfAttempted()).toBe(false);expect(newPrice).not.toHaveBeenCalled()
 await act(async()=>{await result.current.unlock('same-receipt')});expect(newPrice).toHaveBeenCalledTimes(1)
})
