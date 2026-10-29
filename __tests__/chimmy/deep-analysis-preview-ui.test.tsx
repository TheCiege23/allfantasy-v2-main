import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChimmyAnalysisPreview } from '@/components/chimmy/ChimmyAnalysisPreview'
import { DEEP_ANALYSIS_SECTIONS, type DeepAnalysisPreview } from '@/lib/chimmy/deepAnalysisPreview'
const preview: DeepAnalysisPreview = {version:1,summary:'Check player availability before kickoff.',sections:[...DEEP_ANALYSIS_SECTIONS],access:'tokens',tokenCost:3,currentBalance:10,canUnlock:true,quote:'signed',expiresAt:'2026-10-25T23:00:00Z'}
afterEach(cleanup)
it('shows a useful summary and exact price, invoking unlock only on click',()=>{
 const unlock=vi.fn();const {container}=render(<ChimmyAnalysisPreview preview={preview} onUnlock={unlock}/>);
 expect(screen.getByText(preview.summary)).toBeVisible();expect(screen.getByText(/Extra detail: 3 tokens/)).toBeVisible();expect(unlock).not.toHaveBeenCalled()
 expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3)
 fireEvent.click(screen.getByRole('button',{name:'Unlock extra detail · 3 tokens'}));expect(unlock).toHaveBeenCalledTimes(1)
})
it('keeps the summary visible when the wallet cannot cover the price',()=>{
 render(<ChimmyAnalysisPreview preview={{...preview,canUnlock:false,currentBalance:0}} onUnlock={vi.fn()}/>);
 expect(screen.getByRole('button',{name:/Unlock extra detail/})).toBeDisabled();expect(screen.getByText(preview.summary)).toBeVisible()
})
it('offers an included answer before selling tokens and supports safe refresh after reload',()=>{
 const {rerender}=render(<ChimmyAnalysisPreview preview={{...preview,access:'daily_answer',dailyRemaining:2,tokenCost:0}} onUnlock={vi.fn()}/>);
 expect(screen.getByRole('button',{name:'Use 1 included answer'})).toBeVisible()
 rerender(<ChimmyAnalysisPreview preview={preview} onRefresh={vi.fn()}/>);expect(screen.getByRole('button',{name:'Refresh unlock price'})).toBeVisible()
})
