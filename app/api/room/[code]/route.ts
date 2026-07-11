import { NextRequest, NextResponse } from "next/server";
import {
  getRoom,
  makePlayerId,
  newPlayer,
  saveRoom,
} from "@/lib/rooms";

export const dynamic = "force-dynamic";

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

// actions: join / start / progress
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const room = await getRoom(code.toUpperCase());
  if (!room) return NextResponse.json({ error: "room not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const action = body?.action;

  if (action === "join") {
    if (room.startAt && Date.now() > room.startAt) {
      return NextResponse.json({ error: "race already started" }, { status: 409 });
    }
    if (room.players.length >= 8) {
      return NextResponse.json({ error: "room is full (8 max)" }, { status: 409 });
    }
    const playerId = makePlayerId();
    const name = typeof body?.name === "string" ? body.name : "Racer";
    room.players.push(newPlayer(playerId, name, room.start));
    await saveRoom(room);
    return NextResponse.json({ playerId, room });
  }

  if (action === "start") {
    if (body?.playerId !== room.hostId) {
      return NextResponse.json({ error: "only the host can start" }, { status: 403 });
    }
    if (!room.startAt) {
      room.startAt = Date.now() + 4000; // 4s countdown for everyone
      await saveRoom(room);
    }
    return NextResponse.json(room);
  }

  if (action === "progress") {
    const p = room.players.find((x) => x.id === body?.playerId);
    if (!p) return NextResponse.json({ error: "unknown player" }, { status: 403 });
    if (!p.finished) {
      if (typeof body.currentTitle === "string")
        p.currentTitle = body.currentTitle.slice(0, 200);
      if (typeof body.clicks === "number") p.clicks = body.clicks;
      if (Array.isArray(body.path))
        p.path = body.path.slice(0, 200).map((t: unknown) => String(t).slice(0, 200));
      if (body.finished === true && typeof body.timeMs === "number") {
        p.finished = true;
        p.timeMs = Math.round(body.timeMs);
      }
      p.updatedAt = Date.now();
      await saveRoom(room);
    }
    return NextResponse.json(room);
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
