import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEntry, ENTRIES_KEY, saveEntries } from './journal';
import { DiarySync, readSync, readSyncBackups, recoverSyncReplacement, SYNC_BACKUPS_KEY, SYNC_KEY } from './sync';
import { diarySnapshot } from './sync-format';
import type { SyncView } from './sync';
import type { Entry } from './types';

const TOKEN = `ld1_${'A'.repeat(43)}`;
const endpoint = 'https://sync.example.test/diary-sync';
beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function setup(remoteEntries?: Entry[], version = 1) {
  let entries = [createEntry([], 'daily')];
  entries[0].draft = 'Local unsent diary';
  saveEntries(localStorage, entries);
  localStorage.setItem(SYNC_KEY, JSON.stringify({ token: TOKEN, version: 1, dirty: true, lastSyncedAt: '' }));
  let view: SyncView;
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ version, snapshot: diarySnapshot(remoteEntries || entries) })));
  const service = new DiarySync(localStorage, endpoint, { read: () => entries, canWrite: () => true, canReplace: () => true,
    replace: value => { entries = value; }, changed: value => { view = value; } }, fetcher);
  return { service, fetcher, entries: () => entries, view: () => view };
}
it('backs up newest local changes before applying a newer cloud version without merging', async () => {
  const remote = [{ ...createEntry([], 'daily'), draft: 'Computer cloud diary' }];
  const s = setup(remote, 2); await s.service.sync();
  expect(s.entries()).toEqual(remote);
  expect(readSyncBackups(localStorage)[0].entries[0].draft).toBe('Local unsent diary');
  expect(readSync(localStorage)?.dirty).toBe(false);
  expect(s.view().status).toBe('backup');
  expect(s.fetcher).toHaveBeenCalledTimes(1);
  s.service.dispose();
});
it('binds the native fetch receiver for browsers that reject a class-instance receiver', async () => {
  const entries = [createEntry([], 'daily')]; saveEntries(localStorage, entries);
  localStorage.setItem(SYNC_KEY, JSON.stringify({ token: TOKEN, version: 1, dirty: false, lastSyncedAt: '' }));
  vi.stubGlobal('fetch', function (this: unknown) {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    return Promise.resolve(new Response(JSON.stringify({ version: 1, snapshot: diarySnapshot(entries) })));
  });
  let view!: SyncView;
  const service = new DiarySync(localStorage, endpoint, { read: () => entries, canWrite: () => true, canReplace: () => true, replace: () => {}, changed: value => { view = value; } });
  await service.sync(); expect(view.status).toBe('synced'); service.dispose();
});
it('keeps local data and refuses replacement when backups cannot be saved', async () => {
  const s = setup([], 2);
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === SYNC_BACKUPS_KEY) throw new DOMException('Quota', 'QuotaExceededError');
    return original.call(this, key, value);
  });
  await s.service.sync();
  expect(s.entries()[0].draft).toBe('Local unsent diary');
  expect(JSON.parse(localStorage.getItem(ENTRIES_KEY)!)[0].draft).toBe('Local unsent diary');
  expect(s.view().status).toBe('error');
  s.service.dispose();
});
it('rolls back both entries and sync state if metadata save fails after writing cloud entries', async () => {
  const s = setup([], 2);
  const before = localStorage.getItem(ENTRIES_KEY);
  const original = Storage.prototype.setItem;
  let failed = false;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === SYNC_KEY && !failed) { failed = true; throw new DOMException('Quota'); }
    return original.call(this, key, value);
  });
  await s.service.sync();
  expect(localStorage.getItem(ENTRIES_KEY)).toBe(before);
  expect(readSync(localStorage)?.version).toBe(1);
  expect(s.entries()).toHaveLength(1); s.service.dispose();
});
it('rejects unknown cloud format and does not wipe local data', async () => {
  const s = setup();
  s.fetcher.mockResolvedValueOnce(new Response('{"version":2,"snapshot":{"version":77,"entries":[]}}'));
  await s.service.sync();
  expect(s.entries()[0].draft).toBe('Local unsent diary');
  expect(s.view().status).toBe('error'); s.service.dispose();
});
it('resolves a lost committed upload by retrying its operation before pulling', async () => {
  const s = setup(); const snapshot = diarySnapshot(s.entries());
  localStorage.setItem(SYNC_KEY, JSON.stringify({ token: TOKEN, version: 1, dirty: true, lastSyncedAt: '', pending: { action: 'push', expectedVersion: 1, operationId: 'operation-1', snapshot } }));
  s.service.dispose();
  const calls: object[] = [];
  const fetcher = vi.fn(async (_url, options) => { calls.push(JSON.parse(String(options?.body))); return new Response(JSON.stringify({ version: 2, snapshot })); });
  const service = new DiarySync(localStorage, endpoint, { read: s.entries, canWrite: () => true, canReplace: () => true, replace: () => {}, changed: () => {} }, fetcher);
  await service.sync();
  expect(calls).toEqual([expect.objectContaining({ action: 'push', operationId: 'operation-1' }), { action: 'pull' }]);
  expect(readSync(localStorage)?.pending).toBeUndefined(); expect(readSync(localStorage)?.version).toBe(2); service.dispose();
});
it('does not replace an active edit or AI operation; retry can apply after it completes', async () => {
  let editable = false; let entries = [createEntry([], 'daily')]; saveEntries(localStorage, entries);
  localStorage.setItem(SYNC_KEY, JSON.stringify({ token: TOKEN, version: 1, dirty: true, lastSyncedAt: '' }));
  const service = new DiarySync(localStorage, endpoint, { read: () => entries, canWrite: () => true, canReplace: () => editable, replace: next => { entries = next; }, changed: () => {} }, vi.fn(async () => new Response('{"version":2,"snapshot":{"version":1,"entries":[]}}')));
  await service.sync(); expect(entries).toHaveLength(1);
  editable = true; await service.sync(); expect(entries).toEqual([]); service.dispose();
});
it('stops a late cloud response after disposal and does not overwrite storage', async () => {
  const s = setup([], 2); let resolve!: (response: Response) => void;
  s.fetcher.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }));
  const pending = s.service.sync(); s.service.dispose();
  resolve(new Response('{"version":2,"snapshot":{"version":1,"entries":[]}}')); await pending;
  expect(s.entries()).toHaveLength(1);
});
it('restores original entries on the next startup after an interrupted replacement', () => {
  const original = JSON.stringify([createEntry([], 'daily')]);
  localStorage.setItem(ENTRIES_KEY, '[]');
  localStorage.setItem('little-days.sync-replacement.v1', JSON.stringify({ entries: original, sync: null }));
  recoverSyncReplacement(localStorage);
  expect(localStorage.getItem(ENTRIES_KEY)).toBe(original);
  expect(localStorage.getItem(SYNC_KEY)).toBeNull();
});
it('keeps new edits dirty when an earlier upload finishes', async () => {
  const s = setup(); let resolve!: (r: Response) => void;
  // pull version 1, then leave upload in flight.
  s.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ version: 1, snapshot: diarySnapshot(s.entries()) }))).mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }));
  const pending = s.service.sync();
  await vi.waitFor(() => expect(s.fetcher).toHaveBeenCalledTimes(2));
  const uploaded = JSON.parse(String(s.fetcher.mock.calls[1][1].body)).snapshot;
  s.entries()[0].draft = 'Typed while upload was in flight'; saveEntries(localStorage, s.entries()); s.service.markDirty();
  resolve(new Response(JSON.stringify({ version: 2, snapshot: uploaded }))); await pending;
  expect(readSync(localStorage)?.dirty).toBe(true);
  expect(s.entries()[0].draft).toBe('Typed while upload was in flight'); s.service.dispose();
});
