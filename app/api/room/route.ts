import { NextRequest, NextResponse } from "next/server";
import {
  makeCode,
  makePlayerId,
  newPlayer,
  saveRoom,
  type Room,
} from "@/lib/rooms";

export const dynamic = "force-dynamic";

// create a room
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const start = typeof body?.start === "string" ? body.start : "";
  const target = typeof body?.target === "string" ? body.target : "";
  const name = typeof body?.name === "string" ? body.name : "Racer";
  if (!start || !target) {
    return NextResponse.json({ error: "start and target required" }, { status: 400 });
  }
  const code = makeCode();
  const hostId = makePlayerId();
  const room: Room = {
    code,
    start,
    target,
    hostId,
    startAt: null,
    createdAt: Date.now(),
    players: [newPlayer(hostId, name, start)],
  };
  await saveRoom(room);
  return NextResponse.json({ code, playerId: hostId });
}
