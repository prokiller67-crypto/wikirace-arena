"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { preconnect } from "react-dom";
import Link from "next/link";
import {
  fetchArticle,
  fetchSummary,
  normalizeTitle,
  prefetchArticle,
  randomFunPairExcept,
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

type Phase = "loading" | "countdown" | "racing" | "won" | "lost" | "error";

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
  round: number;
  startAt: number; // epoch ms, SERVER clock
  playerName: string;
  isHost: boolean;
  clockOffset: number; // serverNow - clientNow at room fetch time
}

export default function RaceClient({
  room,
  onRoomRoundChange,
}: {
  room?: RoomProps;
  onRoomRoundChange?: (room: Room) => void;
}) {
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
  const [copyFallback, setCopyFallback] = useState("");
  const [roomState, setRoomState] = useState<Room | null>(null);
  const [nextRoundBusy, setNextRoundBusy] = useState(false);
  const [nextRoundError, setNextRoundError] = useState("");

  const startTimeRef = useRef<number>(0); // performance.now() basis for solo, epoch for rooms
  const startEpochRef = useRef(0);
  const saveKeyRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const breadcrumbRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<Phase>("loading");
  const transitioningRoundRef = useRef<number | null>(null);
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
      const g = params.get("ghost");
      ghostParam =
        g === "chill" || g === "sweaty" || g === "goated" ? g : null;
      playerName = localStorage.getItem("wr-name") || "Racer";
      if (!s || !t) {
        setError("This race link is missing a start or target article.");
        setPhase("error");
        return;
      }
    }

    (async () => {
      try {
        // crash recovery: a reload mid-race must not reset progress to zero
        const saveKey = room
          ? `wr-prog-${room.code}-${room.playerId}-${room.round}`
          : "wr-prog-solo";
        saveKeyRef.current = saveKey;
        let saved: {
          s: string;
          t: string;
          e: number;
          p: [string, number][];
          g?: GhostPlan;
          f?: number;
        } | null = null;
        try {
          saved = JSON.parse(sessionStorage.getItem(saveKey) ?? "null");
        } catch {}
        if (
          saved &&
          (normalizeTitle(saved.s) !== normalizeTitle(s) ||
            normalizeTitle(saved.t) !== normalizeTitle(t))
        ) {
          saved = null; // stale blob from a different race
        }

        const [, targetSum] = await Promise.all([fetchSummary(s), fetchSummary(t)]);
        const ghost: GhostPlan | null =
          saved?.g ??
          (challenger
            ? ghostFromResult(challenger)
            : ghostParam
              ? makeGhost(ghostParam)
              : null);
        setSetup({
          start: s,
          target: t,
          targetCanonical: targetSum.title,
          ghost,
          playerName,
        });
        const resumeTitle = saved ? saved.p[saved.p.length - 1][0] : s;
        const first = await fetchArticle(resumeTitle);
        setArticle(first);
        setPath(
          saved
            ? saved.p.map(([title, atMs]) => ({ title, atMs }))
            : [{ title: first.canonicalTitle, atMs: 0 }]
        );
        startEpochRef.current = saved?.e ?? Date.now();
        if (saved?.f !== undefined) {
          const restoredPath = saved.p.map(([title, atMs]) => ({ title, atMs }));
          setElapsed(saved.f);
          setResult({
            name: playerName,
            start: s,
            target: targetSum.title,
            clicks: restoredPath.length - 1,
            timeMs: saved.f,
            path: restoredPath,
          });
          setPhase("won");
        } else if (room && Date.now() + room.clockOffset < room.startAt) {
          setPhase("countdown");
        } else {
          // continue the clock from where the crash left it
          startTimeRef.current =
            performance.now() - (Date.now() - startEpochRef.current);
          setPhase("racing");
        }
        try {
          sessionStorage.setItem(
            saveKey,
            JSON.stringify({
              s,
              t,
              e: startEpochRef.current,
              p: saved?.p ?? [[first.canonicalTitle, 0]],
              g: ghost ?? undefined,
              f: saved?.f,
            })
          );
        } catch {}
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
    const id = setInterval(() => setElapsed(Math.max(0, now())), 100);
    return () => clearInterval(id);
  }, [phase, now]);

  // --- room polling + progress push ---
  const acceptRoomState = useCallback(
    (nextRoom: Room) => {
      if (room && nextRoom.round !== room.round) {
        if (transitioningRoundRef.current !== nextRoom.round) {
          transitioningRoundRef.current = nextRoom.round;
          try {
            sessionStorage.removeItem(saveKeyRef.current);
          } catch {}
          onRoomRoundChange?.(nextRoom);
        }
        return;
      }
      setRoomState(nextRoom);
    },
    [room, onRoomRoundChange]
  );

  const pushProgress = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!room) return;
      try {
        const res = await fetch(`/api/room/${room.code}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "progress",
            playerId: room.playerId,
            ...payload,
            round: room.round,
          }),
        });
        if (res.ok) acceptRoomState(await res.json());
      } catch {
        // network blip — next poll catches up
      }
    },
    [acceptRoomState, room]
  );

  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/room/${room.code}`, { cache: "no-store" });
        if (res.ok && !cancelled) acceptRoomState(await res.json());
      } catch {}
    };
    poll();
    const id = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [acceptRoomState, room]);

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
          try {
            if (won && !room) {
              sessionStorage.removeItem(saveKeyRef.current);
            } else {
              sessionStorage.setItem(
                saveKeyRef.current,
                JSON.stringify({
                  s: setup.start,
                  t: setup.target,
                  e: startEpochRef.current,
                  p: next.map((x) => [x.title, x.atMs]),
                  g: setup.ghost ?? undefined,
                  f: won ? Math.round(atMs) : undefined,
                })
              );
            }
          } catch {}
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

  // Mouse navigates on pointerdown (macOS trackpads swallow physical presses
  // as micro-selections if we wait for `click`). Touch must NOT navigate on
  // pointerdown — fingers start scrolls there — so it navigates on click.
  const lastPointerTypeRef = useRef("mouse");
  const onArticlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      lastPointerTypeRef.current = e.pointerType;
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      const a = (e.target as HTMLElement).closest("a");
      const title = a?.getAttribute("data-wl-title");
      if (title) {
        e.preventDefault();
        if (!articleLoading) navigate(title);
      }
    },
    [navigate, articleLoading]
  );

  // block the default hash-jump; touch/pen navigate here
  const onArticleClick = useCallback(
    (e: React.MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a");
      if (!a) return;
      e.preventDefault();
      // Keyboard and assistive-tech clicks have detail=0. Mouse clicks are
      // already handled on pointerdown; touch/pen clicks still land here.
      if (lastPointerTypeRef.current !== "mouse" || e.detail === 0) {
        const title = a.getAttribute("data-wl-title");
        if (title && !articleLoading) navigate(title);
      }
    },
    [navigate, articleLoading]
  );

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
    try {
      await navigator.clipboard.writeText(challengeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyFallback(challengeUrl); // clipboard blocked — show the url
    }
  };

  const playerWon = result !== null && (!ghost || result.timeMs <= ghostFinishMs);
  const opponents: RoomPlayer[] =
    room && roomState
      ? roomState.players.filter((p) => p.id !== room.playerId)
      : [];

  // Race ends for EVERYONE once the podium is full: fewer than 4 players —
  // first finisher wins; 4+ players — top-3 podium.
  const podiumSize = roomState && roomState.players.length >= 4 ? 3 : 1;
  const finishersCount = roomState
    ? roomState.players.filter((p) => p.finished).length
    : 0;
  const roomRaceOver = roomState !== null && finishersCount >= podiumSize;
  const canOpenNextRound =
    roomRaceOver || Boolean(room?.isHost && finishersCount >= 1);
  useEffect(() => {
    if (room && phase === "racing" && roomRaceOver) {
      setPhase("lost");
    }
  }, [room, phase, roomRaceOver]);

  // solo ghost race is also first-to-finish: the ghost crossing the line ends it
  useEffect(() => {
    if (!room && ghost && phase === "racing" && ghostFinished) {
      setPhase("lost");
    }
  }, [room, ghost, phase, ghostFinished]);

  // A loss has no pending server result. Solo wins also need no recovery after
  // the result overlay appears; room wins are kept until the server confirms.
  useEffect(() => {
    if (phase === "lost" || (phase === "won" && !room)) {
      try {
        sessionStorage.removeItem(saveKeyRef.current);
      } catch {}
    }
  }, [phase, room]);

  // A locally completed room race must eventually reach the server even if the
  // finishing POST hit a transient network failure. Keep retrying until polling
  // confirms this player as finished or the room advances to another round.
  useEffect(() => {
    if (!room || phase !== "won" || !result) return;
    const me = roomState?.players.find((player) => player.id === room.playerId);
    // Keep the completed blob until the room changes round. In 4+ player rooms
    // an early podium finisher may reload while the remaining spots are open.
    if (me?.finished) return;

    const finishPayload = {
      currentTitle: result.target,
      clicks: result.clicks,
      path: result.path.map((step) => step.title),
      finished: true,
      timeMs: result.timeMs,
    };
    pushProgress(finishPayload);
    const id = setInterval(() => pushProgress(finishPayload), 2000);
    return () => clearInterval(id);
  }, [phase, pushProgress, result, room, roomState]);

  const sortedPlayers = roomState
    ? [...roomState.players].sort((a, b) => {
        if (a.finished && b.finished) return (a.timeMs ?? 0) - (b.timeMs ?? 0);
        if (a.finished) return -1;
        if (b.finished) return 1;
        return b.clicks - a.clicks;
      })
    : [];

  // Keep this object stable while the 100ms race timer re-renders the HUD.
  // React otherwise assigns innerHTML again on every tick, recreating images.
  const articleMarkup = useMemo(
    () => ({ __html: article?.html ?? "" }),
    [article?.html]
  );

  useEffect(() => {
    const breadcrumb = breadcrumbRef.current;
    if (breadcrumb) breadcrumb.scrollLeft = breadcrumb.scrollWidth;
  }, [path]);

  const startNextRound = async () => {
    if (!room || !canOpenNextRound || nextRoundBusy) return;
    setNextRoundBusy(true);
    setNextRoundError("");
    try {
      const [start, target] = randomFunPairExcept(room.start, room.target);
      const res = await fetch(`/api/room/${room.code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "nextRound",
          playerId: room.playerId,
          round: room.round,
          start,
          target,
          force: !roomRaceOver,
        }),
      });
      const nextRoom = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(nextRoom?.error ?? "Couldn't open the next round.");
      }
      acceptRoomState(nextRoom);
    } catch (e) {
      setNextRoundError(
        e instanceof Error ? e.message : "Couldn't open the next round."
      );
      setNextRoundBusy(false);
    }
  };

  const roomNextRoundControls = room ? (
    <div className="space-y-3">
      {room.isHost ? (
        <button
          onClick={startNextRound}
          disabled={!canOpenNextRound || nextRoundBusy}
          className="btn-race w-full py-3 text-center text-lg uppercase cursor-pointer disabled:opacity-50"
        >
          {nextRoundBusy
            ? "Opening the garage…"
            : roomRaceOver
              ? "🏁 New race — same room"
              : canOpenNextRound
                ? "🏁 End round — same room"
                : "Syncing final standings…"}
        </button>
      ) : (
        <p className="mono border border-(--line) px-3 py-3 text-center text-sm animate-pulse">
          staying in room {room.code} — waiting for the host to open round{" "}
          {room.round + 1}…
        </p>
      )}
      {nextRoundError && (
        <p className="mono text-sm text-(--coral) text-center">
          ⚠️ {nextRoundError}
        </p>
      )}
      <Link
        href="/"
        className="block w-full border border-(--line) py-2 mono text-xs uppercase hover:border-(--coral) text-center"
      >
        Leave room
      </Link>
    </div>
  ) : null;

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
    <main className="h-dvh min-h-0 overflow-hidden flex flex-col">
      {/* HUD bar */}
      <header className="card-dark shrink-0 border-b border-(--line) grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2 sm:flex sm:flex-wrap sm:gap-4 sm:px-4">
        <Link
          href="/"
          className="display min-w-0 truncate text-(--acid) text-base leading-none sm:text-lg"
        >
          WIKIRACE<span className="text-(--paper)">⚡ARENA</span>
        </Link>
        <div className="mono justify-self-end text-xl font-bold tabular-nums text-(--acid) sm:text-2xl">
          {fmtTime(elapsed)}
        </div>
        <div className="mono flex min-w-0 items-center gap-2 overflow-hidden text-xs opacity-80 sm:text-sm">
          <span className="shrink-0">
            {path.length - 1} click{path.length - 1 === 1 ? "" : "s"}
          </span>
          {room && <span className="truncate text-xs opacity-70">room {room.code}</span>}
          <span
            role="status"
            aria-live="polite"
            className={`shrink-0 text-xs text-(--sky) ${
              articleLoading ? "visible" : "invisible"
            }`}
          >
            loading…
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2 justify-self-end sm:ml-auto">
          <span className="mono hidden text-xs uppercase opacity-60 sm:inline">target</span>
          <span
            title={setup.targetCanonical}
            className="pulse-acid block max-w-[42vw] truncate bg-(--acid) px-2 py-1 text-[#101014] display text-xs sm:max-w-[36vw] sm:px-3 sm:text-sm lg:max-w-none"
          >
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
              : ghost.isReplay
                ? `reading: ${ghostDone > 0 ? ghost.steps[ghostDone - 1].title : setup.start}`
                : `${ghostDone}/${ghostTotal} hops`}
          </span>
        </div>
      )}

      {room &&
        room.isHost &&
        phase === "racing" &&
        finishersCount > 0 &&
        !roomRaceOver && (
          <div className="card-dark shrink-0 flex flex-wrap items-center justify-between gap-2 border-b border-(--line) px-3 py-2 sm:px-4">
            <span className="mono text-xs opacity-70">
              {finishersCount}/{podiumSize} podium spots filled
            </span>
            <button
              onClick={startNextRound}
              disabled={nextRoundBusy}
              className="mono border border-(--coral) px-3 py-1.5 text-xs uppercase text-(--coral) hover:bg-[rgba(255,77,90,0.08)] cursor-pointer disabled:opacity-50"
            >
              {nextRoundBusy ? "Ending…" : "End round & return to lobby"}
            </button>
          </div>
        )}

      {/* opponents bars (rooms) */}
      {room && opponents.length > 0 && (
        <>
          <div className="card-dark shrink-0 flex gap-2 overflow-x-auto border-b border-(--line) px-3 py-1.5 sm:hidden">
            {opponents.map((p) => (
              <div
                key={p.id}
                className="mono flex shrink-0 items-center gap-1.5 border border-(--line) bg-[#0a0a0e] px-2 py-1 text-xs"
              >
                <span className="max-w-24 truncate text-(--sky)">🏎️ {p.name}</span>
                <span className="opacity-70">
                  {p.finished ? `🏁 ${fmtTime(p.timeMs ?? 0)}` : `${p.clicks}c`}
                </span>
              </div>
            ))}
          </div>
          {opponents.map((p) => (
            <div
              key={`${p.id}-detail`}
              className="card-dark hidden border-b border-(--line) px-4 py-1 items-center gap-3 sm:flex"
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
        </>
      )}

      {/* breadcrumb path */}
      <div
        ref={breadcrumbRef}
        className="shrink-0 px-3 py-1.5 flex items-center gap-1 overflow-x-auto whitespace-nowrap mono text-xs border-b border-(--line) bg-[#0c0c10] sm:px-4"
      >
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
        className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden speedlines"
        onClick={onArticleClick}
        onPointerDown={onArticlePointerDown}
        onMouseOver={onArticleHover}
      >
        <article
          aria-busy={articleLoading}
          className={`wiki-page w-full min-w-0 max-w-3xl mx-auto my-3 px-4 py-4 shadow-2xl rounded-sm sm:my-6 sm:px-8 sm:py-6 ${
            articleLoading ? "pointer-events-none" : ""
          }`}
        >
          <h1 className="text-3xl font-bold border-b-2 border-[#d8cfb4] pb-2 mb-4">
            {article.canonicalTitle}
          </h1>
          <div dangerouslySetInnerHTML={articleMarkup} />
        </article>
      </div>

      {/* countdown overlay (rooms) */}
      {phase === "countdown" && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
          <p className="mono max-w-[90vw] break-words px-4 text-center text-sm uppercase leading-relaxed opacity-70 sm:max-w-2xl">
            {setup.start} → {setup.targetCanonical}
          </p>
          <div className="display text-8xl text-(--acid)">
            {Math.max(0, Math.ceil(countdownLeft / 1000))}
          </div>
          <p className="mono text-sm opacity-60">get ready…</p>
        </div>
      )}

      {/* defeat overlay — someone (player or ghost) filled the podium first */}
      {phase === "lost" && (room ? roomState !== null : ghost !== null) && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="card-dark slide-up max-w-lg w-full p-8 border-2 border-(--coral) my-8">
            <div className="checker h-3 mb-6" />
            <h2 className="display text-4xl text-(--coral) mb-1">WRECKED!</h2>
            <p className="mono text-sm mb-5 opacity-80">
              {!room && ghost
                ? `👻 ${ghost.name} reached ${setup.targetCanonical} in ${fmtTime(ghostFinishMs)} 🏆`
                : podiumSize === 1
                  ? `${sortedPlayers[0]?.name ?? "Someone"} reached ${setup.targetCanonical} first 🏆`
                  : "The podium is full — race over."}{" "}
              You made {path.length - 1} click{path.length - 1 === 1 ? "" : "s"}.
            </p>
            {room && (
              <div className="mb-6">
                <h3 className="mono text-xs uppercase opacity-60 mb-2">
                  final standings
                </h3>
                <Standings players={sortedPlayers} meId={room.playerId} />
              </div>
            )}
            {room ? (
              roomNextRoundControls
            ) : (
              <div className="flex gap-3">
                <button
                  onClick={() => window.location.reload()}
                  className="flex-1 btn-race py-3 text-center text-lg uppercase cursor-pointer"
                >
                  Rematch
                </button>
                <Link
                  href="/"
                  className="flex-1 border border-(--line) py-3 mono text-sm uppercase hover:border-(--acid) self-stretch flex items-center justify-center text-center"
                >
                  New race
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* win overlay */}
      {phase === "won" && result && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <Confetti />
          <div className="card-dark slide-up max-w-lg w-full p-8 border-2 border-(--acid) my-8">
            <div className="checker h-3 mb-6" />
            <h2 className="display text-4xl text-(--acid) mb-1">
              {room
                ? sortedPlayers.findIndex((p) => p.id === room.playerId) === 0
                  ? "VICTORY LAP!"
                  : "ON THE PODIUM!"
                : playerWon
                  ? "VICTORY LAP!"
                  : "FINISHED!"}
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
                <Standings players={sortedPlayers} meId={room.playerId} />
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
              {copyFallback && (
                <input
                  readOnly
                  value={copyFallback}
                  onFocus={(e) => e.target.select()}
                  className="w-full bg-[#0a0a0e] border border-(--line) px-3 py-2 mono text-xs"
                />
              )}
              <p className="mono text-[11px] opacity-50 text-center">
                Your whole run is encoded in the link — friends race your live ghost.
                No account, no server, no excuses.
              </p>
              {room ? (
                roomNextRoundControls
              ) : (
                <div className="flex gap-3">
                  <button
                    onClick={() => window.location.reload()}
                    className="flex-1 border border-(--line) py-2 mono text-sm uppercase hover:border-(--acid) cursor-pointer"
                  >
                    Rematch
                  </button>
                  <Link
                    href="/"
                    className="flex-1 border border-(--line) py-2 mono text-sm uppercase hover:border-(--acid) text-center"
                  >
                    New race
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Standings({ players, meId }: { players: RoomPlayer[]; meId: string }) {
  return (
    <div className="space-y-1">
      {players.map((p, i) => (
        <div
          key={p.id}
          className={`mono text-sm flex gap-2 items-center ${
            p.id === meId ? "text-(--acid)" : "opacity-85"
          }`}
        >
          <span className="w-6">
            {p.finished ? ["🥇", "🥈", "🥉"][i] ?? `${i + 1}.` : "…"}
          </span>
          <span className="flex-1 truncate">{p.name}</span>
          <span>
            {p.finished
              ? `${fmtTime(p.timeMs ?? 0)} · ${p.clicks} clicks`
              : `DNF — ${p.clicks} clicks`}
          </span>
        </div>
      ))}
    </div>
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
