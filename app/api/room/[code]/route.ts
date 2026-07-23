import { NextRequest, NextResponse } from "next/server";
import {
  getRoom,
  makePlayerId,
  mutateRoom,
  newPlayer,
  toPublicRoom,
  type Room,
  type StoredRoom,
} from "@/lib/rooms";
import {
  HOST_COOKIE_MAX_AGE,
  PLAYER_COOKIE_MAX_AGE,
  hashPlayerToken,
  hostCookieName,
  makePlayerToken,
  playerCookieName,
  verifyHostToken,
  verifyPlayerToken,
} from "@/lib/room-auth";

export const dynamic = "force-dynamic";

class RoomActionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
  }
}

const BLOCKED_NAMESPACE =
  /^(File|Category|Help|Special|Portal|Talk|Wikipedia|Template|Draft|Module|MediaWiki|TimedText|Book|User|WP|Media)( talk)?:/i;

function normalizeArticleTitle(title: string): string {
  return title.replace(/_/g, " ").trim().toLowerCase();
}

function actionError(error: unknown) {
  if (error instanceof RoomActionError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }
  console.error(error);
  return NextResponse.json({ error: "room update failed" }, { status: 503 });
}

function assertRound(
  body: Record<string, unknown> | null,
  room: StoredRoom,
  allowLegacyRoundOne = false
) {
  const requested = body?.round;
  if (allowLegacyRoundOne && requested === undefined && room.round === 1) return;
  if (!Number.isSafeInteger(requested) || requested !== room.round) {
    throw new RoomActionError(
      "This room has already moved to another round.",
      409,
      "stale_round"
    );
  }
}

function assertHost(
  body: Record<string, unknown> | null,
  room: StoredRoom,
  hostToken: string | undefined,
  allowLegacyRoom = false
) {
  if (body?.playerId !== room.hostId) {
    throw new RoomActionError("Only the host can do that.", 403);
  }
  if (!room.hostTokenHash) {
    if (allowLegacyRoom) return;
    throw new RoomActionError(
      "This old room can't be reused securely. Create a fresh room.",
      409
    );
  }
  if (!verifyHostToken(hostToken, room.hostTokenHash)) {
    throw new RoomActionError("Only the original host can do that.", 403);
  }
}

function assertPlayer(
  body: Record<string, unknown> | null,
  room: StoredRoom,
  playerToken: string | undefined
) {
  const playerId = typeof body?.playerId === "string" ? body.playerId : "";
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new RoomActionError("Unknown player.", 403);

  const expectedHash = room.playerTokenHashes?.[playerId];
  if (!expectedHash) {
    throw new RoomActionError(
      "This old room can't continue securely. Create a fresh room.",
      409
    );
  }
  if (!verifyPlayerToken(playerToken, expectedHash)) {
    throw new RoomActionError("This player session is no longer valid.", 403);
  }
  return player;
}

function readPair(body: Record<string, unknown> | null): [string, string] {
  const start = typeof body?.start === "string" ? body.start.trim() : "";
  const target = typeof body?.target === "string" ? body.target.trim() : "";
  const startKey = normalizeArticleTitle(start);
  const targetKey = normalizeArticleTitle(target);

  if (!start || !target) {
    throw new RoomActionError("Choose both a start and target article.", 400);
  }
  if (start.length > 200 || target.length > 200) {
    throw new RoomActionError("Article titles must be 200 characters or less.", 400);
  }
  if (startKey === targetKey) {
    throw new RoomActionError("Start and target must be different articles.", 400);
  }
  if (BLOCKED_NAMESPACE.test(start) || BLOCKED_NAMESPACE.test(target)) {
    throw new RoomActionError("Use regular Wikipedia articles for the race.", 400);
  }
  return [start, target];
}

function roomJson(room: StoredRoom, hostToken?: string) {
  const response = NextResponse.json(toPublicRoom(room));
  if (
    room.hostTokenHash &&
    hostToken &&
    verifyHostToken(hostToken, room.hostTokenHash)
  ) {
    response.cookies.set({
      name: hostCookieName(room.code),
      value: hostToken,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: `/api/room/${room.code}`,
      maxAge: HOST_COOKIE_MAX_AGE,
    });
  }
  return response;
}

function setPlayerCookie(
  response: NextResponse,
  roomCode: string,
  playerId: string,
  playerToken: string
) {
  response.cookies.set({
    name: playerCookieName(roomCode, playerId),
    value: playerToken,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/api/room/${roomCode}`,
    maxAge: PLAYER_COOKIE_MAX_AGE,
  });
}

// read room state (lobby + race polling)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const room = await getRoom(code.toUpperCase());
  if (!room) return NextResponse.json({ error: "room not found" }, { status: 404 });
  // serverNow lets clients correct for local clock skew
  return NextResponse.json({ ...room, serverNow: Date.now() });
}

// actions: join / configure / start / progress / nextRound
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const roomCode = code.toUpperCase();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  const hostToken = req.cookies.get(hostCookieName(roomCode))?.value;
  const claimedPlayerId = typeof body?.playerId === "string" ? body.playerId : "";
  const playerToken = claimedPlayerId
    ? req.cookies.get(playerCookieName(roomCode, claimedPlayerId))?.value
    : undefined;

  if (action === "join") {
    const playerId = makePlayerId();
    const newPlayerToken = makePlayerToken();
    const name = typeof body?.name === "string" ? body.name : "Racer";
    try {
      const updated = await mutateRoom(roomCode, (room) => {
        if (room.startAt && Date.now() > room.startAt) {
          throw new RoomActionError("Race already started.", 409);
        }
        if (room.players.length >= 8) {
          throw new RoomActionError("Room is full (8 max).", 409);
        }
        if (!room.playerTokenHashes) {
          throw new RoomActionError(
            "This old room can't accept secure players. Create a fresh room.",
            409
          );
        }
        room.players.push(newPlayer(playerId, name, room.start));
        room.playerTokenHashes[playerId] = hashPlayerToken(newPlayerToken);
      });
      if (!updated) {
        return NextResponse.json({ error: "room not found" }, { status: 404 });
      }
      const response = NextResponse.json({
        playerId,
        room: toPublicRoom(updated.room),
      });
      setPlayerCookie(response, roomCode, playerId, newPlayerToken);
      return response;
    } catch (error) {
      return actionError(error);
    }
  }

  if (action === "configure") {
    try {
      const pair = readPair(body);
      const updated = await mutateRoom(roomCode, (room) => {
        assertHost(body, room, hostToken);
        assertRound(body, room);
        if (room.startAt) {
          throw new RoomActionError(
            "The matchup can't change after the countdown starts.",
            409
          );
        }
        room.start = pair[0];
        room.target = pair[1];
        room.players = room.players.map((player) =>
          newPlayer(player.id, player.name, room.start)
        );
      });
      if (!updated) {
        return NextResponse.json({ error: "room not found" }, { status: 404 });
      }
      return roomJson(updated.room, hostToken);
    } catch (error) {
      return actionError(error);
    }
  }

  if (action === "start") {
    try {
      const updated = await mutateRoom(roomCode, (room) => {
        assertHost(body, room, hostToken, true);
        assertRound(body, room, true);
        if (!room.startAt) {
          room.players = room.players.map((player) =>
            newPlayer(player.id, player.name, room.start)
          );
          room.startAt = Date.now() + 4000; // 4s countdown for everyone
        }
      });
      if (!updated) {
        return NextResponse.json({ error: "room not found" }, { status: 404 });
      }
      return roomJson(updated.room, hostToken);
    } catch (error) {
      return actionError(error);
    }
  }

  if (action === "progress") {
    try {
      const updated = await mutateRoom(roomCode, (room) => {
        assertRound(body, room, true);
        const player = assertPlayer(body, room, playerToken);
        if (player.finished) return;
        if (!room.startAt || Date.now() < room.startAt) {
          throw new RoomActionError("The race hasn't started yet.", 409);
        }

        if (
          typeof body?.clicks !== "number" ||
          !Number.isSafeInteger(body.clicks) ||
          body.clicks < 0
        ) {
          throw new RoomActionError("Invalid progress update.", 400);
        }
        if (body.clicks < player.clicks) return;

        let nextPath: string[] | null = null;
        if (Array.isArray(body?.path)) {
          nextPath = body.path
            .slice(0, 200)
            .map((title: unknown) => String(title).slice(0, 200));
          if (nextPath.length !== Math.min(body.clicks + 1, 200)) {
            throw new RoomActionError("Invalid race path.", 400);
          }
          if (
            nextPath.length === 0 ||
            normalizeArticleTitle(nextPath[0]) !== normalizeArticleTitle(room.start)
          ) {
            throw new RoomActionError("Invalid race start.", 400);
          }
        }
        player.clicks = body.clicks;
        if (nextPath) {
          player.path = nextPath;
          player.currentTitle = nextPath[nextPath.length - 1];
        } else if (typeof body?.currentTitle === "string") {
          player.currentTitle = body.currentTitle.slice(0, 200);
        }
        if (
          body?.finished === true &&
          typeof body?.timeMs === "number" &&
          Number.isFinite(body.timeMs) &&
          body.timeMs >= 0
        ) {
          if (
            !nextPath ||
            normalizeArticleTitle(nextPath[nextPath.length - 1]) !==
              normalizeArticleTitle(room.target)
          ) {
            throw new RoomActionError("Finish must reach the target article.", 400);
          }
          player.finished = true;
          player.timeMs = Math.round(body.timeMs);
        }
        player.updatedAt = Date.now();
      });
      if (!updated) {
        return NextResponse.json({ error: "room not found" }, { status: 404 });
      }
      return roomJson(updated.room, hostToken);
    } catch (error) {
      return actionError(error);
    }
  }

  if (action === "nextRound") {
    try {
      const pair = readPair(body);
      const updated = await mutateRoom(roomCode, (room) => {
        assertHost(body, room, hostToken);
        assertRound(body, room);
        const podiumSize = room.players.length >= 4 ? 3 : 1;
        const finishers = room.players.filter((player) => player.finished).length;
        const forceAfterFinish = body?.force === true && finishers >= 1;
        if (!room.startAt || (finishers < podiumSize && !forceAfterFinish)) {
          throw new RoomActionError("This race is still running.", 409);
        }

        room.round += 1;
        room.start = pair[0];
        room.target = pair[1];
        room.startAt = null;
        room.players = room.players.map((player) =>
          newPlayer(player.id, player.name, room.start)
        );
      });
      if (!updated) {
        return NextResponse.json({ error: "room not found" }, { status: 404 });
      }
      return roomJson(updated.room, hostToken);
    } catch (error) {
      return actionError(error);
    }
  }

  // Keep a stable 404 for valid actions aimed at expired room codes.
  if (typeof action === "string") {
    const room: Room | null = await getRoom(roomCode);
    if (!room) {
      return NextResponse.json({ error: "room not found" }, { status: 404 });
    }
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
