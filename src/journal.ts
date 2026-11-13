import type { Entry, Mode, Settings } from './types';

export const ENTRIES_KEY = 'little-days.entries.v1';
export const SETTINGS_KEY = 'little-days.settings.v1';
export const defaultSettings: Settings = { provider: 'deepseek', rememberKeys: false, keys: { deepseek: '', minimax: '' } };

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function createEntry(entries: Entry[], mode: Mode, now = new Date()): Entry {
  const date = localDate(now);
  const existing = entries.find(e => e.mode === 'daily' && e.date === date);
  if (mode === 'daily' && existing) return existing;
  return {
    id: crypto.randomUUID(), mode, date, title: mode === 'daily' ? '今天的小日子' : '一段想留住的回忆',
    createdAt: now.toISOString(), updatedAt: now.toISOString(), archived: false, summary: '', draft: '',
    messages: [{ id: crypto.randomUUID(), role: 'assistant',
      content: mode === 'daily' ? 'Let’s slow down for a moment. What is one little thing from today that stayed with you?' : 'Some moments stay with us. What memory would you like to revisit today?',
      chinese: mode === 'daily' ? '先让自己慢下来。今天，有哪件小事让你印象深刻？' : '有些瞬间，值得再一次回望。今天，你想聊聊哪一段回忆？' }],
  };
}

function validateEntries(value: unknown): Entry[] {
  if (!Array.isArray(value)) throw new Error('日记文件格式无效。');
  const ids = new Set<string>();
  const days = new Set<string>();
  for (const e of value) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !e.id || ids.has(e.id) ||
      !['daily', 'memory'].includes(e.mode) || typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) ||
      typeof e.archived !== 'boolean' || !['title', 'summary', 'draft', 'createdAt', 'updatedAt'].every(k => typeof e[k] === 'string') ||
      !Number.isFinite(Date.parse(e.createdAt)) || !Number.isFinite(Date.parse(e.updatedAt)) || !Array.isArray(e.messages) ||
      e.messages.some((m: Record<string, unknown>) => !m || typeof m.id !== 'string' || !['user', 'assistant'].includes(String(m.role)) || typeof m.content !== 'string' ||
        ['english', 'explanation', 'chinese'].some(k => m[k] !== undefined && typeof m[k] !== 'string') ||
        (m.translation !== undefined && typeof m.translation !== 'boolean'))) throw new Error('日记文件格式无效。');
    const messageIds = e.messages.map((m: { id: string }) => m.id);
    if (messageIds.some((id: string) => !id) || new Set(messageIds).size !== messageIds.length) throw new Error('日记文件格式无效：回答 ID 重复或为空。');
    if (e.mode === 'daily' && days.has(e.date)) throw new Error('日记文件格式无效：同一天存在多篇日记。');
    ids.add(e.id);
    if (e.mode === 'daily') days.add(e.date);
  }
  return value as Entry[];
}

export function readEntries(storage: Pick<Storage, 'getItem'>): Entry[] {
  try {
    const raw = storage.getItem(ENTRIES_KEY);
    return raw === null ? [] : validateEntries(JSON.parse(raw));
  } catch { throw new Error('本地日记无法读取或已损坏。为保护记录，已停止写入；请先导出原始数据备份。'); }
}

export function saveEntries(storage: Pick<Storage, 'setItem'>, entries: Entry[]): void {
  validateEntries(entries);
  try { storage.setItem(ENTRIES_KEY, JSON.stringify(entries)); }
  catch { throw new Error('浏览器保存失败，可能空间不足或禁用了本地存储。当前内容仍在页面中，请立即导出备份，不要刷新。'); }
}

export function mergeEntries(existing: Entry[], imported: unknown): Entry[] {
  const incoming = validateEntries(imported);
  const result = [...existing];
  for (const entry of incoming) {
    if (result.some(e => e.id === entry.id || (e.mode === 'daily' && entry.mode === 'daily' && e.date === entry.date))) continue;
    result.push(entry);
  }
  return result;
}

export function persistSettings(storage: Pick<Storage, 'setItem'>, settings: Settings): void {
  try { storage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, keys: settings.rememberKeys ? settings.keys : { deepseek: '', minimax: '' } })); }
  catch { throw new Error('设置保存失败，请检查浏览器本地存储权限。'); }
}

export function readSettings(storage?: Pick<Storage, 'getItem'>): Settings {
  try {
    storage ??= localStorage;
    const s = JSON.parse(storage.getItem(SETTINGS_KEY) || 'null');
    if (!s) return { ...defaultSettings, keys: { ...defaultSettings.keys } };
    return { provider: s.provider === 'minimax' ? 'minimax' : 'deepseek', rememberKeys: s.rememberKeys === true,
      keys: { deepseek: s.rememberKeys === true && typeof s.keys?.deepseek === 'string' ? s.keys.deepseek : '', minimax: s.rememberKeys === true && typeof s.keys?.minimax === 'string' ? s.keys.minimax : '' } };
  } catch { return { ...defaultSettings, keys: { ...defaultSettings.keys } }; }
}
