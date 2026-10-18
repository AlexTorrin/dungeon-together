import { describe, expect, it } from 'vitest';
import {
  MAX_CUSTOM_ROOM_SIZE,
  parseCreateOptions,
  parseJoinOptions,
  parseName,
  parseRoomCode,
} from './protocol';

describe('protocol: разбор недоверенных данных', () => {
  it('сложность — только известная, иначе средняя', () => {
    const dungeon = { kind: 'dungeon' };
    expect(parseCreateOptions({ difficulty: 'hard' })).toEqual({ ...dungeon, difficulty: 'hard' });
    expect(parseCreateOptions({ difficulty: 'toString' })).toEqual({
      ...dungeon,
      difficulty: 'medium',
    });
    expect(parseCreateOptions(null)).toEqual({ ...dungeon, difficulty: 'medium' });
  });

  it('своя комната — из ASCII, с названием', () => {
    const choice = parseCreateOptions({
      custom: { name: '  Арена  ', ascii: '#####\n#@.S#\n#####' },
    });
    expect(choice).toMatchObject({ kind: 'custom', name: 'Арена' });
    if (choice?.kind !== 'custom') throw new Error('ожидали свою комнату');
    expect(choice.room.spawn).toEqual({ x: 1, y: 1 });
    expect(choice.room.monsters).toHaveLength(1);
    expect(parseCreateOptions({ custom: { ascii: '#@#' } })).toMatchObject({
      name: 'Своя комната',
    });
  });

  it('негодная своя комната — null, а не подземелье по умолчанию', () => {
    expect(parseCreateOptions({ custom: { name: 'x', ascii: '#..#' } })).toBeNull(); // нет старта
    expect(parseCreateOptions({ custom: { ascii: '#@?#' } })).toBeNull(); // чужой символ
    expect(parseCreateOptions({ custom: { ascii: 42 } })).toBeNull();
    expect(parseCreateOptions({ custom: 'room' })).toBeNull();
    const wide = `@${'.'.repeat(MAX_CUSTOM_ROOM_SIZE)}`;
    expect(parseCreateOptions({ custom: { ascii: wide } })).toBeNull();
    const tall = ['@', ...Array.from({ length: MAX_CUSTOM_ROOM_SIZE }, () => '.')].join('\n');
    expect(parseCreateOptions({ custom: { ascii: tall } })).toBeNull();
  });

  it('имя обрезается, пустое — «Игрок»', () => {
    expect(parseName('  Вася   Пупкин  ')).toBe('Вася Пупкин');
    expect(parseName('x'.repeat(40))).toHaveLength(16);
    expect(parseName('   ')).toBe('Игрок');
    expect(parseName(42)).toBe('Игрок');
    const token = 'a'.repeat(32);
    expect(parseJoinOptions({ token })).toEqual({ name: 'Игрок', token });
    expect(parseJoinOptions({ name: 'Аня' })).toBeNull();
    expect(parseJoinOptions(undefined)).toBeNull();
  });

  it('код комнаты — 4 буквы без похожих на цифры, регистр не важен', () => {
    expect(parseRoomCode(' abcd ')).toBe('ABCD');
    expect(parseRoomCode('ABC')).toBeNull();
    expect(parseRoomCode('AB0D')).toBeNull();
    expect(parseRoomCode('ABIO')).toBeNull();
  });
});
