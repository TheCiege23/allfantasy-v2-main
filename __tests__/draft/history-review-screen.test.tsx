import { describe,expect,it,vi } from 'vitest';
import { fireEvent,render,screen,waitFor } from '@testing-library/react';
const mocks=vi.hoisted(()=>({push:vi.fn(),list:vi.fn(),preview:vi.fn(),confirm:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:mocks.push,refresh:vi.fn()})}));
vi.mock('@/components/i18n/LanguageProviderClient',()=>({useOptionalLanguage:()=>({language:'en'})}));
vi.mock('@/lib/draft-archive/historyActions',()=>({listHistorySources:mocks.list,previewHistorySource:mocks.preview,confirmHistorySource:mocks.confirm}));
import { DraftHistoryReview } from '@/components/core-app/screens/DraftHistoryReview';
describe('historical review selection context',()=>{
  it('opens the verified draft after attaching a source, including when the legacy archive disappears',async()=>{
    mocks.list.mockResolvedValue({ok:true,drafts:[{id:'222',type:'snake',status:'complete',start:null}]});
    mocks.preview.mockResolvedValue({ok:true,digest:'a'.repeat(64),count:1,total:1,picks:[]});mocks.confirm.mockResolvedValue({ok:true,count:1});
    render(<DraftHistoryReview leagueId="league" archiveKey="legacy:NFL:2026"/>);
    fireEvent.click(screen.getByText('Commissioner: verify historical source'));
    fireEvent.click(screen.getByRole('button',{name:'Load verified league sources / retry provider'}));
    fireEvent.change(await screen.findByRole('combobox'),{target:{value:'222'}});
    fireEvent.click(screen.getByRole('button',{name:'Preview exact matches'}));
    fireEvent.change(await screen.findByRole('textbox'),{target:{value:'Verified against original draft'}});
    fireEvent.click(screen.getByRole('button',{name:'Confirm this source and preserve audit'}));
    await waitFor(()=>expect(mocks.push).toHaveBeenCalledWith('/core/draft-hq?league=league&draft=imported%3A222'));
  });
});
