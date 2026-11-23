// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createSyncHandler } from '../cloud/service';
import { MemoryRepository } from '../cloud/memory';
import { createEntry } from './journal';
import { diarySnapshot } from './sync-format';
import { randomBytes, randomUUID } from 'node:crypto';

const token = () => `ld1_${randomBytes(32).toString('base64url')}`;
function setup() {
  const repository = new MemoryRepository();
  const handler = createSyncHandler(repository, ['https://xr-su.github.io']);
  const key = token();
  const snapshot = diarySnapshot([createEntry([], 'daily')]);
  const call = (input: object, credential = key) => handler({ httpMethod: 'POST', headers: { Authorization: `Bearer ${credential}` }, body: JSON.stringify(input) });
  const create = () => call({ action: 'create', expectedVersion: 0, operationId: randomUUID(), snapshot });
  return { repository, handler, key, snapshot, call, create };
}
it('round-trips only diary data, encrypts stored files and isolates other credentials', async () => {
  const s = setup();
  (s.snapshot.entries[0] as unknown as Record<string, unknown>).apiKey = 'SECRET_NOT_DIARY';
  expect((await s.create()).statusCode).toBe(200);
  const response = await s.call({ action: 'pull' });
  expect(response.statusCode).toBe(200);
  expect(response.body).not.toContain('SECRET_NOT_DIARY');
  expect(JSON.parse(response.body).snapshot.entries[0].id).toBe(s.snapshot.entries[0].id);
  expect([...s.repository.files.values()][0].includes(Buffer.from(s.snapshot.entries[0].title))).toBe(false);
  expect([...s.repository.heads.values()][0]).not.toHaveProperty('token');
  expect((await s.call({ action: 'pull' }, token())).statusCode).toBe(404);
  expect((await s.call({ action: 'pull' }, '123456')).statusCode).toBe(401);
});
it('allows exactly one concurrent writer and returns latest cloud head after conflicts', async () => {
  const s = setup(); await s.create();
  const update = (draft: string) => s.call({ action: 'push', expectedVersion: 1, operationId: randomUUID(), snapshot: { version: 1, entries: [{ ...s.snapshot.entries[0], draft }] } });
  const results = await Promise.all([update('Phone changes'), update('Computer changes')]);
  expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
  const latest = JSON.parse((await s.call({ action: 'pull' })).body);
  expect(latest.version).toBe(2);
  expect(['Phone changes', 'Computer changes']).toContain(latest.snapshot.entries[0].draft);
});
it('retries the same committed operation without increasing its version and rejects reused IDs with different data', async () => {
  const s = setup();
  const input = { action: 'create', expectedVersion: 0, operationId: randomUUID(), snapshot: s.snapshot };
  await s.call(input);
  expect(JSON.parse((await s.call(input)).body).version).toBe(1);
  expect(s.repository.files.size).toBe(1);
  expect((await s.call({ ...input, snapshot: { version: 1, entries: [] } })).statusCode).toBe(400);
  expect((await s.create()).statusCode).toBe(409);
});
it('does not commit a pointer on object failure and retains potentially committed files after transport errors', async () => {
  const s = setup();
  vi.spyOn(s.repository, 'upload').mockRejectedValueOnce(new Error('Storage offline'));
  expect((await s.create()).statusCode).toBe(503);
  expect(s.repository.heads.size).toBe(0);
  const original = s.repository.create.bind(s.repository);
  vi.spyOn(s.repository, 'create').mockImplementationOnce(async head => { await original(head); throw new Error('Response lost'); });
  expect((await s.create()).statusCode).toBe(503);
  expect((await s.call({ action: 'pull' })).statusCode).toBe(200);
});
it('rejects invalid snapshots, corrupted cloud data and disallowed browser origins', async () => {
  const s = setup();
  expect((await s.call({ action: 'create', expectedVersion: 0, operationId: randomUUID(), snapshot: { version: 99, entries: [] } })).statusCode).toBe(400);
  await s.create();
  const object = [...s.repository.files.keys()][0]; s.repository.files.set(object, Buffer.alloc(40));
  expect((await s.call({ action: 'pull' })).statusCode).toBe(503);
  const blocked = await s.handler({ httpMethod: 'POST', headers: { Origin: 'https://example.com', Authorization: `Bearer ${s.key}` }, body: '{"action":"pull"}' });
  expect(blocked.statusCode).toBe(403);
  expect(blocked.headers).not.toHaveProperty('Access-Control-Allow-Origin');
  const preflight = await s.handler({ httpMethod: 'OPTIONS', headers: { Origin: 'https://xr-su.github.io' } });
  expect(preflight.statusCode).toBe(204);
  expect(preflight.headers['Access-Control-Allow-Headers']).toContain('Authorization');
});
