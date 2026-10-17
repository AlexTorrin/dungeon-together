import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { EMPTY_PROFILE, parseProfile, type Profile } from '@dt/shared';

/**
 * Профили игроков в JSON-файле: { [sha256(токен)]: Profile }. Храним хеш, а не сам токен:
 * утечка файла не даёт войти чужим профилем. Всё держим в памяти, файл перезаписываем
 * целиком после каждого изменения — для десятков игроков этого достаточно.
 */
export class ProfileStore {
  private readonly profiles = new Map<string, Profile>();
  /** Записи идут по одной, по порядку: следующая ждёт предыдущую. */
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; // первый запуск
      throw error;
    }
    // Битый файл — не стираем молча чужой прогресс: пусть сервер не стартует, пока не разберутся.
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) throw new Error(`${file}: ожидался объект`);
    for (const [key, value] of Object.entries(data)) {
      const profile = parseProfile(value);
      if (!profile) throw new Error(`${file}: битый профиль ${key}`);
      this.profiles.set(key, profile);
    }
  }

  get(token: string): Profile {
    return this.profiles.get(hash(token)) ?? EMPTY_PROFILE;
  }

  /** Меняет профиль и сохраняет файл; дождаться записи — await. */
  set(token: string, profile: Profile): Promise<void> {
    this.profiles.set(hash(token), profile);
    const snapshot = JSON.stringify(Object.fromEntries(this.profiles), null, 1);
    this.writing = this.writing.then(() => writeAtomically(this.file, snapshot));
    return this.writing;
  }
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Сначала во временный файл, потом rename: при сбое посреди записи старый файл цел. */
async function writeAtomically(file: string, content: string): Promise<void> {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, file);
}
