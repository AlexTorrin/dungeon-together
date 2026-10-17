import type { GameEvent } from '../commands';
import { BACKPACK_SIZE } from '../config/inventory';
import { ACTION_POINTS } from '../config/turn';
import { withExplored } from '../map/fov';
import { setTile } from '../map/gameMap';
import { samePos } from '../map/geometry';
import { allocateId } from '../state/ids';
import type {
  Action,
  Actor,
  ActorId,
  Carried,
  Door,
  GameMap,
  GameState,
  GameStatus,
  GroundItem,
  ItemId,
  Loot,
  Plan,
  PlayerId,
  Position,
} from '../types';
import type { CommandResult } from './applyCommand';
import { canAttack, weaponOf } from './combat';
import { chooseMonsterPlan } from './monsterAi';
import { canOpenDoor, simulatePlan, swapOut } from './plan';
import { resolveMoves, type ActorIntent } from './resolveMoves';

/** Изменяемый «черновик» состояния на время разрешения хода; в состояние уходят обычные объекты. */
interface Turn {
  map: GameMap;
  door: Door | null;
  nextId: number;
  readonly actors: Map<ActorId, Actor>;
  readonly items: Map<ItemId, GroundItem>;
  readonly escaped: Map<PlayerId, Carried>;
  readonly events: GameEvent[];
}

/**
 * Разрешает ход, когда все игроки выбрали планы.
 *
 * 1. Планы: игроки — что выбрали; монстры — ИИ (по состоянию на начало хода).
 * 2. Фазы по очереди (ACTION_POINTS штук, resolvePhase): в каждой все действуют одновременно.
 *    Убитый в фазе 1 во второй уже не действует. После каждой фазы — событие phaseResolved.
 * 3. Конец уровня: убит последний монстр — пройден, все живые уносят добычу; на уровне нет
 *    игроков — пройден, если кто-то вышел через дверь, иначе поражение.
 * 4. Память команды (explored) пополняется тем, что игроки видят с новых позиций.
 */
export function resolveTurn(state: GameState): CommandResult {
  // 1. Планы, разложенные по фазам
  let rng = state.rng;
  const phases = new Map<ActorId, Action[]>();
  for (const actor of Object.values(state.actors)) {
    let plan: Plan;
    if (actor.kind === 'player') plan = state.pendingPlans[actor.id] ?? [];
    else [plan, rng] = chooseMonsterPlan(state, actor, rng);
    phases.set(actor.id, [...(simulatePlan(state, actor, plan)?.phases ?? [])]);
  }

  // 2. Фазы
  const turn: Turn = {
    map: state.map,
    door: state.door,
    nextId: state.nextId,
    actors: new Map(Object.entries(state.actors)),
    items: new Map(Object.entries(state.items)),
    escaped: new Map(Object.entries(state.escaped)),
    events: [],
  };
  for (let phase = 0; phase < ACTION_POINTS; phase++) {
    const actions = new Map<ActorId, Action>();
    for (const id of turn.actors.keys())
      actions.set(id, phases.get(id)?.[phase] ?? { type: 'wait' });
    resolvePhase(turn, actions);
    turn.events.push({ type: 'phaseResolved', phase: phase + 1 });
    if (![...turn.actors.values()].some((a) => a.kind === 'player')) break;
  }

  // 3. Конец уровня
  const status = nextStatus(state, [...turn.actors.values()], turn.escaped);
  if (status === 'won') {
    // Пройден победой — все живые игроки уносят добычу.
    for (const actor of turn.actors.values()) {
      if (actor.kind === 'player') turn.escaped.set(actor.id, carriedBy(actor));
    }
  }
  turn.events.push({ type: 'turnResolved', turn: state.turn });
  if (status !== 'playing') turn.events.push({ type: 'gameOver', status });

  // 4. Память команды
  const next: GameState = {
    ...state,
    map: turn.map,
    door: turn.door,
    nextId: turn.nextId,
    actors: Object.fromEntries(turn.actors),
    items: Object.fromEntries(turn.items),
    escaped: Object.fromEntries(turn.escaped),
    rng,
    status,
    pendingPlans: {},
    turn: state.turn + 1,
  };
  return { state: { ...next, explored: withExplored(next) }, events: turn.events };
}

const carriedBy = ({ coins, weapon, backpack }: Actor): Carried => ({ coins, weapon, backpack });

/** Кладёт на пол новую вещь (выброшенные монеты, ключ) с новым id. */
function dropNew(turn: Turn, actorId: ActorId, loot: Loot, at: Position): void {
  let id: ItemId;
  [id, turn.nextId] = allocateId(turn.nextId, loot.kind);
  turn.items.set(id, { ...loot, id, pos: at });
  turn.events.push({ type: 'itemDropped', actorId, itemId: id, at });
}

/**
 * Одна фаза: все действуют одновременно.
 *
 * 1. Шаги — с конфликтами (resolveMoves).
 * 2. Подбор: кто шагнул на клетку, забирает монеты и ключи и кладёт оружие в рюкзак, пока есть место.
 *    Взять в руки, выбросить, открыть дверь — тоже здесь, до ударов.
 *    Игрок в открытой двери покидает уровень со всем, что несёт.
 * 3. Удары — по клеткам, где акторы стоят ПОСЛЕ шагов этой фазы. Отошёл — увернулся, шагнул под
 *    удар — получил. Удар, который с фактической позиции уже не достаёт (упёрся в стену, цель за
 *    углом), срывается и считается ожиданием. Урон применяется разом: убитый тоже успевает ударить.
 * 4. Смерти: hp ≤ 0 — актор удаляется, всё, что нёс (оружие, монеты, ключи), падает на пол.
 */
function resolvePhase(turn: Turn, actions: ReadonlyMap<ActorId, Action>): void {
  const { actors, items, events } = turn;
  const intents: ActorIntent[] = [...actors.values()].map((actor) => ({
    id: actor.id,
    from: actor.pos,
    action: actions.get(actor.id) ?? { type: 'wait' },
  }));

  // 1. Шаги
  const outcomes = resolveMoves(turn.map, intents);
  const moved = new Set<ActorId>();
  const attacks: { readonly id: ActorId; readonly target: Position }[] = [];
  for (const { id, from, action } of intents) {
    const actor = actors.get(id);
    const outcome = outcomes.get(id);
    if (!actor || !outcome) throw new Error(`Actor ${id} lost during turn resolution`);

    if (action.type === 'move' && outcome.kind === 'moved') {
      actors.set(id, { ...actor, pos: outcome.to });
      moved.add(id);
      events.push({
        type: 'moved',
        actorId: id,
        from,
        to: outcome.to,
        direction: action.direction,
      });
    } else if (action.type === 'move' && outcome.kind === 'bumped') {
      events.push({
        type: 'bumped',
        actorId: id,
        at: outcome.at,
        direction: action.direction,
        reason: outcome.reason,
      });
    } else if (action.type === 'attack' && canAttack(turn.map, actor, action.target)) {
      attacks.push({ id, target: action.target });
      events.push({ type: 'attacked', actorId: id, target: action.target });
    } else if (action.type === 'move' || action.type === 'attack' || action.type === 'wait') {
      events.push({ type: 'waited', actorId: id });
    }
  }

  // 2. Подбор: всё, что лежит на клетке (оружие — пока есть место в рюкзаке)
  for (const id of moved) {
    let actor = actors.get(id);
    if (!actor) continue;
    for (const item of [...items.values()]) {
      if (!samePos(item.pos, actor.pos)) continue;
      if (item.kind === 'weapon') {
        if (actor.backpack.length >= BACKPACK_SIZE) continue;
        actor = { ...actor, backpack: [...actor.backpack, { id: item.id, type: item.type }] };
      } else if (item.kind === 'coins') {
        actor = { ...actor, coins: actor.coins + item.amount };
      } else {
        actor = { ...actor, keys: actor.keys + 1 };
      }
      items.delete(item.id);
      events.push({ type: 'itemPickedUp', actorId: id, itemId: item.id });
    }
    actors.set(id, actor);
  }

  //    Взять в руки, выбросить, открыть дверь
  for (const { id, action } of intents) {
    const actor = actors.get(id);
    if (!actor) continue;
    if (action.type === 'equip') {
      const item = actor.backpack.find((i) => i.id === action.itemId);
      if (!item) continue; // проверено в плане; на всякий случай — просто ничего
      actors.set(id, {
        ...actor,
        weapon: item,
        backpack: swapOut(actor.backpack, item, actor.weapon),
      });
      events.push({ type: 'itemEquipped', actorId: id, itemId: item.id });
    } else if (action.type === 'drop') {
      const item =
        actor.weapon?.id === action.itemId
          ? actor.weapon
          : actor.backpack.find((i) => i.id === action.itemId);
      if (!item) continue;
      actors.set(id, {
        ...actor,
        weapon: actor.weapon?.id === item.id ? null : actor.weapon,
        backpack: actor.backpack.filter((i) => i.id !== item.id),
      });
      items.set(item.id, { kind: 'weapon', ...item, pos: actor.pos });
      events.push({ type: 'itemDropped', actorId: id, itemId: item.id, at: actor.pos });
    } else if (action.type === 'dropCoins') {
      if (action.amount <= 0 || action.amount > actor.coins) continue;
      actors.set(id, { ...actor, coins: actor.coins - action.amount });
      dropNew(turn, id, { kind: 'coins', amount: action.amount }, actor.pos);
    } else if (action.type === 'dropKey') {
      if (actor.keys <= 0) continue;
      actors.set(id, { ...actor, keys: actor.keys - 1 });
      dropNew(turn, id, { kind: 'key' }, actor.pos);
    } else if (action.type === 'openDoor' && turn.door && canOpenDoor(turn, actor)) {
      // Открытая дверь — проход: в карте клетка становится полом.
      actors.set(id, { ...actor, keys: actor.keys - 1 });
      turn.door = { ...turn.door, open: true };
      turn.map = setTile(turn.map, turn.door.pos, 'floor');
      events.push({ type: 'doorOpened', actorId: id, at: turn.door.pos });
    }
  }

  //    Выход: игрок в открытой двери покидает уровень со всем, что несёт
  const { door } = turn;
  if (door?.open) {
    for (const actor of [...actors.values()]) {
      if (actor.kind !== 'player' || !samePos(actor.pos, door.pos)) continue;
      actors.delete(actor.id);
      turn.escaped.set(actor.id, carriedBy(actor));
      events.push({ type: 'exited', actorId: actor.id, at: actor.pos });
    }
  }

  // 3. Удары: урон по позициям после шагов, применяется разом
  const damage = new Map<ActorId, number>();
  for (const { id, target } of attacks) {
    const attacker = actors.get(id);
    if (!attacker) continue;
    const { damage: amount } = weaponOf(attacker);
    for (const victim of actors.values()) {
      if (!samePos(victim.pos, target)) continue;
      const hp = victim.hp - (damage.get(victim.id) ?? 0) - amount;
      damage.set(victim.id, (damage.get(victim.id) ?? 0) + amount);
      events.push({ type: 'damaged', actorId: victim.id, by: id, amount, hp });
    }
  }
  for (const [id, amount] of damage) {
    const actor = actors.get(id);
    if (actor) actors.set(id, { ...actor, hp: actor.hp - amount });
  }

  // 4. Смерти: на пол падает всё, что актор нёс
  for (const actor of [...actors.values()]) {
    if (actor.hp > 0) continue;
    actors.delete(actor.id);
    events.push({ type: 'died', actorId: actor.id, at: actor.pos });
    for (const item of [...(actor.weapon ? [actor.weapon] : []), ...actor.backpack]) {
      items.set(item.id, { kind: 'weapon', ...item, pos: actor.pos });
      events.push({ type: 'itemDropped', actorId: actor.id, itemId: item.id, at: actor.pos });
    }
    if (actor.coins > 0) dropNew(turn, actor.id, { kind: 'coins', amount: actor.coins }, actor.pos);
    for (let k = 0; k < actor.keys; k++) dropNew(turn, actor.id, { kind: 'key' }, actor.pos);
  }
}

function nextStatus(
  before: GameState,
  after: readonly Actor[],
  escaped: ReadonlyMap<PlayerId, Carried>,
): GameStatus {
  const count = (actors: readonly Actor[], kind: Actor['kind']): number =>
    actors.filter((a) => a.kind === kind).length;
  // Победа — когда убит последний монстр: комната без монстров не выигрывается сама.
  const monstersBefore = count(Object.values(before.actors), 'monster');
  if (monstersBefore > 0 && count(after, 'monster') === 0) return 'won';
  // На уровне не осталось игроков: пройден, если кто-то вышел через дверь.
  if (count(after, 'player') === 0) return escaped.size > 0 ? 'won' : 'lost';
  return 'playing';
}
