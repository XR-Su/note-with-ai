import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { createEntry, ENTRIES_KEY, saveEntries } from './journal';
import { SYNC_KEY, readSyncBackups } from './sync';
import { TOKEN_PATTERN } from './sync-format';
import * as ai from './ai';
vi.mock('./sync-config', () => ({ SYNC_ENDPOINT: 'https://sync.example.test/diary-sync' }));
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function connected() {
  const entry = { ...createEntry([], 'daily'), draft: 'Unuploaded private original' };
  saveEntries(localStorage, [entry]);
  localStorage.setItem(SYNC_KEY, JSON.stringify({ token: `ld1_${'A'.repeat(43)}`, version: 1, dirty: true, lastSyncedAt: '' }));
  return entry;
}
it('shows startup syncing/read-only and backs up local data when the newer cloud file arrives without AI calls', async () => {
  connected(); const requestAI = vi.spyOn(ai, 'requestAI');
  let resolve!: (r: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { resolve = r; })));
  const { container } = render(<App />);
  expect(screen.getByRole('button', { name: /云端同步：正在同步/ })).toBeDefined();
  expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
  await act(async () => { resolve(new Response('{"version":2,"snapshot":{"version":1,"entries":[]}}')); });
  await waitFor(() => expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(false));
  expect(localStorage.getItem(ENTRIES_KEY)).toBe('[]');
  expect(readSyncBackups(localStorage)[0].entries[0].draft).toBe('Unuploaded private original');
  expect(requestAI).not.toHaveBeenCalled();
});
it('offers offline editing after three seconds while the startup request is pending', async () => {
  connected(); vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  const { container } = render(<App />);
  expect(screen.queryByRole('button', { name: '继续离线编辑' })).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(3001); });
  fireEvent.click(screen.getByRole('button', { name: '继续离线编辑' }));
  expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '记录今天' }));
  fireEvent.change(screen.getByRole('textbox', { name: '你的回答' }), { target: { value: 'Continued offline draft' } });
  expect(localStorage.getItem(ENTRIES_KEY)).toContain('Continued offline draft');
});
it('creates a system-generated immutable credential and shows only read-only sharing controls', async () => {
  const fetcher = vi.fn(async () => new Response('{"version":1,"snapshot":{"version":1,"entries":[]}}'));
  vi.stubGlobal('fetch', fetcher);
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /云端同步：未开启/ }));
  fireEvent.click(screen.getByRole('button', { name: '创建同步空间' }));
  await screen.findByRole('button', { name: '查看口令与二维码' });
  const saved = JSON.parse(localStorage.getItem(SYNC_KEY)!);
  expect(TOKEN_PATTERN.test(saved.token)).toBe(true);
  await waitFor(() => expect(saved.version).toBe(1));
  expect(screen.queryByRole('textbox', { name: '连接已有空间' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看口令与二维码' }));
  expect((screen.getByLabelText('系统生成的固定同步口令') as HTMLTextAreaElement).readOnly).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('rejects an invalid connection without saving a credential or replacing existing diaries', async () => {
  saveEntries(localStorage, [createEntry([], 'daily')]); const original = localStorage.getItem(ENTRIES_KEY);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"space_not_found"}', { status: 404 })));
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /云端同步：未开启/ }));
  fireEvent.change(screen.getByLabelText('连接已有空间'), { target: { value: `ld1_${'A'.repeat(43)}` } });
  fireEvent.click(screen.getByRole('button', { name: '连接并下载' }));
  await screen.findByRole('alert');
  expect(localStorage.getItem(SYNC_KEY)).toBeNull(); expect(localStorage.getItem(ENTRIES_KEY)).toBe(original);
});
