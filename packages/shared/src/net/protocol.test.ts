import { describe, expect, it } from 'vitest';
import { parseCreateOptions, parseJoinOptions, parseName, parseRoomCode } from './protocol';

describe('protocol: разбор недоверенных данных', () => {
  it('сложность — только известная, иначе средняя', () => {
    expect(parseCreateOptions({ difficulty: 'hard' })).toEqual({ difficulty: 'hard' });
    expect(parseCreateOptions({ difficulty: 'toString' })).toEqual({ difficulty: 'medium' });
    expect(parseCreateOptions(null)).toEqual({ difficulty: 'medium' });
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
