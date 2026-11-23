'use strict';
const cloudbase = require('@cloudbase/js-sdk');
const { createSyncHandler } = require('./service.cjs');
let handler;
async function step(stage, action) {
  try { return await action(); }
  catch (error) {
    const message = String(error?.message || '');
    const code = error?.code || (message.includes('Missing storage authorization') ? 'MISSING_STORAGE_TOKEN'
      : message.includes('getClientCredential') ? 'SDK_CREDENTIAL_METHOD'
      : message.includes('setHeader') ? 'SDK_HEADER_METHOD'
      : message.includes('fetch failed') ? 'SDK_FETCH_FAILED'
      : error?.name === 'TypeError' ? 'SDK_TYPE_ERROR' : 'SDK_OPERATION_FAILED');
    throw Object.assign(new Error('CloudBase operation failed'), { syncStage: stage, code });
  }
}

exports.main = async event => {
  if (!handler) {
    // Keep the PG environment's API key in the function runtime only.
    // Temporary identity exchange was rejected by the deployed trial environment.
    const app = cloudbase.init({ env: process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV,
      region: 'ap-shanghai', ...(process.env.CLOUDBASE_APIKEY ? { accessKey: process.env.CLOUDBASE_APIKEY } : {}) });
    const db = app.rdb();
    const bucket = app.storage.from('little-days-private');
    // PG storage binary requests cannot use the SDK's JSON V3-signing path.
    // Exchange the existing temporary function identity for a short-lived token.
    async function authorizeStorage() {
      const credential = await app.auth.getClientCredential();
      const token = typeof credential === 'string' ? credential : credential?.access_token || credential?.data?.access_token || credential?.accessToken;
      if (!token) throw Object.assign(new Error('Missing storage authorization'), {
        code: credential?.code || credential?.error || (credential?.data ? 'CREDENTIAL_DATA_ENVELOPE' : credential?.accessToken ? 'CREDENTIAL_CAMEL_CASE' : 'MISSING_STORAGE_TOKEN'),
      });
      bucket.setHeader('Authorization', `Bearer ${token}`);
    }
    const repository = {
      async get(id) {
        return step('metadata_read', async () => {
        const { data, error } = await db.from('little_days_sync').select('*').eq('id', id);
        if (error) throw error;
        return data?.[0] || null;
        });
      },
      async create(head) {
        return step('metadata_create', async () => {
        const { error } = await db.from('little_days_sync').insert(head);
        if (error?.code === '23505') return false;
        if (error) throw error;
        return true;
        });
      },
      async compareAndSet(id, expected, next) {
        return step('metadata_update', async () => {
        const { count, error } = await db.from('little_days_sync').update(next, { count: 'exact' }).eq('id', id).eq('version', expected);
        if (error) throw error;
        // Require exact affected-row evidence; never assume success on null count.
        if (count === null || count === undefined) throw new Error('Missing affected row count');
        return count === 1;
        });
      },
      async upload(key, bytes) {
        return step('file_upload', async () => {
        await authorizeStorage();
        const { error } = await bucket.upload(key, bytes, { contentType: 'application/octet-stream', upsert: false });
        if (error) throw error;
        });
      },
      async download(key) {
        return step('file_download', async () => {
        await authorizeStorage();
        const { data, error } = await bucket.download(key);
        if (error || !data) throw error || new Error('Missing private snapshot');
        return Buffer.from(await data.arrayBuffer());
        });
      },
      async remove(key) { return step('file_remove', async () => { await authorizeStorage(); const { error } = await bucket.remove([key]); if (error) throw error; }); },
    };
    const origins = (process.env.SYNC_ALLOWED_ORIGINS || 'https://xr-su.github.io,http://localhost:5173,http://127.0.0.1:5173').split(',').map(s => s.trim()).filter(Boolean);
    handler = createSyncHandler(repository, origins);
  }
  return handler(event);
};
