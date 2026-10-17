/**
 * Случайный id из 32 hex-символов (128 бит). Не crypto.randomUUID: он есть только в «безопасном
 * контексте» (https или localhost), а игру открывают и по http://домен. getRandomValues есть всегда.
 */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
