// Server-side room store: Upstash Redis (REST) in prod, in-memory fallback for local dev.

export interface RoomPlayer {
  id: string;
  name: string;
  clicks: number;
  currentTitle: string;
  finished: boolean;
  timeMs: number | null;
  path: string[];
  updatedAt: number;
}

export interface Room {
  code: string;
  start: string;
  target: string;
  hostId: string;
  round: number;
  startAt: number | null; // epoch ms when the race begins (null = lobby)
  createdAt: number;
  players: RoomPlayer[];
}

export interface StoredRoom extends Room {
  hostTokenHash?: string;
  playerTokenHashes?: Record<string, string>;
}

export const ROOM_TTL_SECONDS = 3 * 60 * 60;
const MUTATION_RETRIES = 6;

// ---- storage backends ----

const REST_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const REST_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

const hasRedis = Boolean(REST_URL && REST_TOKEN);

async function redis(cmd: (string | number)[]): Promise<unknown> {
  const res = await fetch(REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Redis error ${res.status}`);
  const j = await res.json();
  return j.result;
}

// in-memory fallback (dev only — single process)
const mem = (globalThis as Record<string, unknown>).__wrRooms
  ? ((globalThis as Record<string, unknown>).__wrRooms as Map<string, StoredRoom>)
  : new Map<string, StoredRoom>();
(globalThis as Record<string, unknown>).__wrRooms = mem;

const CAS_SCRIPT = `
local current = redis.call("GET", KEYS[1])
if current ~= ARGV[1] then
  return 0
end
redis.call("SET", KEYS[1], ARGV[2], "EX", tonumber(ARGV[3]))
return 1
`;

function normalizeStoredRoom(room: StoredRoom): StoredRoom {
  if (!Number.isSafeInteger(room.round) || room.round < 1) {
    room.round = 1;
  }
  return room;
}

function publicRoom(room: StoredRoom): Room {
  const copy = { ...room };
  delete copy.hostTokenHash;
  delete copy.playerTokenHashes;
  return copy;
}

async function getStoredRoom(code: string): Promise<StoredRoom | null> {
  if (hasRedis) {
    const raw = (await redis(["GET", `room:${code}`])) as string | null;
    return raw ? normalizeStoredRoom(JSON.parse(raw) as StoredRoom) : null;
  }
  const room = mem.get(code);
  return room ? normalizeStoredRoom(structuredClone(room)) : null;
}

export async function getRoom(code: string): Promise<Room | null> {
  const room = await getStoredRoom(code);
  return room ? publicRoom(room) : null;
}

export async function createRoom(room: StoredRoom): Promise<boolean> {
  if (hasRedis) {
    const result = await redis([
      "SET",
      `room:${room.code}`,
      JSON.stringify(room),
      "EX",
      ROOM_TTL_SECONDS,
      "NX",
    ]);
    return result === "OK";
  }

  if (mem.has(room.code)) return false;
  mem.set(room.code, structuredClone(room));
  return true;
}

export async function mutateRoom<T>(
  code: string,
  reducer: (room: StoredRoom) => T
): Promise<{ room: StoredRoom; result: T } | null> {
  if (!hasRedis) {
    const current = mem.get(code);
    if (!current) return null;
    const draft = normalizeStoredRoom(structuredClone(current));
    const result = reducer(draft);
    mem.set(code, structuredClone(draft));
    return { room: draft, result };
  }

  const key = `room:${code}`;
  for (let attempt = 0; attempt < MUTATION_RETRIES; attempt++) {
    const raw = (await redis(["GET", key])) as string | null;
    if (!raw) return null;

    const draft = normalizeStoredRoom(JSON.parse(raw) as StoredRoom);
    const result = reducer(draft);
    const nextRaw = JSON.stringify(draft);
    const swapped = await redis([
      "EVAL",
      CAS_SCRIPT,
      1,
      key,
      raw,
      nextRaw,
      ROOM_TTL_SECONDS,
    ]);

    if (Number(swapped) === 1) {
      return { room: draft, result };
    }
  }

  throw new Error("room update conflict");
}

export function toPublicRoom(room: StoredRoom): Room {
  return publicRoom(room);
}

export function makeCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 5; i++)
    c += alphabet[Math.floor(Math.random() * alphabet.length)];
  return c;
}

export function makePlayerId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function newPlayer(id: string, name: string, start: string): RoomPlayer {
  return {
    id,
    name: name.slice(0, 24) || "Racer",
    clicks: 0,
    currentTitle: start,
    finished: false,
    timeMs: null,
    path: [start],
    updatedAt: Date.now(),
  };
}
