"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { preconnect } from "react-dom";
import Link from "next/link";
import {
  fetchArticle,
  fetchSummary,
  normalizeTitle,
  prefetchArticle,
  type LoadedArticle,
} from "@/lib/wiki";
import {
  decodeChallenge,
  encodeChallenge,
  fmtTime,
  ghostFromResult,
  makeGhost,
  type GhostDifficulty,
  type GhostPlan,
  type PathStep,
  type RaceResult,
} from "@/lib/game";
import type { Room, RoomPlayer } from "@/lib/rooms";

type Phase = "loading" | "countdown" | "racing" | "won" | "error";

interface Setup {
  start: string;
  target: string;
  targetCanonical: string;
  ghost: GhostPlan | null;
  playerName: string;
}

export interface RoomProps {
  code: string;
  playerId: string;
  start: string;
  target: string;
  startAt: number; // epoch ms, SERVER clock
  playerName: string;
  clockOffset: number; // serverNow - clientNow at room fetch time
}

export default function RaceClient({ room }: { room?: RoomProps }) {
  preconnect("https://en.wikipedia.org");
  preconnect("https://upload.wikimedia.org");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [article, setArticle] = useState<LoadedArticle | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  const [path, setPath] = useState<PathStep[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [countdownLeft, setCountdownLeft] = useState(0);
  const [result, setResult] = useState<RaceResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [roomState, setRoomState] = useState<Room | null>(null);

  const startTimeRef = useRef<number>(0); // performance.now() basis for solo, epoch for rooms
  const scrollRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<Phase>("loading");
  phaseRef.current = phase;

  const now = useCallback(
    () =>
      room
        ? Date.now() + room.clockOffset - room.startAt
        : performance.now() - startTimeRef.current,
    [room]
  );

  // --- bootstrap ---
  useEffect(() => {
    let s: string, t: string;
    let ghostParam: GhostDifficulty | null = null;
    let challenger: RaceResult | null = null;
    let playerName = "Racer";

    if (room) {
      s = room.start;
      t = room.target;
      playerName = room.playerName;
    } else {
      const params = new URLSearchParams(window.location.search);
      const hash = window.location.hash.startsWith("#c=")
        ? window.location.hash.slice(3)
        : "";
      challenger = hash ? decodeChallenge(hash) : null;
      s = challenger?.start || params.get("start") || "";
      t = challenger?.target || params.get("target") || "";
      ghostParam = params.get("ghost") as GhostDifficulty | null;
      playerName = localStorage.getItem("wr-name") || "Racer";
      if (!s || !t) {
        setError("This race link is missing a start or target article.");
        setPhase("error");
        return;
      }
    }

    (async () => {
      try {
        const [, targetSum] = await Promise.all([fetchSummary(s), fetchSummary(t)]);
        const ghost: GhostPlan | null = challenger
          ? ghostFromResult(challenger)
          : ghostParam
            ? makeGhost(ghostParam)
            : null;
        setSetup({
          start: s,
          target: t,
          targetCanonical: targetSum.title,
          ghost,
          playerName,
        });
        const first = await fetchArticle(s);
        setArticle(first);
        setPath([{ title: first.canonicalTitle, atMs: 0 }]);
        if (room && Date.now() + room.clockOffset < room.startAt) {
          setPhase("countdown");
        } else {
          startTimeRef.current = performance.now();
          setPhase("racing");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load the race.");
        setPhase("error");
      }
    })();
  }, [room]);

  // --- countdown for rooms ---
  useEffect(() => {
    if (phase !== "countdown" || !room) return;
    const mountedAt = Date.now();
    const id = setInterval(() => {
      const left = room.startAt - (Date.now() + room.clockOffset);
      setCountdownLeft(left);
      // watchdog: never let a countdown hold the race hostage for more than 15s
      if (left <= 0 || Date.now() - mountedAt > 15000) setPhase("racing");
    }, 100);
    return () => clearInterval(id);
  }, [phase, room]);

  // --- timer ---
  useEffect(() => {
    if (phase !== "racing") return;
    const id = setInterval(() => setElapsed(Math.max(0, now())), 53);
    return () => clearInterval(id);
  }, [phase, now]);

  // --- room polling + progress push ---
  const pushProgress = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!room) return;
      try {
        const res = await fetch(`/api/room/${room.code}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "progress", playerId: room.playerId, ...payload }),
        });
        if (res.ok) setRoomState(await res.json());
      } catch {
        // network blip — next poll catches up
      }
    },
    [room]
  );

  useEffect(() => {
    if (!room || (phase !== "racing" && phase !== "won" && phase !== "countdown")) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/room/${room.code}`, { cache: "no-store" });
        if (res.ok) setRoomState(await res.json());
      } catch {}
    }, 1500);
    return () => clearInterval(id);
  }, [room, phase]);

  // --- navigation on wiki-link click ---
  const navigate = useCallback(
    async (title: string) => {
      if (phaseRef.current !== "racing" || !setup) return;
      setArticleLoading(true);
      try {
        const art = await fetchArticle(title);
        const atMs = now();
        setArticle(art);
        scrollRef.current?.scrollTo({ top: 0 });
        setPath((p) => {
          const next = [...p, { title: art.canonicalTitle, atMs }];
          const won =
            normalizeTitle(art.canonicalTitle) ===
            normalizeTitle(setup.targetCanonical);
          if (won) {
            const res: RaceResult = {
              name: setup.playerName,
              start: setup.start,
              target: setup.targetCanonical,
              clicks: next.length - 1,
              timeMs: Math.round(atMs),
              path: next,
            };
            setResult(res);
            setPhase("won");
          }
          pushProgress({
            currentTitle: art.canonicalTitle,
            clicks: next.length - 1,
            path: next.map((x) => x.title),
            ...(won ? { finished: true, timeMs: Math.round(atMs) } : {}),
          });
          return next;
        });
      } catch {
        // dead link — stay on page
      } finally {
        setArticleLoading(false);
      }
    },
    [setup, now, pushProgress]
  );

  // Navigate on pointerdown: fires identically for trackpad taps, physical
  // presses, and touch — a regular `click` gets swallowed by macOS trackpads
  // when the finger rolls slightly during a physical press.
  const onArticlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const a = (e.target as HTMLElement).closest("a");
      const title = a?.getAttribute("data-wl-title");
      if (title) {
        e.preventDefault();
        if (!articleLoading) navigate(title);
      }
    },
    [navigate, articleLoading]
  );

  // block the default hash-jump of the synthetic click that follows
  const onArticleClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("a")) e.preventDefault();
  }, []);

  // warm the cache the moment the cursor touches a link — click becomes instant
  const onArticleHover = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    const title = a?.getAttribute("data-wl-title");
    if (title) prefetchArticle(title);
  }, []);

  // --- ghost progress (solo modes) ---
  const ghost = setup?.ghost ?? null;
  const ghostTotal = ghost ? ghost.steps.length : 0;
  const ghostDone = ghost ? ghost.steps.filter((s) => s.atMs <= elapsed).length : 0;
  const ghostFinished = ghost !== null && ghostDone >= ghostTotal;
  const ghostFinishMs = ghost?.steps[ghost.steps.length - 1]?.atMs ?? 0;

  const challengeUrl =
    result && typeof window !== "undefined"
      ? `${window.location.origin}/race#c=${encodeChallenge(result)}`
      : "";

  const copyChallenge = async () => {
    await navigator.clipboard.writeText(challengeUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const playerWon = result !== null && (!ghost || result.timeMs <= ghostFinishMs);
  const opponents: RoomPlayer[] =
    room && roomState
      ? roomState.players.filter((p) => p.id !== room.playerId)
      : [];

  if (phase === "error") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
        <h1 className="display text-3xl text-(--coral)">WIPEOUT</h1>
        <p className="max-w-md text-center opacity-80">{error}</p>
        <Link href="/" className="btn-race px-6 py-3 text-lg uppercase">
          Back to the garage
        </Link>
      </main>
    );
  }

  if (phase === "loading" || !setup || !article) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="display text-2xl animate-pulse text-(--acid)">
          REVVING ENGINES…
        </div>
        <p className="mono text-sm opacity-60">loading articles from Wikipedia</p>
      </main>
    );
  }

  return (
    <main className="h-screen flex flex-col">
      {/* HUD bar */}
      <header className="card-dark border-b border-(--line) px-4 py-2 flex items-center gap-4 flex-wrap">
        <Link href="/" className="display text-(--acid) text-lg leading-none">
          WIKIRACE<span className="text-(--paper)">⚡ARENA</span>
        </Link>
        <div className="mono text-2xl font-bold tabular-nums text-(--acid)">
          {fmtTime(elapsed)}
        </div>
        <div className="mono text-sm opacity-80">
          {path.length - 1} click{path.length - 1 === 1 ? "" : "s"}
        </div>
        {room && (
          <div className="mono text-xs opacity-60">room {room.code}</div>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <span className="mono text-xs uppercase opacity-60">target</span>
          <span className="pulse-acid bg-(--acid) text-[#101014] display text-sm px-3 py-1">
            {setup.targetCanonical}
          </span>
        </div>
      </header>

      {/* ghost bar (solo) */}
      {ghost && phase !== "won" && (
        <div className="card-dark border-b border-(--line) px-4 py-1.5 flex items-center gap-3">
          <span className="mono text-xs uppercase text-(--sky)">👻 {ghost.name}</span>
          <div className="flex-1 h-2 bg-[#0a0a0e] rounded overflow-hidden">
            <div
              className="h-full bg-(--sky) transition-all duration-500"
              style={{ width: `${Math.min(100, (ghostDone / ghostTotal) * 100)}%` }}
            />
          </div>
          <span className="mono text-xs opacity-70">
            {ghostFinished
              ? `finished in ${fmtTime(ghostFinishMs)} 😤`
              : ghost.isReplay && ghost.steps[ghostDone]
                ? `reading: ${ghost.steps[ghostDone].title}`
                : `${ghostDone}/${ghostTotal} hops`}
          </span>
        </div>
      )}

      {/* opponents bars (rooms) */}
      {room &&
        opponents.map((p) => (
          <div
            key={p.id}
            className="card-dark border-b border-(--line) px-4 py-1 flex items-center gap-3"
          >
            <span className="mono text-xs uppercase text-(--sky) w-32 truncate">
              🏎️ {p.name}
            </span>
            <span className="mono text-xs opacity-70 flex-1 truncate">
              {p.finished
                ? `🏁 finished — ${fmtTime(p.timeMs ?? 0)} / ${p.clicks} clicks`
                : `reading: ${p.currentTitle}`}
            </span>
            <span className="mono text-xs opacity-60">{p.clicks} clicks</span>
          </div>
        ))}

      {/* breadcrumb path */}
      <div className="px-4 py-1.5 flex items-center gap-1 overflow-x-auto whitespace-nowrap mono text-xs border-b border-(--line) bg-[#0c0c10]">
        {path.map((s, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="opacity-40">→</span>}
            <span className={i === path.length - 1 ? "text-(--acid)" : "opacity-70"}>
              {s.title}
            </span>
          </span>
        ))}
      </div>

      {/* article */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto speedlines"
        onClick={onArticleClick}
        onPointerDown={onArticlePointerDown}
        onMouseOver={onArticleHover}
      >
        <article
          className={`wiki-page max-w-3xl mx-auto my-6 px-8 py-6 shadow-2xl rounded-sm transition-opacity ${
            articleLoading ? "opacity-40 pointer-events-none" : "opacity-100"
          }`}
        >
          <h1 className="text-3xl font-bold border-b-2 border-[#d8cfb4] pb-2 mb-4">
            {article.canonicalTitle}
          </h1>
          <div dangerouslySetInnerHTML={{ __html: article.html }} />
        </article>
      </div>

      {/* countdown overlay (rooms) */}
      {phase === "countdown" && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
          <p className="mono text-sm uppercase opacity-70">
            {setup.start} → {setup.targetCanonical}
          </p>
          <div className="display text-8xl text-(--acid)">
            {Math.max(0, Math.ceil(countdownLeft / 1000))}
          </div>
          <p className="mono text-sm opacity-60">get ready…</p>
        </div>
      )}

      {/* win overlay */}
      {phase === "won" && result && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <Confetti />
          <div className="card-dark slide-up max-w-lg w-full p-8 border-2 border-(--acid) my-8">
            <div className="checker h-3 mb-6" />
            <h2 className="display text-4xl text-(--acid) mb-1">
              {room ? "FINISHED!" : playerWon ? "VICTORY LAP!" : "FINISHED!"}
            </h2>
            {!room && ghost && (
              <p className="mono text-sm mb-4 text-(--sky)">
                {playerWon
                  ? `You beat ${ghost.name} by ${fmtTime(Math.abs(ghostFinishMs - result.timeMs))} 🏆`
                  : `${ghost.name} was faster by ${fmtTime(Math.abs(result.timeMs - ghostFinishMs))} — rematch?`}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 my-5">
              <div className="bg-[#0a0a0e] p-4 text-center">
                <div className="mono text-3xl font-bold text-(--acid) tabular-nums">
                  {fmtTime(result.timeMs)}
                </div>
                <div className="mono text-xs uppercase opacity-60 mt-1">time</div>
              </div>
              <div className="bg-[#0a0a0e] p-4 text-center">
                <div className="mono text-3xl font-bold text-(--acid) tabular-nums">
                  {result.clicks}
                </div>
                <div className="mono text-xs uppercase opacity-60 mt-1">clicks</div>
              </div>
            </div>

            {/* live standings for rooms */}
            {room && roomState && (
              <div className="mb-5">
                <h3 className="mono text-xs uppercase opacity-60 mb-2">standings</h3>
                <div className="space-y-1">
                  {[...roomState.players]
                    .sort((a, b) => {
                      if (a.finished && b.finished)
                        return (a.timeMs ?? 0) - (b.timeMs ?? 0);
                      if (a.finished) return -1;
                      if (b.finished) return 1;
                      return b.clicks - a.clicks;
                    })
                    .map((p, i) => (
                      <div
                        key={p.id}
                        className={`mono text-sm flex gap-2 items-center ${
                          p.id === room.playerId ? "text-(--acid)" : "opacity-85"
                        }`}
                      >
                        <span className="w-6">
                          {p.finished ? ["🥇", "🥈", "🥉"][i] ?? `${i + 1}.` : "…"}
                        </span>
                        <span className="flex-1 truncate">{p.name}</span>
                        <span>
                          {p.finished
                            ? `${fmtTime(p.timeMs ?? 0)} · ${p.clicks} clicks`
                            : `racing — ${p.clicks} clicks`}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            <div className="mono text-xs leading-relaxed opacity-80 mb-6 max-h-28 overflow-y-auto">
              {result.path.map((s, i) => (
                <span key={i}>
                  {i > 0 && <span className="text-(--acid)"> → </span>}
                  {s.title}
                </span>
              ))}
            </div>
            <div className="space-y-3">
              <button
                onClick={copyChallenge}
                className="btn-race w-full py-3 uppercase text-lg cursor-pointer"
              >
                {copied ? "✓ Copied — go taunt a friend" : "📎 Copy challenge link"}
              </button>
              <p className="mono text-[11px] opacity-50 text-center">
                Your whole run is encoded in the link — friends race your live ghost.
                No account, no server, no excuses.
              </p>
              <div className="flex gap-3">
                {!room && (
                  <button
                    onClick={() => window.location.reload()}
                    className="flex-1 border border-(--line) py-2 mono text-sm uppercase hover:border-(--acid) cursor-pointer"
                  >
                    Rematch
                  </button>
                )}
                <Link
                  href="/"
                  className="flex-1 border border-(--line) py-2 mono text-sm uppercase hover:border-(--acid) text-center"
                >
                  New race
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Confetti() {
  const colors = ["#d7ff00", "#ff4d5a", "#4dc9ff", "#f7f2e5"];
  const pieces = Array.from({ length: 60 }, (_, i) => ({
    left: `${(i * 37) % 100}%`,
    background: colors[i % colors.length],
    animationDuration: `${2 + ((i * 13) % 20) / 10}s`,
    animationDelay: `${((i * 7) % 15) / 10}s`,
  }));
  return (
    <>
      {pieces.map((style, i) => (
        <div key={i} className="confetti" style={style} />
      ))}
    </>
  );
}
