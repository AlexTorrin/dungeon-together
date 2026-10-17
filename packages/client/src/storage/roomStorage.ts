import { parseRoom, serializeRoom, type Room } from '@dt/shared';
import { randomId } from './randomId';

const STORAGE_KEY = 'dt.rooms.v1';

export interface SavedRoom {
  readonly id: string;
  readonly name: string;
  readonly room: Room;
}

interface StoredRoom {
  id: string;
  name: string;
  ascii: string;
}

function isStoredRoom(value: unknown): value is StoredRoom {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['id'] === 'string' && typeof v['name'] === 'string' && typeof v['ascii'] === 'string'
  );
}

function readStored(): StoredRoom[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isStoredRoom) : [];
  } catch {
    return [];
  }
}

function writeStored(rooms: readonly StoredRoom[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
}

/** Комнаты из localStorage; битые записи молча пропускаются. */
export function loadRooms(): SavedRoom[] {
  return readStored().flatMap((stored) => {
    try {
      return [{ id: stored.id, name: stored.name, room: parseRoom(stored.ascii) }];
    } catch {
      return [];
    }
  });
}

/** Создаёт или перезаписывает комнату; возвращает её id. */
export function saveRoom(id: string | null, name: string, room: Room): string {
  const rooms = readStored();
  const entry: StoredRoom = { id: id ?? randomId(), name, ascii: serializeRoom(room) };
  const index = rooms.findIndex((r) => r.id === entry.id);
  if (index === -1) rooms.push(entry);
  else rooms[index] = entry;
  writeStored(rooms);
  return entry.id;
}

export function deleteRoom(id: string): void {
  writeStored(readStored().filter((r) => r.id !== id));
}
