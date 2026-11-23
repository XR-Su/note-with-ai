import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { MAX_SNAPSHOT_BYTES, parseSnapshot, TOKEN_PATTERN } from '../src/sync-format';
import type { DiarySnapshot } from '../src/sync-format';

export interface Head { id: string; version: number; object_key: string; operation_id: string; content_hash: string }
export interface Repository {
  get(id: string): Promise<Head | null>;
  create(head: Head): Promise<boolean>;
  compareAndSet(id: string, expected: number, next: Head): Promise<boolean>;
  upload(key: string, content: Buffer): Promise<void>;
  download(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
export interface HttpEvent { httpMethod?: string; headers?: Record<string, string | undefined>; body?: string; isBase64Encoded?: boolean }
export interface HttpResponse { statusCode: number; headers: Record<string, string>; body: string }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function encrypt(snapshot: DiarySnapshot, token: string): Buffer {
  const nonce = randomBytes(12);
  const key = createHash('sha256').update(`little-days.snapshot.v1\0${token}`).digest();
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(snapshot), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}
function decrypt(bytes: Buffer, token: string): DiarySnapshot {
  if (bytes.length < 28 || bytes.length > MAX_SNAPSHOT_BYTES + 28) throw new Error('Invalid stored snapshot');
  const key = createHash('sha256').update(`little-days.snapshot.v1\0${token}`).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  const json = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  return parseSnapshot(JSON.parse(json));
}
class HttpError extends Error { constructor(public status: number, public code: string) { super(code); } }
export function createSyncHandler(repository: Repository, allowedOrigins: string[]) {
  return async (event: HttpEvent): Promise<HttpResponse> => {
    const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
    const origin = headers.origin;
    const responseHeaders: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
    if (origin && allowedOrigins.includes(origin)) responseHeaders['Access-Control-Allow-Origin'] = origin;
    const reply = (statusCode: number, body: unknown) => ({ statusCode, headers: responseHeaders, body: JSON.stringify(body) });
    try {
      if (origin && !allowedOrigins.includes(origin)) throw new HttpError(403, 'origin_denied');
      if (event.httpMethod === 'OPTIONS') {
        responseHeaders['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS';
        responseHeaders['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
        responseHeaders['Access-Control-Max-Age'] = '600';
        return reply(204, null);
      }
      if (event.httpMethod === 'GET') return reply(200, { service: 'little-days-sync', version: 1 });
      if (event.httpMethod !== 'POST') throw new HttpError(405, 'method_not_allowed');
      const token = headers.authorization?.replace(/^Bearer /, '') || '';
      if (!TOKEN_PATTERN.test(token)) throw new HttpError(401, 'invalid_token');
      const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
      if (Buffer.byteLength(raw) > MAX_SNAPSHOT_BYTES + 1024) throw new HttpError(413, 'snapshot_too_large');
      let input: { action?: string; expectedVersion?: number; operationId?: string; snapshot?: unknown };
      try { input = JSON.parse(raw); } catch { throw new HttpError(400, 'invalid_json'); }
      if (!input || !['create', 'pull', 'push'].includes(input.action || '')) throw new HttpError(400, 'invalid_action');
      const id = hash(token);
      const current = await repository.get(id);
      const read = async (head: Head) => ({ version: head.version, snapshot: decrypt(await repository.download(head.object_key), token) });
      if (input.action === 'pull') {
        if (!current) throw new HttpError(404, 'space_not_found');
        return reply(200, await read(current));
      }
      if (!input.operationId || !/^[a-f0-9-]{36}$/i.test(input.operationId) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion! < 0) throw new HttpError(400, 'invalid_write');
      let snapshot: DiarySnapshot;
      try { snapshot = parseSnapshot(input.snapshot); }
      catch { throw new HttpError(400, 'invalid_snapshot'); }
      const contentHash = hash(JSON.stringify(snapshot));
      if (current?.operation_id === input.operationId) {
        if (current.content_hash !== contentHash) throw new HttpError(400, 'operation_reused');
        return reply(200, await read(current));
      }
      if (input.action === 'create') {
        if (input.expectedVersion !== 0) throw new HttpError(400, 'invalid_initial_version');
        if (current) throw new HttpError(409, 'token_exists');
      } else {
        if (!current) throw new HttpError(404, 'space_not_found');
        if (current.version !== input.expectedVersion) throw new HttpError(409, 'version_conflict');
      }
      const version = input.expectedVersion! + 1;
      const key = `${id}/${version}-${randomUUID()}.bin`;
      const next: Head = { id, version, object_key: key, operation_id: input.operationId, content_hash: contentHash };
      await repository.upload(key, encrypt(snapshot, token));
      let committed: boolean;
      try { committed = input.action === 'create' ? await repository.create(next) : await repository.compareAndSet(id, input.expectedVersion!, next); }
      catch (error) {
        // A failed transport can hide a committed DB write. Never delete its file.
        throw error;
      }
      if (!committed) {
        try { await repository.remove(key); } catch { /* An unreferenced encrypted object can be cleaned up later. */ }
        const head = await repository.get(id);
        if (head?.operation_id === input.operationId && head.content_hash === contentHash) return reply(200, await read(head));
        throw new HttpError(409, input.action === 'create' ? 'token_exists' : 'version_conflict');
      }
      // Never remove the previous head here: a reader may still be downloading it.
      return reply(200, { version, snapshot });
    } catch (error) {
      if (error instanceof HttpError) return reply(error.status, { error: error.code });
      // No credentials, request headers or diary content in logs/responses.
      const fault = error as { syncStage?: string; code?: unknown };
      const safeCode = typeof fault?.code === 'string' && /^(?:[A-Z_][A-Z0-9_]{2,48}|PGRST\d{3}|\d{5})$/.test(fault.code) ? fault.code : undefined;
      const stage = typeof fault?.syncStage === 'string' && ['metadata_read', 'metadata_create', 'metadata_update', 'file_upload', 'file_download', 'file_remove'].includes(fault.syncStage) ? fault.syncStage : undefined;
      return reply(503, { error: 'sync_unavailable', ...(stage ? { stage } : {}), ...(safeCode ? { code: safeCode } : {}) });
    }
  };
}
