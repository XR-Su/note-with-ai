import type { Head, Repository } from './service';

// Local contract verification only; production index.js uses CloudBase PG/files.
export class MemoryRepository implements Repository {
  heads = new Map<string, Head>();
  files = new Map<string, Buffer>();
  async get(id: string) { return this.heads.get(id) || null; }
  async create(head: Head) {
    if (this.heads.has(head.id)) return false;
    this.heads.set(head.id, { ...head }); return true;
  }
  async compareAndSet(id: string, expected: number, next: Head) {
    if (this.heads.get(id)?.version !== expected) return false;
    this.heads.set(id, { ...next }); return true;
  }
  async upload(key: string, bytes: Buffer) { this.files.set(key, Buffer.from(bytes)); }
  async download(key: string) { const bytes = this.files.get(key); if (!bytes) throw new Error('Missing object'); return Buffer.from(bytes); }
  async remove(key: string) { this.files.delete(key); }
}
