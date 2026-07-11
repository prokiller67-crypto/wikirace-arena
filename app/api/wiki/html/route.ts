import { NextRequest, NextResponse } from "next/server";

// Proxy Wikipedia article HTML through our server: bypasses ISP throttling of
// wikipedia.org and lets Vercel's CDN cache hot articles close to players.
const REST = "https://en.wikipedia.org/api/rest_v1";
const UA = "WikiRaceArena/1.0 (JecHacks hackathon; hello@jechacks.com)";

export async function GET(req: NextRequest) {
  const title = req.nextUrl.searchParams.get("title");
  if (!title) return new NextResponse("missing title", { status: 400 });
  const path = encodeURIComponent(title.replace(/ /g, "_"));
  const res = await fetch(`${REST}/page/html/${path}`, {
    headers: { accept: "text/html", "user-agent": UA },
  });
  if (!res.ok) return new NextResponse("upstream error", { status: res.status });
  const body = await res.text();
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=86400",
    },
  });
}
