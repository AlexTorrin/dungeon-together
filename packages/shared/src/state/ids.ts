/**
 * Выдаёт id новой сущности из счётчика GameState.nextId: `${prefix}-${nextId}`.
 * Возвращает id и новое значение счётчика — его нужно записать обратно в состояние.
 */
export function allocateId(nextId: number, prefix: string): readonly [string, number] {
  return [`${prefix}-${nextId}`, nextId + 1];
}
