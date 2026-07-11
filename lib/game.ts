// Race state, ghost opponents, and challenge-link encoding (state lives in the URL — fully serverless)

export interface PathStep {
  title: string;
  atMs: number; // ms since race start when this article was reached
}

export interface RaceResult {
  name: string;
  start: string;
  target: string;
  clicks: number;
  timeMs: number;
  path: PathStep[];
}

export type GhostDifficulty = "chill" | "sweaty" | "goated";

export interface GhostPlan {
  name: string;
  steps: PathStep[]; // synthetic or replayed; last step = finish
  isReplay: boolean;
}

const GHOST_PRESETS: Record<
  GhostDifficulty,
  { name: string; clicks: [number, number]; perClickMs: [number, number] }
> = {
  chill: { name: "Chill Carl", clicks: [7, 9], perClickMs: [20000, 30000] },
  sweaty: { name: "Sweaty Sam", clicks: [5, 7], perClickMs: [13000, 19000] },
  goated: { name: "GOAT-9000", clicks: [4, 5], perClickMs: [8000, 12000] },
};

function randBetween([a, b]: [number, number]): number {
  return a + Math.random() * (b - a);
}

export function makeGhost(difficulty: GhostDifficulty): GhostPlan {
  const p = GHOST_PRESETS[difficulty];
  const clicks = Math.round(randBetween(p.clicks));
  const steps: PathStep[] = [];
  let t = 0;
  for (let i = 1; i <= clicks; i++) {
    t += randBetween(p.perClickMs);
    steps.push({ title: `hop ${i}`, atMs: Math.round(t) });
  }
  return { name: p.name, steps, isReplay: false };
}

export function ghostFromResult(r: RaceResult): GhostPlan {
  return { name: r.name || "Challenger", steps: r.path.slice(1), isReplay: true };
}

// --- challenge link encoding: compact JSON -> base64url in the URL hash ---

export function encodeChallenge(r: RaceResult): string {
  const compact = {
    n: r.name,
    s: r.start,
    g: r.target,
    c: r.clicks,
    t: r.timeMs,
    p: r.path.map((s) => [s.title, s.atMs]),
  };
  const json = JSON.stringify(compact);
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeChallenge(hash: string): RaceResult | null {
  try {
    let b64 = hash.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const j = JSON.parse(new TextDecoder().decode(bytes));
    return {
      name: j.n ?? "Challenger",
      start: j.s,
      target: j.g,
      clicks: j.c,
      timeMs: j.t,
      path: (j.p as [string, number][]).map(([title, atMs]) => ({ title, atMs })),
    };
  } catch {
    return null;
  }
}

export function fmtTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const cs = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}
