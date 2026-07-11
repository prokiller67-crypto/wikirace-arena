import { NextRequest, NextResponse } from "next/server";

const REST = "https://en.wikipedia.org/api/rest_v1";
const UA = "WikiRaceArena/1.0 (JecHacks hackathon; hello@jechacks.com)";

export async function GET(req: NextRequest) {
  const title = req.nextUrl.searchParams.get("title");
  if (!title) return NextResponse.json({ error: "missing title" }, { status: 400 });
  const path = encodeURIComponent(title.replace(/ /g, "_"));
  const res = await fetch(`${REST}/page/summary/${path}?redirect=true`, {
    headers: { accept: "application/json", "user-agent": UA },
  });
  const j = await res.json().catch(() => ({ error: "upstream error" }));
  return NextResponse.json(j, {
    status: res.status,
    headers: {
      // never let the CDN memorize a 404/5xx for a week
      "Cache-Control": res.ok
        ? "public, s-maxage=604800, stale-while-revalidate=86400"
        : "no-store",
    },
  });
}
