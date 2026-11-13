import { beforeEach, describe, expect, it } from 'vitest';
import { createEntry, readEntries, saveEntries, mergeEntries, localDate, persistSettings, readSettings } from './journal';

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
    const settings = { provider: 'deepseek' as const, rememberKeys: true, keys: { deepseek: 'secret', minimax: '' } };
    persistSettings(localStorage, settings);
    expect(localStorage.getItem('little-days.settings.v1')).toContain('secret');
    persistSettings(localStorage, { ...settings, rememberKeys: false });
    expect(localStorage.getItem('little-days.settings.v1')).not.toContain('secret');
  });
});
