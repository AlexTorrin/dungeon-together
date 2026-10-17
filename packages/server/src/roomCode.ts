import { randomInt } from 'node:crypto';
import { matchMaker } from '@colyseus/core';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@dt/shared';

function randomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/** Короткий код комнаты, который можно продиктовать другу; не совпадает с уже открытыми. */
export async function uniqueRoomCode(): Promise<string> {
  for (;;) {
    const code = randomCode();
    const existing = await matchMaker.query({ roomId: code });
    if (existing.length === 0) return code;
  }
}
