import { validateEntries } from './journal';
import type { Entry, Message } from './types';

export interface DiarySnapshot { version: 1; entries: Entry[] }
export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
export const TOKEN_PATTERN = /^ld1_[A-Za-z0-9_-]{43}$/;

// Project only diary fields: imported extra properties must never upload keys/settings.
export function diarySnapshot(entries: unknown): DiarySnapshot {
  const safe = validateEntries(entries).map(e => {
    const date = new Date(`${e.date}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== e.date) throw new Error('日记日期无效。');
    const messages: Message[] = e.messages.map(m => {
      const result: Message = { id: m.id, role: m.role, content: m.content };
      for (const key of ['english', 'explanation', 'chinese'] as const) if (m[key] !== undefined) result[key] = m[key];
      if (m.translation !== undefined) result.translation = m.translation;
      return result;
    });
    return { id: e.id, mode: e.mode, date: e.date, title: e.title, createdAt: e.createdAt,
      updatedAt: e.updatedAt, archived: e.archived, summary: e.summary, draft: e.draft, messages };
  });
  const snapshot: DiarySnapshot = { version: 1, entries: safe };
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_SNAPSHOT_BYTES) throw new Error('日记超过 4 MB，同步已暂停；请先导出备份。');
  return snapshot;
}

export function parseSnapshot(value: unknown): DiarySnapshot {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('entries' in value)) throw new Error('云端日记格式不受支持，本地日记已保留。');
  return diarySnapshot(value.entries);
}
