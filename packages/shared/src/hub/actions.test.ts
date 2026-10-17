import { describe, expect, it } from 'vitest';
import { applyHubAction, parseHubAction, parseProfile, parseSlot, parseToken } from './actions';
import { EMPTY_PROFILE, type Profile } from './profile';

describe('действия лагеря', () => {
  const p: Profile = { coins: 4, hands: 'sword', backpack: [], chest: ['bow'] };

  it('применяются теми же правилами, что buy / sell / move', () => {
    expect(applyHubAction(p, { type: 'buy', weapon: 'knife' })).toMatchObject({
      coins: 2,
      backpack: ['knife'],
    });
    expect(applyHubAction(p, { type: 'sell', slot: { place: 'hands' } })).toMatchObject({
      coins: 7,
      hands: null,
    });
    expect(
      applyHubAction(p, { type: 'move', from: { place: 'chest', index: 0 }, to: 'backpack' }),
    ).toMatchObject({ backpack: ['bow'], chest: [] });
    expect(applyHubAction(EMPTY_PROFILE, { type: 'buy', weapon: 'bow' })).toBeNull();
  });

  it('разбор: только известные действия и слоты', () => {
    expect(parseHubAction({ type: 'buy', weapon: 'bow' })).toEqual({ type: 'buy', weapon: 'bow' });
    expect(parseHubAction({ type: 'buy', weapon: 'laser' })).toBeNull();
    expect(parseHubAction({ type: 'move', from: { place: 'hands' }, to: 'floor' })).toBeNull();
    expect(parseHubAction({ type: 'sell', slot: { place: 'chest', index: -1 } })).toBeNull();
    expect(parseHubAction({ type: 'hack' })).toBeNull();
    expect(parseSlot({ place: 'backpack', index: 2 })).toEqual({ place: 'backpack', index: 2 });
    expect(parseSlot({ place: 'backpack' })).toBeNull();
  });

  it('профиль: монеты — целое ≥ 0, рюкзак не больше 4, только известное оружие', () => {
    expect(parseProfile(p)).toEqual(p);
    expect(parseProfile({ ...p, coins: -1 })).toBeNull();
    expect(parseProfile({ ...p, coins: 1.5 })).toBeNull();
    expect(parseProfile({ ...p, backpack: ['bow', 'bow', 'bow', 'bow', 'bow'] })).toBeNull();
    expect(parseProfile({ ...p, chest: ['laser'] })).toBeNull();
    expect(parseProfile('профиль')).toBeNull();
  });

  it('токен: 16–128 символов без пробелов и спецсимволов', () => {
    const uuid = '0b6a1c2e-3f4d-4a5b-8c9d-0e1f2a3b4c5d';
    expect(parseToken(uuid)).toBe(uuid);
    expect(parseToken('short')).toBeNull();
    expect(parseToken('x'.repeat(129))).toBeNull();
    expect(parseToken('../../etc/passwd-aaaaaaaa')).toBeNull();
    expect(parseToken(42)).toBeNull();
  });
});
