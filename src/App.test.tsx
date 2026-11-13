import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import * as ai from './ai';
import { createEntry, ENTRIES_KEY, persistSettings, saveEntries } from './journal';
import type { AIResult } from './types';

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

const result: AIResult = { english: 'I enjoyed a walk.', explanation: '使用过去时。', translation: false,
  question: 'What did you enjoy?', chinese: '你喜欢什么？', title: 'A quiet day', summary: 'I enjoyed a quiet walk.' };

function prepare() {
  persistSettings(localStorage, { provider: 'deepseek', rememberKeys: true, keys: { deepseek: 'test-key', minimax: '' } });
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
