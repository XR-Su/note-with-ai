import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import * as ai from './ai';
import { createEntry, defaultSettings, ENTRIES_KEY, persistSettings, readSettings, saveEntries } from './journal';
import type { AIResult } from './types';
import { StrictMode } from 'react';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('renders a welcoming local-only bilingual diary with both modes', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /Every little day/ })).toBeDefined();
  expect(screen.getByRole('button', { name: '记录今天' })).toBeDefined();
  expect(screen.getByRole('button', { name: '拾起回忆' })).toBeDefined();
  expect(screen.getAllByText(/只保存在/).length).toBeGreaterThan(0);
});
it('creates a daily entry with a bilingual opening and autosaved draft', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '记录今天' }));
  expect(screen.getByText(/What is one little thing/)).toBeDefined();
  fireEvent.change(screen.getByRole('textbox', { name: '你的回答' }), { target: { value: 'Today was lovely.' } });
  expect(localStorage.getItem('little-days.entries.v1')).toContain('Today was lovely.');
});
it('opens API settings with key opt-in disabled', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'AI 设置' }));
  expect(screen.getByRole('dialog')).toBeDefined();
  expect((screen.getByRole('checkbox', { name: /记住/ }) as HTMLInputElement).checked).toBe(false);
});

it('keeps both provider keys when switching, saving and reopening settings', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'AI 设置' }));
  fireEvent.change(screen.getByLabelText('DeepSeek API 密钥'), { target: { value: 'deepseek-test-key' } });
  expect(screen.queryByLabelText('MiniMax API 密钥')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /M MiniMax/ }));
  expect(screen.queryByLabelText('DeepSeek API 密钥')).toBeNull();
  fireEvent.change(screen.getByLabelText('MiniMax API 密钥'), { target: { value: 'minimax-test-key' } });
  fireEvent.click(screen.getByRole('button', { name: /D DeepSeek/ }));
  expect((screen.getByLabelText('DeepSeek API 密钥') as HTMLInputElement).value).toBe('deepseek-test-key');
  fireEvent.click(screen.getByRole('button', { name: /保存设置/ }));
  fireEvent.click(screen.getByRole('button', { name: 'AI 设置' }));
  expect((screen.getByLabelText('DeepSeek API 密钥') as HTMLInputElement).value).toBe('deepseek-test-key');
  fireEvent.click(screen.getByRole('button', { name: /M MiniMax/ }));
  expect((screen.getByLabelText('MiniMax API 密钥') as HTMLInputElement).value).toBe('minimax-test-key');
});

const result: AIResult = { english: 'I enjoyed a walk.', explanation: '使用过去时。', translation: false,
  question: 'What did you enjoy?', chinese: '你喜欢什么？', title: 'A quiet day', summary: 'I enjoyed a quiet walk.' };

it('validates and persists the daily memory setting across reopening settings', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'AI 设置' }));
  const input = screen.getByRole('spinbutton', { name: '日记记忆追溯天数' }) as HTMLInputElement;
  expect(input.value).toBe('0');
  expect(input.min).toBe('0');
  expect(input.max).toBe('180');
  for (const value of ['', '-1', '181', '1.5']) {
    fireEvent.change(input, { target: { value } });
    expect((screen.getByRole('button', { name: /保存设置/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('0–180');
  }
  fireEvent.change(input, { target: { value: '180' } });
  fireEvent.click(screen.getByRole('button', { name: /保存设置/ }));
  expect(readSettings(localStorage).memoryDays).toBe(180);
  fireEvent.click(screen.getByRole('button', { name: 'AI 设置' }));
  expect((screen.getByRole('spinbutton', { name: '日记记忆追溯天数' }) as HTMLInputElement).value).toBe('180');
});

it('uses saved memory preferences on the next daily chat and stops sending history when disabled', async () => {
  const past = new Date();
  past.setDate(past.getDate() - 1);
  const history = { ...createEntry([], 'daily', past), archived: true, title: 'Yesterday’s walk', summary: 'I visited a park yesterday.' };
  history.messages.push({ id: 'old-user', role: 'user', content: 'PRIVATE HISTORICAL ORIGINAL', english: 'PRIVATE HISTORICAL TRANSLATION' });
  saveEntries(localStorage, [history]);
  persistSettings(localStorage, { ...defaultSettings, rememberKeys: true, keys: { deepseek: 'test-key', minimax: '' } });
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }] })));
  vi.stubGlobal('fetch', fetcher);
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'AI 设置' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: '日记记忆追溯天数' }), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: /保存设置/ }));
  fireEvent.click(screen.getByRole('button', { name: '记录今天' }));
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox', { name: '你的回答' }), { target: { value: 'Today I went for another walk.' } });
  fireEvent.click(screen.getByRole('button', { name: '发送回答' }));
  await screen.findByText(result.question);
  const first = JSON.parse(JSON.parse(fetcher.mock.calls[0][1].body).messages[1].content);
  expect(first.archived_context).toEqual([{ date: history.date, title: history.title, summary: history.summary }]);
  expect(fetcher.mock.calls[0][1].body).not.toContain('PRIVATE HISTORICAL');
  fireEvent.click(screen.getByRole('button', { name: 'AI 设置' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: '日记记忆追溯天数' }), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: /保存设置/ }));
  fireEvent.change(screen.getByRole('textbox', { name: '你的回答' }), { target: { value: 'The weather was sunny.' } });
  fireEvent.click(screen.getByRole('button', { name: '发送回答' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  const second = JSON.parse(JSON.parse(fetcher.mock.calls[1][1].body).messages[1].content);
  expect(second.archived_context).toBeUndefined();
});

function prepare() {
  persistSettings(localStorage, { ...defaultSettings, rememberKeys: true, keys: { deepseek: 'test-key', minimax: '' } });
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '记录今天' }));
}

it('recovers an unanswered message by editing and generating a follow-up', async () => {
  const request = vi.spyOn(ai, 'requestAI').mockRejectedValueOnce(new Error('网络失败')).mockResolvedValue(result);
  prepare();
  fireEvent.change(screen.getByRole('textbox', { name: '你的回答' }), { target: { value: 'I enjoy walk.' } });
  fireEvent.click(screen.getByRole('button', { name: '发送回答' }));
  await screen.findByText('网络失败');
  fireEvent.click(screen.getByRole('button', { name: '修改这条回答' }));
  fireEvent.change(screen.getByRole('textbox', { name: '修改回答' }), { target: { value: 'I enjoy a walk.' } });
  fireEvent.click(screen.getByRole('button', { name: '保存并重新纠错' }));
  await screen.findByText('What did you enjoy?');
  expect(request.mock.calls[1][3]).toBe('chat');
  expect((screen.getByRole('textbox', { name: '你的回答' }) as HTMLTextAreaElement).disabled).toBe(false);
  expect(JSON.parse(localStorage.getItem(ENTRIES_KEY)!).at(0).messages.filter((m: { role: string }) => m.role === 'user')).toHaveLength(1);
});

it('does not archive an unsent draft through a failed archive retry', async () => {
  const request = vi.spyOn(ai, 'requestAI').mockResolvedValueOnce(result).mockRejectedValueOnce(new Error('归档失败')).mockResolvedValue(result);
  prepare();
  fireEvent.change(screen.getByRole('textbox', { name: '你的回答' }), { target: { value: 'I enjoy walk.' } });
  fireEvent.click(screen.getByRole('button', { name: '发送回答' }));
  await screen.findByText('What did you enjoy?');
  fireEvent.click(screen.getByRole('button', { name: '结束并归档' }));
  await screen.findByText('归档失败');
  fireEvent.change(screen.getByRole('textbox', { name: '你的回答' }), { target: { value: 'Still writing.' } });
  fireEvent.click(screen.getByRole('button', { name: '重试本次请求' }));
  expect(request).toHaveBeenCalledTimes(2);
  expect(JSON.parse(localStorage.getItem(ENTRIES_KEY)!)[0].archived).toBe(false);
  expect((screen.getByRole('textbox', { name: '你的回答' }) as HTMLTextAreaElement).value).toBe('Still writing.');
});

it('renders recovery UI if the localStorage getter is denied', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('Storage blocked', 'SecurityError'); });
  render(<App />);
  expect(screen.getByRole('heading', { name: /Every little day/ })).toBeDefined();
  expect(screen.getByRole('alert')).toBeDefined();
});

it('does not restore cleared storage after a storage-clear event', () => {
  prepare();
  localStorage.clear();
  fireEvent(window, new StorageEvent('storage', { key: null }));
  fireEvent.change(screen.getByRole('textbox', { name: '你的回答' }), { target: { value: 'Only in memory now.' } });
  expect(localStorage.getItem(ENTRIES_KEY)).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('另一标签页');
});

it('locks the second tab to read-only when another writer holds the browser lock', async () => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: vi.fn(async (_name, _options, callback) => callback(null)) } });
  render(<App />);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('本页只读'));
  fireEvent.click(screen.getByRole('button', { name: '记录今天' }));
  expect(localStorage.getItem(ENTRIES_KEY)).toBeNull();
  Reflect.deleteProperty(navigator, 'locks');
});

it('can write when StrictMode re-runs the lock effect before the first callback', async () => {
  let held = false;
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: vi.fn((_name, _options, callback) => {
      const acquired = !held;
      if (acquired) held = true;
      return new Promise<void>(resolve => setTimeout(() => {
        Promise.resolve(callback(acquired ? { name: 'little-days.writer' } : null)).then(() => {
          if (acquired) held = false;
          resolve();
        });
      }, 0));
    }),
  } });
  try {
    render(<StrictMode><App /></StrictMode>);
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: '记录今天' }));
      expect(localStorage.getItem(ENTRIES_KEY)).not.toBeNull();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  } finally {
    cleanup();
    Reflect.deleteProperty(navigator, 'locks');
  }
});

it('archives, resumes and deletes a complete entry', async () => {
  vi.spyOn(ai, 'requestAI').mockResolvedValue(result);
  const entry = createEntry([], 'daily');
  entry.messages.push({ id: 'u1', role: 'user', content: 'I enjoyed a walk.', english: 'I enjoyed a walk.' });
  entry.messages.push({ id: 'a1', role: 'assistant', content: 'What did you enjoy?', chinese: '你喜欢什么？' });
  saveEntries(localStorage, [entry]);
  prepare();
  fireEvent.click(screen.getByRole('button', { name: '结束并归档' }));
  await screen.findByText(result.summary);
  expect(screen.queryByRole('textbox', { name: '你的回答' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '继续这段对话' }));
  expect(screen.getByRole('textbox', { name: '你的回答' })).toBeDefined();
  expect(screen.queryByText(result.summary)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '删除整篇记录' }));
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  expect(JSON.parse(localStorage.getItem(ENTRIES_KEY)!)).toEqual([]);
});

it('preserves the conversation when an archive contains Chinese and saves only after a successful manual retry', async () => {
  const entry = createEntry([], 'daily');
  entry.messages.push({ id: 'u1', role: 'user', content: '西递的徽派建筑让我印象深刻。', english: 'Xidi’s Huizhou-style architecture impressed me.' });
  saveEntries(localStorage, [entry]);
  const response = (summary: string) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...result, summary }) }, finish_reason: 'stop' }] }));
  const fetcher = vi.fn()
    .mockResolvedValueOnce(response('Xidi’s 徽派建筑 impressed me.'))
    .mockResolvedValueOnce(response('Xidi’s Huizhou-style architecture impressed me.'));
  vi.stubGlobal('fetch', fetcher);
  prepare();
  fireEvent.click(screen.getByRole('button', { name: '结束并归档' }));
  await screen.findByText(/归档标题或正文仍包含中文/);
  const failed = JSON.parse(localStorage.getItem(ENTRIES_KEY)!)[0];
  expect(failed.archived).toBe(false);
  expect(failed.title).toBe(entry.title);
  expect(failed.summary).toBe('');
  expect(failed.messages).toEqual(entry.messages);
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '重试本次请求' }));
  await screen.findByText('Xidi’s Huizhou-style architecture impressed me.');
  const saved = JSON.parse(localStorage.getItem(ENTRIES_KEY)!)[0];
  expect(saved.archived).toBe(true);
  expect(saved.summary).toBe('Xidi’s Huizhou-style architecture impressed me.');
  expect(saved.messages).toEqual(entry.messages);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
