import { describe, expect, it } from 'vitest';
import {
  parseCreateOptions,
  parseJoinOptions,
  parseLoadout,
  parseName,
  parseRoomCode,
} from './protocol';

describe('protocol: разбор недоверенных данных', () => {
  it('сложность — только известная, иначе средняя', () => {
    expect(parseCreateOptions({ difficulty: 'hard' })).toEqual({ difficulty: 'hard' });
    expect(parseCreateOptions({ difficulty: 'toString' })).toEqual({ difficulty: 'medium' });
    expect(parseCreateOptions(null)).toEqual({ difficulty: 'medium' });
  });

  it('снаряжение — известное оружие и рюкзак не больше 4, иначе пусто', () => {
    expect(parseLoadout({ weapon: 'bow', backpack: ['knife'] })).toEqual({
      weapon: 'bow',
      backpack: ['knife'],
    });
    const empty = { weapon: null, backpack: [] };
    expect(parseLoadout({ weapon: 'laser', backpack: [] })).toEqual(empty);
    expect(parseLoadout({ weapon: null, backpack: ['bow', 'bow', 'bow', 'bow', 'bow'] })).toEqual(
      empty,
    );
    expect(parseLoadout({ weapon: null, backpack: [1] })).toEqual(empty);
    expect(parseLoadout('bow')).toEqual(empty);
  });

  it('имя обрезается, пустое — «Игрок»', () => {
    expect(parseName('  Вася   Пупкин  ')).toBe('Вася Пупкин');
    expect(parseName('x'.repeat(40))).toHaveLength(16);
    expect(parseName('   ')).toBe('Игрок');
    expect(parseName(42)).toBe('Игрок');
    expect(parseJoinOptions(undefined)).toEqual({
      name: 'Игрок',
      loadout: { weapon: null, backpack: [] },
    });
  });

  it('код комнаты — 4 буквы без похожих на цифры, регистр не важен', () => {
    expect(parseRoomCode(' abcd ')).toBe('ABCD');
    expect(parseRoomCode('ABC')).toBeNull();
    expect(parseRoomCode('AB0D')).toBeNull();
    expect(parseRoomCode('ABIO')).toBeNull();
  });
});
