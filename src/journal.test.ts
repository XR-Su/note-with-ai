import { beforeEach, describe, expect, it } from 'vitest';
import { archivedContext, createEntry, defaultSettings, readEntries, saveEntries, mergeEntries, localDate, persistSettings, readSettings } from './journal';

describe('local journal', () => {
  beforeEach(() => localStorage.clear());
  it('creates a single daily entry per local calendar date', () => {
    const first = createEntry([], 'daily', new Date(2026, 10, 13, 23));
    const next = createEntry([first], 'daily', new Date(2026, 10, 13, 23, 59));
    expect(first).toBeDefined();
    expect(next.id).toBe(first.id);
    expect(first.date).toBe('2026-11-13');
  });
  it('creates independent memories', () => {
    const first = createEntry([], 'memory');
    expect(first).toBeDefined();
    expect(createEntry([first], 'memory').id).not.toBe(first.id);
  });
  it('uses local rather than UTC calendar dates', () => {
    expect(localDate(new Date(2026, 0, 2, 0, 1))).toBe('2026-01-02');
  });
  it('round trips entries', () => {
    const entry = createEntry([], 'daily');
    saveEntries(localStorage, [entry]);
    expect(readEntries(localStorage)).toEqual([entry]);
  });
  it('rejects corrupt storage without overwriting it', () => {
    localStorage.setItem('little-days.entries.v1', '{broken');
    expect(() => readEntries(localStorage)).toThrow(/损坏/);
    expect(localStorage.getItem('little-days.entries.v1')).toBe('{broken');
  });
  it('surfaces quota errors', () => {
    const storage = { setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
    expect(() => saveEntries(storage, [])).toThrow(/保存/);
  });
  it('rejects invalid import shapes', () => {
    expect(() => mergeEntries([], [{ id: 'bad' }])).toThrow(/格式/);
  });
  it('rejects duplicate or empty message IDs in backups', () => {
    const entry = createEntry([], 'memory');
    entry.messages.push({ ...entry.messages[0] });
    expect(() => mergeEntries([], [entry])).toThrow(/格式/);
    entry.messages = [{ ...entry.messages[0], id: '' }];
    expect(() => mergeEntries([], [entry])).toThrow(/格式/);
  });
  it('can load merged collections beyond 10000 records', () => {
    const records = Array.from({ length: 10001 }, () => createEntry([], 'memory'));
    saveEntries(localStorage, mergeEntries(records.slice(0, 5000), records.slice(5000)));
    expect(readEntries(localStorage)).toHaveLength(10001);
  });
  it('rejects invalid outgoing data without replacing a saved record', () => {
    const entry = createEntry([], 'memory');
    saveEntries(localStorage, [entry]);
    expect(() => saveEntries(localStorage, [{ ...entry, messages: [{ ...entry.messages[0], id: '' }] }])).toThrow(/格式/);
    expect(readEntries(localStorage)).toEqual([entry]);
  });
  it('ignores stored keys when the persistence flag is not exactly true', () => {
    localStorage.setItem('little-days.settings.v1', JSON.stringify({ rememberKeys: 'yes', keys: { deepseek: 'secret' } }));
    expect(readSettings(localStorage).keys.deepseek).toBe('');
  });
  it('merges a backup without duplicating daily dates', () => {
    const first = createEntry([], 'daily');
    const other = { ...first, id: 'other' };
    expect(mergeEntries([first], [other])).toEqual([first]);
  });
  it('does not persist keys without opt-in and removes formerly saved keys', () => {
    const settings = { ...defaultSettings, rememberKeys: true, keys: { deepseek: 'secret', minimax: '' } };
    persistSettings(localStorage, settings);
    expect(localStorage.getItem('little-days.settings.v1')).toContain('secret');
    persistSettings(localStorage, { ...settings, rememberKeys: false });
    expect(localStorage.getItem('little-days.settings.v1')).not.toContain('secret');
  });
  it.each([undefined, null, '30', -1, 181, 1.5])('defaults missing or invalid memory days %s to zero', memoryDays => {
    localStorage.setItem('little-days.settings.v1', JSON.stringify({ memoryDays }));
    expect(readSettings(localStorage).memoryDays).toBe(0);
  });
  it.each([0, 1, 180])('persists memory days %s independently of key opt-in', memoryDays => {
    persistSettings(localStorage, { ...defaultSettings, memoryDays, keys: { deepseek: 'secret', minimax: '' } });
    expect(readSettings(localStorage).memoryDays).toBe(memoryDays);
    expect(readSettings(localStorage).keys.deepseek).toBe('');
  });
  it('rejects invalid memory settings without replacing stored preferences', () => {
    persistSettings(localStorage, { ...defaultSettings, memoryDays: 30 });
    expect(() => persistSettings(localStorage, { ...defaultSettings, memoryDays: 181 })).toThrow(/0–180/);
    expect(readSettings(localStorage).memoryDays).toBe(30);
  });
  it('selects only prior archived daily summaries within the entry calendar window', () => {
    const current = createEntry([], 'daily', new Date(2026, 10, 23));
    const archived = (day: number) => ({ ...createEntry([], 'daily', new Date(2026, 10, day)), archived: true, title: `Day ${day}`, summary: `Summary ${day}` });
    const first = archived(20);
    const last = archived(22);
    const records = [last, archived(19), { ...archived(21), archived: false }, { ...archived(21), mode: 'memory' as const },
      { ...archived(21), summary: ' ' }, archived(23), archived(24), { ...first, date: '2026-11-31' }, first];
    expect(archivedContext(records, current, 3)).toEqual([
      { date: first.date, title: first.title, summary: first.summary },
      { date: last.date, title: last.title, summary: last.summary },
    ]);
    expect(archivedContext(records, current, 0)).toEqual([]);
    expect(archivedContext(records, { ...current, mode: 'memory' }, 180)).toEqual([]);
    expect(archivedContext(records, current, 181)).toEqual([]);
    expect(archivedContext(records, { ...current, date: '2026-02-30' }, 180)).toEqual([]);
  });
  it('handles leap days and the inclusive 180-day boundary without accessing old messages', () => {
    const current = createEntry([], 'daily', new Date(2024, 2, 1));
    const historical = (date: string) => ({ ...createEntry([], 'daily'), date, archived: true, title: date, summary: 'An archived story.',
      get messages(): never { throw new Error('Old conversations must not be read'); } });
    const oldest = new Date(Date.UTC(2024, 2, 1) - 180 * 86400000).toISOString().slice(0, 10);
    const outside = new Date(Date.UTC(2024, 2, 1) - 181 * 86400000).toISOString().slice(0, 10);
    expect(archivedContext([historical('2024-02-29'), historical(oldest), historical(outside)], current, 180).map(e => e.date)).toEqual([oldest, '2024-02-29']);
    expect(archivedContext([historical('2024-02-29')], current, 1)).toHaveLength(1);
  });
});
