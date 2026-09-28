import { describe, it, expect, vi, beforeEach } from 'vitest'
const mocks = vi.hoisted(() => ({ openai: vi.fn(), claude: vi.fn(), configs: [] as Array<Record<string, unknown>> }))
vi.mock('openai', () => ({ default: class { chat = { completions: { create: mocks.openai } }; constructor(config: Record<string, unknown>) { mocks.configs.push(config) } } }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: mocks.claude } } }))
import { parseScreenshotWithVision } from '@/lib/chimmy/screenshotVision'
import { screenshotTradeQuestion } from '@/lib/chimmy/tradeOfferEvidence'
const facts = 'Trade team: TheCiege24\nTrade gives: Quincy Williams, Carson Schwesinger\nTrade receives: Tyrone Tracy, Ryan Fitzgerald, 2027 1st Round'
const image = { type: 'image/png', arrayBuffer: async () => new ArrayBuffer(2) } as File
beforeEach(() => { vi.clearAllMocks(); mocks.configs.length = 0; vi.stubEnv('AI_FEATURES_ENABLED', 'true'); vi.stubEnv('AI_INTEGRATIONS_OPENAI_API_KEY', 'integration-test'); vi.stubEnv('AI_INTEGRATIONS_OPENAI_BASE_URL', 'https://integration.example/v1'); vi.stubEnv('OPENAI_API_KEY', 'direct-test'); vi.stubEnv('OPENAI_BASE_URL', 'https://direct.example/v1'); vi.stubEnv('ANTHROPIC_API_KEY', 'claude-test') })
describe('screenshot provider recovery', () => {
 it('uses Chimmy’s primary provider without losing IDP, kicker or pick assets', async () => {
  mocks.openai.mockRejectedValue({status: 401}); mocks.claude.mockResolvedValue({content:[{type:'text',text:facts}],stop_reason:'end_turn'});
  const evidence = await parseScreenshotWithVision(image, 'Should I accept?'); expect(screenshotTradeQuestion(evidence).assetCount).toBe(5);
 expect(mocks.openai).not.toHaveBeenCalled();
 });
 it('keeps roster and playoff analysis requests out of the extraction task', async () => {
  mocks.claude.mockResolvedValue({content:[{type:'text',text:facts}],stop_reason:'end_turn'});
  await parseScreenshotWithVision(image, 'Analyze my roster, scoring, playoff chances and future years. Say which data is missing.');
  const request = mocks.claude.mock.calls[0][0];
  expect(request.messages[0].content[1].text).toContain('Read only the visible facts');
  expect(request.messages[0].content[1].text).not.toContain('playoff chances');
  expect(request.messages[0].content[1].text).toContain('Do not analyze');
 });
 it('recovers a primary outage with correctly paired OpenAI credentials', async () => {
  mocks.claude.mockRejectedValue({status:503}); mocks.openai.mockRejectedValueOnce({status:401}).mockResolvedValueOnce({choices:[{message:{content:facts},finish_reason:'stop'}]});
  expect(screenshotTradeQuestion(await parseScreenshotWithVision(image,'')).assetCount).toBe(5);
  expect(mocks.configs.map(c => [c.apiKey,c.baseURL])).toEqual([['integration-test','https://integration.example/v1'],['direct-test','https://direct.example/v1']]);
 });
 it('does not call providers while spend is disabled', async () => { vi.stubEnv('AI_FEATURES_ENABLED','false'); expect(await parseScreenshotWithVision(image,'')).toContain('disabled'); expect(mocks.openai).not.toHaveBeenCalled(); expect(mocks.claude).not.toHaveBeenCalled() });
 it('never uses a truncated extraction as a complete offer', async () => { mocks.openai.mockResolvedValue({choices:[{message:{content:facts},finish_reason:'length'}]}); mocks.claude.mockResolvedValue({content:[{type:'text',text:facts}],stop_reason:'max_tokens'}); expect(await parseScreenshotWithVision(image,'')).toContain('service unavailable') });
})
