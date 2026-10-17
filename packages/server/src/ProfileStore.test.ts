import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMPTY_PROFILE, type Profile } from '@dt/shared';
import { ProfileStore } from './ProfileStore';

const file = (): string => join(mkdtempSync(join(tmpdir(), 'dt-')), 'profiles.json');
const TOKEN = 'token-for-test-000000';
const rich: Profile = { coins: 9, hands: 'bow', backpack: ['knife'], chest: [] };

describe('ProfileStore', () => {
  it('новый игрок — пустой профиль; записанное переживает перезапуск', async () => {
    const path = file();
    const store = new ProfileStore(path);
    expect(store.get(TOKEN)).toEqual(EMPTY_PROFILE);
    await store.set(TOKEN, rich);
    expect(new ProfileStore(path).get(TOKEN)).toEqual(rich);
  });

  it('в файле — хеш токена, а не сам токен', async () => {
    const path = file();
    await new ProfileStore(path).set(TOKEN, rich);
    const content = readFileSync(path, 'utf8');
    expect(content).not.toContain(TOKEN);
    expect(Object.keys(JSON.parse(content) as object)[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('битый файл — ошибка при старте, а не молчаливо пустые профили', () => {
    const path = file();
    writeFileSync(path, JSON.stringify({ abc: { coins: -5 } }));
    expect(() => new ProfileStore(path)).toThrow(/битый профиль/);
  });
});
