import { render, screen, fireEvent } from '@testing-library/react'
import { it, expect, vi } from 'vitest'
import { ChimmyScreenshot } from '@/components/core-app/comms/ChimmyScreenshot'
it('enlarges an in-memory screenshot without navigating to a blocked data URL', () => {
 const open=vi.fn(),close=vi.fn(); HTMLDialogElement.prototype.showModal=open; HTMLDialogElement.prototype.close=close;
 render(<ChimmyScreenshot src="data:image/png;base64,AA==" name="trade.png" />);
 fireEvent.click(screen.getByRole('button',{name:'Enlarge attached screenshot'})); expect(open).toHaveBeenCalledOnce();
 expect(screen.getByAltText('Full screenshot: trade.png').getAttribute('src')).toContain('data:image/png');
 fireEvent.click(screen.getByRole('button',{name:'Close screenshot',hidden:true})); expect(close).toHaveBeenCalledOnce();
})
