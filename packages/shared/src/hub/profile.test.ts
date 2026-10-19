import { describe, expect, it } from 'vitest';
import { parseRoom } from '../map/room';
import { createGameState } from '../state/createGameState';
import type { Carried } from '../types';
import { EMPTY_PROFILE, buy, finishRun, move, sell, startRun, type Profile } from './profile';

const rich: Profile = { ...EMPTY_PROFILE, coins: 10 };

describe('магазин', () => {
  it('покупка списывает цену и кладёт в рюкзак', () => {
    expect(buy(rich, 'knife')).toEqual({ ...rich, coins: 8, backpack: ['knife'] });
  });

  it('без монет и не из ассортимента купить нельзя', () => {
    expect(buy({ ...rich, coins: 1 }, 'bow')).toBeNull();
    expect(buy(rich, 'sword')).toBeNull();
  });

  it('при полном рюкзаке покупка уходит в сундук', () => {
    const full: Profile = { ...rich, backpack: ['knife', 'knife', 'bow', 'bow'] };
    expect(buy(full, 'bow')?.chest).toEqual(['bow']);
  });

  it('продажа — за полцены с округлением вниз', () => {
    const p: Profile = { ...EMPTY_PROFILE, hands: 'sword', backpack: ['knife'], chest: ['wand'] };
    expect(sell(p, { place: 'hands' })).toEqual({ ...p, hands: null, coins: 3 });
    expect(sell(p, { place: 'backpack', index: 0 })?.coins).toBe(1);
    expect(sell(p, { place: 'chest', index: 0 })?.coins).toBe(4);
    expect(sell(EMPTY_PROFILE, { place: 'hands' })).toBeNull();
  });
});

describe('перекладывание', () => {
  it('в руки — прежнее оружие встаёт на место взятого', () => {
    const p: Profile = { ...EMPTY_PROFILE, hands: 'knife', chest: ['bow', 'sword'] };
    expect(move(p, { place: 'chest', index: 1 }, 'hands')).toEqual({
      ...p,
      hands: 'sword',
      chest: ['bow', 'knife'],
    });
  });

  it('в полный рюкзак нельзя, в сундук — всегда', () => {
    const p: Profile = {
      ...EMPTY_PROFILE,
      hands: 'wand',
      backpack: ['knife', 'knife', 'bow', 'bow'],
    };
    expect(move(p, { place: 'hands' }, 'backpack')).toBeNull();
    expect(move(p, { place: 'hands' }, 'chest')).toEqual({ ...p, hands: null, chest: ['wand'] });
    expect(move(p, { place: 'chest', index: 0 }, 'hands')).toBeNull();
  });
});

describe('забег', () => {
  const p: Profile = {
    coins: 5,
    hands: 'bow',
    armor: 'leather',
    backpack: ['knife'],
    chest: ['sword'],
  };

  it('старт забирает руки, броню и рюкзак, кошелёк и сундук остаются', () => {
    const { profile, loadout } = startRun(p);
    expect(loadout).toEqual({ weapon: 'bow', armor: 'leather', backpack: ['knife'] });
    expect(profile).toEqual({ coins: 5, hands: null, armor: null, backpack: [], chest: ['sword'] });
  });

  it('вынесенное возвращается, монеты — в кошелёк; погиб — ничего', () => {
    const { profile } = startRun(p);
    const carried: Carried = {
      coins: 3,
      weapon: { id: 'item-9', type: 'wand' },
      armor: { id: 'item-3', type: 'mail' },
      backpack: [{ id: 'item-2', type: 'knife' }],
    };
    expect(finishRun(profile, carried)).toEqual({
      coins: 8,
      hands: 'wand',
      armor: 'mail',
      backpack: ['knife'],
      chest: ['sword'],
    });
    expect(finishRun(profile, undefined)).toEqual(profile);
  });

  it('вынесенное добавляется, а не заменяет: занятые руки и полный рюкзак — в сундук', () => {
    const busy: Profile = {
      coins: 0,
      hands: 'knife',
      armor: 'leather',
      backpack: ['bow', 'bow', 'bow'],
      chest: [],
    };
    const carried: Carried = {
      coins: 0,
      weapon: { id: 'item-1', type: 'sword' },
      armor: { id: 'item-3', type: 'mail' },
      backpack: [{ id: 'item-2', type: 'wand' }],
    };
    expect(finishRun(busy, carried)).toEqual({
      coins: 0,
      hands: 'knife',
      armor: 'leather',
      backpack: ['bow', 'bow', 'bow', 'sword'],
      chest: ['mail', 'wand'],
    });
  });

  it('герой приходит на уровень с инвентарём из хаба', () => {
    const room = parseRoom('#####\n#@..#\n#####');
    const state = createGameState(room, ['p1', 'p2'], 1, {
      p1: { weapon: 'bow', armor: 'leather', backpack: ['knife', 'mail'] },
    });
    expect(state.actors['p1']).toMatchObject({
      weapon: { type: 'bow' },
      armor: { type: 'leather' },
      backpack: [{ type: 'knife' }, { type: 'mail' }],
    });
    expect(state.actors['p2']).toMatchObject({ weapon: null, armor: null, backpack: [] });
    const ids = [
      state.actors['p1']?.weapon?.id,
      state.actors['p1']?.armor?.id,
      ...(state.actors['p1']?.backpack ?? []).map((i) => i.id),
    ];
    expect(new Set(ids).size).toBe(4);
  });

  it('баночка: продаётся за 10, продаётся обратно за 5, в руки не берётся и не возвращается в руки', () => {
    const bought = buy({ ...EMPTY_PROFILE, coins: 10 }, 'potion');
    expect(bought).toEqual({ ...EMPTY_PROFILE, backpack: ['potion'] });
    if (!bought) throw new Error('не купилась');
    expect(sell(bought, { place: 'backpack', index: 0 })?.coins).toBe(5);
    expect(move(bought, { place: 'backpack', index: 0 }, 'hands')).toBeNull();
    const carried: Carried = {
      coins: 0,
      weapon: null,
      armor: null,
      backpack: [{ id: 'h', type: 'potion' }],
    };
    expect(finishRun(EMPTY_PROFILE, carried)).toMatchObject({ hands: null, backpack: ['potion'] });
  });
});

describe('броня в лагере', () => {
  it('кожаная продаётся за 4, кольчуги в магазине нет; надеть можно только броню', () => {
    const bought = buy({ ...EMPTY_PROFILE, coins: 4 }, 'leather');
    expect(bought).toEqual({ ...EMPTY_PROFILE, backpack: ['leather'] });
    expect(buy({ ...EMPTY_PROFILE, coins: 99 }, 'mail')).toBeNull();
    if (!bought) throw new Error('не купилась');
    expect(move(bought, { place: 'backpack', index: 0 }, 'hands')).toBeNull();
    expect(move(bought, { place: 'backpack', index: 0 }, 'armor')).toEqual({
      ...EMPTY_PROFILE,
      armor: 'leather',
    });
    const armed: Profile = { ...EMPTY_PROFILE, backpack: ['knife', 'potion'] };
    expect(move(armed, { place: 'backpack', index: 0 }, 'armor')).toBeNull();
    expect(move(armed, { place: 'backpack', index: 1 }, 'armor')).toBeNull();
  });

  it('надеть другую — прежняя встаёт на место взятой; снятую можно продать', () => {
    const p: Profile = { ...EMPTY_PROFILE, armor: 'leather', chest: ['mail'] };
    expect(move(p, { place: 'chest', index: 0 }, 'armor')).toEqual({
      ...p,
      armor: 'mail',
      chest: ['leather'],
    });
    expect(sell(p, { place: 'armor' })).toEqual({ ...p, armor: null, coins: 2 });
    expect(sell(p, { place: 'chest', index: 0 })?.coins).toBe(4);
  });
});
