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
  startAt: number | null; // epoch ms when the race begins (null = lobby)
  createdAt: number;
  players: RoomPlayer[];
}

const TTL_SECONDS = 3 * 60 * 60;

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
  ? ((globalThis as Record<string, unknown>).__wrRooms as Map<string, Room>)
  : new Map<string, Room>();
(globalThis as Record<string, unknown>).__wrRooms = mem;

export async function getRoom(code: string): Promise<Room | null> {
  if (hasRedis) {
    const raw = (await redis(["GET", `room:${code}`])) as string | null;
    return raw ? (JSON.parse(raw) as Room) : null;
  }
  return mem.get(code) ?? null;
}

export async function saveRoom(room: Room): Promise<void> {
  if (hasRedis) {
    await redis([
      "SET",
      `room:${room.code}`,
      JSON.stringify(room),
      "EX",
      TTL_SECONDS,
    ]);
  } else {
    mem.set(room.code, room);
  }
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
