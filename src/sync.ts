import { ENTRIES_KEY, readEntries } from './journal';
import { diarySnapshot, parseSnapshot, TOKEN_PATTERN } from './sync-format';
import type { DiarySnapshot } from './sync-format';
import type { Entry } from './types';

export const SYNC_KEY = 'little-days.sync.v1';
export const SYNC_BACKUPS_KEY = 'little-days.sync-backups.v1';
const TRANSACTION_KEY = 'little-days.sync-replacement.v1';
export interface SyncBackup { id: string; date: string; entries: Entry[] }
interface PendingWrite { action: 'create' | 'push'; operationId: string; expectedVersion: number; snapshot: DiarySnapshot }
export interface SyncState { token: string; version: number; dirty: boolean; lastSyncedAt: string; pending?: PendingWrite }
export type SyncStatus = 'disabled' | 'syncing' | 'synced' | 'pending' | 'offline' | 'error' | 'backup';
export interface SyncView { status: SyncStatus; message: string; lastSyncedAt: string; token: string; backups: SyncBackup[] }
interface Remote { version: number; snapshot: DiarySnapshot }
export interface SyncPort { read: () => Entry[]; canWrite: () => boolean; canReplace: () => boolean; replace: (entries: Entry[]) => void; changed: (view: SyncView) => void }

export function readSync(storage: Storage): SyncState | null {
  const raw = storage.getItem(SYNC_KEY);
  if (raw === null) return null;
  const v = JSON.parse(raw) as SyncState;
  if (!v || !TOKEN_PATTERN.test(v.token) || !Number.isSafeInteger(v.version) || v.version < 0 || typeof v.dirty !== 'boolean' || typeof v.lastSyncedAt !== 'string') throw new Error('同步设置损坏，已暂停云端读写；本地日记保留。');
  if (v.pending) {
    if (!['create', 'push'].includes(v.pending.action) || !Number.isSafeInteger(v.pending.expectedVersion) || v.pending.expectedVersion < 0 || typeof v.pending.operationId !== 'string' || !v.pending.operationId) throw new Error('待上传记录损坏，已暂停同步。');
    v.pending.snapshot = parseSnapshot(v.pending.snapshot);
  }
  return v;
}

export function readSyncBackups(storage: Storage): SyncBackup[] {
  const raw = storage.getItem(SYNC_BACKUPS_KEY);
  if (raw === null) return [];
  const backups = JSON.parse(raw) as SyncBackup[];
  if (!Array.isArray(backups) || backups.length > 5) throw new Error('本地同步备份损坏，已停止覆盖。');
  return backups.map(b => {
    if (!b || typeof b.id !== 'string' || typeof b.date !== 'string') throw new Error('本地同步备份损坏，已停止覆盖。');
    return { id: b.id, date: b.date, entries: diarySnapshot(b.entries).entries };
  });
}

// Roll back an interrupted two-key replacement before the App reads its journal.
export function recoverSyncReplacement(storage: Storage): void {
  const raw = storage.getItem(TRANSACTION_KEY);
  if (!raw) return;
  const transaction = JSON.parse(raw) as { entries: string | null; sync: string | null };
  if (!transaction || ![transaction.entries, transaction.sync].every(v => v === null || typeof v === 'string')) throw new Error('同步覆盖记录损坏，请先导出原始本地数据。');
  if (transaction.entries !== null) diarySnapshot(JSON.parse(transaction.entries));
  if (transaction.sync !== null) {
    const state = JSON.parse(transaction.sync) as SyncState;
    if (!TOKEN_PATTERN.test(state.token)) throw new Error('同步恢复凭据损坏。');
  }
  if (transaction.entries === null) storage.removeItem(ENTRIES_KEY); else storage.setItem(ENTRIES_KEY, transaction.entries);
  if (transaction.sync === null) storage.removeItem(SYNC_KEY); else storage.setItem(SYNC_KEY, transaction.sync);
  storage.removeItem(TRANSACTION_KEY);
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `ld1_${btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`;
}

export class DiarySync {
  private state: SyncState | null = null;
  private running = false;
  private disposed = false;
  private again = false;
  private timer?: ReturnType<typeof setTimeout>;
  private request?: AbortController;
  private backups: SyncBackup[] = [];
  private broken = false;
  private collisions = 0;
  private status: SyncStatus = 'disabled';
  private message = '未开启云同步';
  constructor(private storage: Storage, private endpoint: string, private port: SyncPort, private fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    try {
      this.state = readSync(storage);
      this.backups = readSyncBackups(storage);
      if (this.state) { this.status = 'pending'; this.message = '正在准备同步'; }
    } catch (error) { this.broken = true; this.status = 'error'; this.message = (error as Error).message; }
    this.emit();
  }
  get connected(): boolean { return this.state !== null; }
  private emit() { if (!this.disposed) this.port.changed({ status: this.status, message: this.message, token: this.state?.token || '', lastSyncedAt: this.state?.lastSyncedAt || '', backups: this.backups }); }
  private setStatus(status: SyncStatus, message: string) { this.status = status; this.message = message; this.emit(); }
  private persist(next: SyncState) { this.storage.setItem(SYNC_KEY, JSON.stringify(next)); this.state = next; }
  private check() {
    if (this.broken) throw new Error(this.message);
    if (!this.port.canWrite()) throw new Error('本地存储不可写，云同步已暂停。');
    if (!this.endpoint) throw new Error('云同步服务尚未配置。');
  }
  markDirty() {
    if (!this.state || this.broken) return;
    this.persist({ ...this.state, dirty: true });
    this.setStatus('pending', '本地修改待上传');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.sync(); }, 2000);
  }
  async create() {
    this.check();
    if (this.state || this.running) throw new Error('当前设备已经连接同步空间。');
    const snapshot = diarySnapshot(this.port.read());
    this.persist({ token: newToken(), version: 0, dirty: true, lastSyncedAt: '', pending: { action: 'create', operationId: crypto.randomUUID(), expectedVersion: 0, snapshot } });
    this.emit();
    await this.sync();
  }
  async connect(token: string) {
    this.check();
    if (this.state || this.running) throw new Error('当前设备已经连接同步空间。');
    if (!TOKEN_PATTERN.test(token)) throw new Error('请粘贴或扫描系统生成的完整同步口令。');
    this.running = true;
    this.setStatus('syncing', '正在连接已有空间');
    try {
      const remote = await this.call(token, { action: 'pull' });
      if (this.disposed) return;
      this.check();
      if (!this.port.canReplace()) throw new Error('请先完成当前回答编辑或 AI 请求，再连接。');
      this.apply(remote, { token, version: remote.version, dirty: false, lastSyncedAt: new Date().toISOString() }, true);
      this.setStatus('backup', '已连接，覆盖前的本地日记已备份');
    } catch (error) { this.setStatus('error', (error as Error).message); throw error; }
    finally { this.running = false; }
  }
  private async call(token: string, body: object): Promise<Remote> {
    const controller = new AbortController();
    this.request = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await this.fetcher(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store' });
      if (response.status === 409) {
        let code = 'version_conflict';
        try { code = (await response.json() as { error: string }).error; } catch { /* Unknown conflicts still preserve local data. */ }
        throw new SyncConflict(code);
      }
      if (response.status === 401 || response.status === 404) throw new Error('同步口令无效或空间不存在，本地日记已保留。');
      if (response.status === 413) throw new Error('日记文件过大，同步已暂停；请导出备份。');
      if (!response.ok) throw new Error(`云同步暂时失败（${response.status}），本地日记已保留。`);
      const raw = await response.text();
      if (new TextEncoder().encode(raw).byteLength > 5 * 1024 * 1024) throw new Error('云端文件过大，已停止下载覆盖。');
      const result = JSON.parse(raw) as Remote;
      if (!Number.isSafeInteger(result.version) || result.version < 1) throw new Error('云端版本无效，本地日记已保留。');
      return { version: result.version, snapshot: parseSnapshot(result.snapshot) };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('同步已取消或超时，本地内容已保留，稍后可重试。');
      if (error instanceof TypeError) throw new Error('无法连接云同步服务，请检查网络；本地内容已保留。');
      throw error;
    } finally { clearTimeout(timeout); if (this.request === controller) this.request = undefined; }
  }
  private apply(remote: Remote, next: SyncState, forceBackup = false) {
    this.check();
    const before = this.port.read();
    const differs = JSON.stringify(diarySnapshot(before).entries) !== JSON.stringify(remote.snapshot.entries);
    let backups = this.backups;
    if (differs || forceBackup) {
      backups = [{ id: crypto.randomUUID(), date: new Date().toISOString(), entries: diarySnapshot(before).entries }, ...readSyncBackups(this.storage)].slice(0, 5);
      this.storage.setItem(SYNC_BACKUPS_KEY, JSON.stringify(backups));
    }
    const transaction = { entries: this.storage.getItem(ENTRIES_KEY), sync: this.storage.getItem(SYNC_KEY) };
    this.storage.setItem(TRANSACTION_KEY, JSON.stringify(transaction));
    try {
      this.storage.setItem(ENTRIES_KEY, JSON.stringify(remote.snapshot.entries));
      this.storage.setItem(SYNC_KEY, JSON.stringify(next));
      this.storage.removeItem(TRANSACTION_KEY);
    } catch {
      try { recoverSyncReplacement(this.storage); } catch { this.broken = true; }
      throw new Error('本地保存失败，已停止云端覆盖；请导出当前内容后处理存储问题。');
    }
    this.state = next;
    this.backups = backups;
    this.port.replace(remote.snapshot.entries);
  }
  private async sendPending(): Promise<boolean> {
    const state = this.state!;
    if (!state.pending) return false;
    const pending = state.pending;
    try {
      const remote = await this.call(state.token, pending);
      if (this.disposed) return false;
      this.check();
      const dirty = JSON.stringify(diarySnapshot(this.port.read())) !== JSON.stringify(pending.snapshot);
      this.persist({ ...this.state!, version: remote.version, dirty, pending: undefined, lastSyncedAt: new Date().toISOString() });
      return true;
    } catch (error) {
      if (!(error instanceof SyncConflict)) throw error;
      if (pending.action === 'create') {
        if (error.message !== 'token_exists' || ++this.collisions > 3) throw new Error('无法分配唯一同步口令，请稍后重试。');
        this.persist({ ...state, token: newToken(), pending: { ...pending, operationId: crypto.randomUUID() } });
        this.again = true;
        this.setStatus('pending', '正在重新分配唯一同步口令');
        return false;
      }
      // The new cloud head wins; preserve the latest local content before applying it.
      const remote = await this.call(state.token, { action: 'pull' });
      if (this.disposed) return false;
      if (!this.port.canReplace()) throw new Error('云端已有更新，完成当前编辑或 AI 请求后将备份并下载。');
      this.apply(remote, { ...this.state!, version: remote.version, dirty: false, pending: undefined, lastSyncedAt: new Date().toISOString() });
      this.setStatus('backup', '云端更新已下载，本地内容已备份');
      return false;
    }
  }
  async sync(): Promise<void> {
    if (this.disposed || !this.state || this.broken) return;
    if (this.running) { this.again = true; return; }
    if (!navigator.onLine) { this.setStatus('offline', '离线，本地内容待联网同步'); return; }
    this.running = true;
    clearTimeout(this.timer);
    this.setStatus('syncing', '正在同步云端日记');
    try {
      this.check();
      if (this.state.pending && !await this.sendPending()) return;
      if (this.disposed) return;
      const remote = await this.call(this.state.token, { action: 'pull' });
      if (this.disposed) return;
      this.check();
      if (remote.version < this.state.version) throw new Error('云端版本倒退，已暂停同步并保留本地日记。');
      if (remote.version !== this.state.version) {
        if (!this.port.canReplace()) throw new Error('云端已有更新，完成当前编辑或 AI 请求后将备份并下载。');
        this.apply(remote, { ...this.state, version: remote.version, dirty: false, pending: undefined, lastSyncedAt: new Date().toISOString() });
        this.setStatus('backup', '云端更新已下载，本地内容已备份');
        return;
      }
      if (this.state.dirty) {
        this.persist({ ...this.state, pending: { action: 'push', operationId: crypto.randomUUID(), expectedVersion: this.state.version, snapshot: diarySnapshot(this.port.read()) } });
        if (!await this.sendPending()) return;
      } else this.persist({ ...this.state, lastSyncedAt: new Date().toISOString() });
      this.setStatus(this.state.dirty ? 'pending' : 'synced', this.state.dirty ? '本地新修改待上传' : '云端与本地已同步');
      if (this.state.dirty) this.again = true;
    } catch (error) { if (!this.disposed) this.setStatus(navigator.onLine ? 'error' : 'offline', (error as Error).message); }
    finally {
      this.running = false;
      if (this.again && !this.disposed) { this.again = false; this.timer = setTimeout(() => { void this.sync(); }, 2000); }
    }
  }
  restore(id: string) {
    this.check();
    if (this.running || !this.port.canReplace()) throw new Error('请等待当前同步或编辑完成后恢复。');
    const backup = readSyncBackups(this.storage).find(b => b.id === id);
    if (!backup) throw new Error('备份不存在。');
    if (!this.state) throw new Error('请先连接同步空间。');
    this.apply({ version: this.state.version, snapshot: diarySnapshot(backup.entries) }, { ...this.state, dirty: true, pending: undefined }, true);
    this.markDirty();
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); this.request?.abort(); }
}
class SyncConflict extends Error {}
