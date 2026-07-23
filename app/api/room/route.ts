import { NextRequest, NextResponse } from "next/server";
import {
  createRoom,
  makeCode,
  makePlayerId,
  newPlayer,
  type StoredRoom,
} from "@/lib/rooms";
import {
  HOST_COOKIE_MAX_AGE,
  hashHostToken,
  hostCookieName,
  makeHostToken,
} from "@/lib/room-auth";

export const dynamic = "force-dynamic";

// create a room
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const start = typeof body?.start === "string" ? body.start.trim() : "";
  const target = typeof body?.target === "string" ? body.target.trim() : "";
  const name = typeof body?.name === "string" ? body.name : "Racer";
  if (
    !start ||
    !target ||
    start.length > 200 ||
    target.length > 200 ||
    start.replace(/_/g, " ").toLowerCase() ===
      target.replace(/_/g, " ").toLowerCase()
  ) {
    return NextResponse.json({ error: "start and target required" }, { status: 400 });
  }

  const hostId = makePlayerId();
  const hostToken = makeHostToken();

  for (let attempt = 0; attempt < 10; attempt++) {
    const code = makeCode();
    const room: StoredRoom = {
      code,
      start,
      target,
      hostId,
      hostTokenHash: hashHostToken(hostToken),
      round: 1,
      startAt: null,
      createdAt: Date.now(),
      players: [newPlayer(hostId, name, start)],
    };
    if (!(await createRoom(room))) continue;

    const response = NextResponse.json({ code, playerId: hostId });
    response.cookies.set({
      name: hostCookieName(code),
      value: hostToken,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: `/api/room/${code}`,
      maxAge: HOST_COOKIE_MAX_AGE,
    });
    return response;
  }

  return NextResponse.json(
    { error: "couldn't allocate a room code" },
    { status: 503 }
  );
}
