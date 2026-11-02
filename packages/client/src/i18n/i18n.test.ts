import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from './en';
import { ru } from './ru';

beforeEach(() => {
  vi.resetModules();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('language catalogs', () => {
  it('contains a nonempty English translation with identical placeholders for every key', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
    const placeholders = (text: string): string[] =>
      [...text.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();
    for (const key of Object.keys(ru) as (keyof typeof ru)[]) {
      expect(en[key].trim(), key).not.toBe('');
      expect(en[key], key).not.toMatch(/[А-Яа-яЁё]/);
      expect(placeholders(en[key]), key).toEqual(placeholders(ru[key]));
    }
  });

  it('defaults to Russian and rejects unknown locales', async () => {
    const { getLocale, parseLocale, t } = await import('./index');
    expect(getLocale()).toBe('ru');
    expect(parseLocale('EN')).toBeNull();
    expect(parseLocale(null)).toBeNull();
    expect(t('menu.startAdventure')).toBe('Начать забег →');
  });

  it('updates item names and tooltips after switching without reloading modules', async () => {
    const { setLocale } = await import('./index');
    const { ITEM_NAMES, DIFFICULTY_NAMES } = await import('../ui/names');
    const { backpackTooltip, keyTooltip } = await import('../ui/itemTooltips');
    expect(ITEM_NAMES.knife).toBe('нож');
    setLocale('en');
    expect(ITEM_NAMES.knife).toBe('knife');
    expect(DIFFICULTY_NAMES.medium).toBe('normal');
    expect(backpackTooltip(null, 2)).toContain('Slot 2 is empty');
    expect(keyTooltip()).toContain('exit door');
    setLocale('ru');
    expect(ITEM_NAMES.knife).toBe('нож');
  });

  it('preserves user text literally when interpolating and handles numeric parameters', async () => {
    const { setLocale, t } = await import('./index');
    setLocale('en');
    expect(t('menu.deleteRoom', '$& {0}')).toBe('Delete room “$& {0}”?');
    expect(t('menu.backpack', 2, 4)).toBe('Backpack: 2 / 4');
  });

  it('restores the chosen language from storage', async () => {
    const { setLocale } = await import('./index');
    setLocale('en');
    expect(localStorage.getItem('dt.locale.v1')).toBe('en');
    vi.resetModules();
    expect((await import('./index')).getLocale()).toBe('en');
  });

  it('ignores unsupported saved languages', async () => {
    localStorage.setItem('dt.locale.v1', 'xx');
    expect((await import('./index')).getLocale()).toBe('ru');
  });

  it('keeps working when browser storage is blocked', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    const { getLocale, setLocale, t } = await import('./index');
    expect(getLocale()).toBe('ru');
    setLocale('en');
    expect(getLocale()).toBe('en');
    expect(t('menu.startAdventure')).toBe('Start adventure →');
  });
});
