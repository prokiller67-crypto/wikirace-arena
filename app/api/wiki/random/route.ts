import { NextResponse } from "next/server";

const REST = "https://en.wikipedia.org/api/rest_v1";
const UA = "WikiRaceArena/1.0 (JecHacks hackathon; hello@jechacks.com)";

export const dynamic = "force-dynamic";

export async function GET() {
  const res = await fetch(`${REST}/page/random/summary`, {
    headers: { accept: "application/json", "user-agent": UA },
    cache: "no-store",
  });
  const j = await res.json().catch(() => ({ error: "upstream error" }));
  return NextResponse.json(j, {
    status: res.status,
    headers: { "Cache-Control": "no-store" },
  });
}
