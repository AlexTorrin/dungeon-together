/**
 * Случайный seed для новой локальной игры или уровня. Случайность берётся здесь, в клиенте:
 * shared детерминирован и получает seed готовым. В сетевой игре seed будет выбирать сервер.
 */
export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}
