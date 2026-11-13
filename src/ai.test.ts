import { afterEach, expect, it, vi } from 'vitest';
import { requestAI } from './ai';
import { createEntry, defaultSettings } from './journal';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const answer = { english: 'I went to the park.', explanation: '过去发生的事情用 went。', translation: false, question: 'How did you feel?', chinese: '你当时感觉如何？', title: 'A quiet day', summary: 'I enjoyed a quiet walk.' };
const entry = () => ({ ...createEntry([], 'daily'), messages: [{ id: 'user', role: 'user' as const, content: 'I go to park yesterday.' }] });
function respond(content = JSON.stringify(answer), status = 200, reason = 'stop') {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: reason }] }), { status }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
it('uses DeepSeek non-thinking JSON with only current entry', async () => {
  const fetcher = respond();
  expect(await requestAI(entry(), defaultSettings, 'test-key', 'chat')).toEqual(answer);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe('https://api.deepseek.com/chat/completions');
  expect(init.headers.Authorization).toBe('Bearer test-key');
  const body = JSON.parse(init.body);
  expect(body.model).toBe('deepseek-flash');
  expect(body.thinking.type).toBe('disabled');
  expect(body.response_format.type).toBe('json_object');
  expect(init.body).toContain('I go to park yesterday.');
  expect(init.body).not.toContain('test-key');
});
it('uses mainland MiniMax low reasoning without unsupported JSON options', async () => {
  const fetcher = respond();
  await requestAI(entry(), { ...defaultSettings, provider: 'minimax' }, 'key', 'chat');
  expect(fetcher.mock.calls[0][0]).toBe('https://api.minimax.cn/v1/chat/completions');
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.reasoning_effort).toBe('low');
  expect(body.response_format).toBeUndefined();
  expect(body.thinking).toBeUndefined();
});
it.each([['bad json', 'chat'], [JSON.stringify({ ...answer, question: '' }), 'chat'], [JSON.stringify({ ...answer, summary: '' }), 'archive']])('rejects malformed results %s', async (content, action) => {
  respond(content);
  await expect(requestAI(entry(), defaultSettings, 'key', action as 'chat' | 'archive')).rejects.toThrow(/格式/);
});
it('rejects truncated output', async () => {
  respond(JSON.stringify(answer), 200, 'length');
  await expect(requestAI(entry(), defaultSettings, 'key', 'chat')).rejects.toThrow(/截断/);
});
it.each([[401, '密钥'], [402, '余额'], [429, '频繁'], [500, '服务']])('gives actionable HTTP %s errors', async (status, text) => {
  respond('', status);
  await expect(requestAI(entry(), defaultSettings, 'key', 'chat')).rejects.toThrow(text);
});
it('rejects missing keys without making a paid call', async () => {
  const fetcher = respond();
  await expect(requestAI(entry(), defaultSettings, '', 'chat')).rejects.toThrow(/密钥/);
  expect(fetcher).not.toHaveBeenCalled();
});
it('explains network or browser CORS failures', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  await expect(requestAI(entry(), defaultSettings, 'key', 'chat')).rejects.toThrow(/网络|跨域/);
});
it('normalizes cancellation while consuming the response body', async () => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => ({ ok: true, json: () => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    controller.abort();
  }) })));
  await expect(requestAI(entry(), defaultSettings, 'key', 'chat', controller.signal)).rejects.toThrow(/已取消/);
});
it('normalizes timeout while consuming the response body', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => ({ ok: true, json: () => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }) })));
  const pending = expect(requestAI(entry(), defaultSettings, 'key', 'chat')).rejects.toThrow(/超时/);
  await vi.advanceTimersByTimeAsync(90000);
  await pending;
});
