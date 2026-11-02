import { en } from './en';
import { ru } from './ru';

export type Locale = 'ru' | 'en';
export type TranslationKey = keyof typeof ru;
type Value = string | number;
/** Число аргументов выводится из последовательных {0}, {1}, … в русском каталоге. */
type Arguments<
  S extends string,
  A extends Value[] = [],
> = S extends `${string}{${A['length']}}${string}` ? Arguments<S, [...A, Value]> : A;

const STORAGE_KEY = 'dt.locale.v1';
const catalogs = { ru, en } as const;

export function parseLocale(value: unknown): Locale | null {
  return value === 'ru' || value === 'en' ? value : null;
}

function loadLocale(): Locale {
  try {
    return parseLocale(localStorage.getItem(STORAGE_KEY)) ?? 'ru';
  } catch {
    return 'ru';
  }
}

let locale: Locale = loadLocale();

export function getLocale(): Locale {
  return locale;
}

/** Меняем только представление; вызывающая сцена перерисовывает свой интерфейс. */
export function setLocale(next: Locale): void {
  locale = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // В приватном режиме выбор продолжает работать до перезагрузки страницы.
  }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}

export function t<K extends TranslationKey>(key: K, ...values: Arguments<(typeof ru)[K]>): string {
  const template: string = catalogs[locale][key];
  // Функция замены сохраняет буквальные $&, $` и фигурные скобки в именах игроков.
  return template.replace(/\{(\d+)\}/g, (_match, index: string) => String(values[Number(index)]));
}

if (typeof document !== 'undefined') document.documentElement.lang = locale;
