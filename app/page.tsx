"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchRandomSummary, fetchSummary, randomFunPair } from "@/lib/wiki";
import type { GhostDifficulty } from "@/lib/game";

type Mode = "curated" | "random" | "custom";

const GHOSTS: { id: GhostDifficulty | "none"; label: string; blurb: string }[] = [
  { id: "chill", label: "👻 Chill Carl", blurb: "wanders casually" },
  { id: "sweaty", label: "👻 Sweaty Sam", blurb: "actually trying" },
  { id: "goated", label: "👻 GOAT-9000", blurb: "borderline unfair" },
  { id: "none", label: "🧘 Solo", blurb: "just you & the clock" },
];

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<Mode>("curated");
  const [pair, setPair] = useState<[string, string]>(["Pizza", "Black hole"]);
  const [customStart, setCustomStart] = useState("");
  const [customTarget, setCustomTarget] = useState("");
  const [ghost, setGhost] = useState<GhostDifficulty | "none">("sweaty");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setName(localStorage.getItem("wr-name") ?? "");
    setPair(randomFunPair());
  }, []);

  const resolvePair = async (): Promise<[string, string]> => {
    if (mode === "custom") {
      if (!customStart.trim() || !customTarget.trim()) {
        throw new Error("Fill in both articles for a custom race.");
      }
      const [a, b] = await Promise.all([
        fetchSummary(customStart.trim()),
        fetchSummary(customTarget.trim()),
      ]);
      return [a.title, b.title];
    }
    if (mode === "random") {
      const [a, b] = await Promise.all([
        fetchRandomSummary(),
        fetchRandomSummary(),
      ]);
      return [a.title, b.title];
    }
    return pair;
  };

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const [s, t] = await resolvePair();
      localStorage.setItem("wr-name", name.trim() || "Racer");
      const q = new URLSearchParams({ start: s, target: t });
      if (ghost !== "none") q.set("ghost", ghost);
      router.push(`/race?${q.toString()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something broke. Try again.");
      setBusy(false);
    }
  };

  const createRoom = async () => {
    setBusy(true);
    setError("");
    try {
      const [s, t] = await resolvePair();
      const trimmed = name.trim() || "Racer";
      localStorage.setItem("wr-name", trimmed);
      const res = await fetch("/api/room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: s, target: t, name: trimmed }),
      });
      if (!res.ok) throw new Error("Couldn't create the room. Try again.");
      const j = await res.json();
      sessionStorage.setItem(`wr-room-${j.code}`, j.playerId);
      router.push(`/room/${j.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something broke. Try again.");
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen speedlines flex flex-col">
      <div className="checker h-4" />
      <div className="flex-1 max-w-5xl w-full mx-auto px-6 py-10 flex flex-col gap-10">
        {/* hero */}
        <header className="slide-up">
          <h1 className="display text-5xl sm:text-7xl leading-[0.95]">
            WIKIRACE
            <br />
            <span className="text-(--acid)">⚡ARENA</span>
          </h1>
          <p className="mt-4 max-w-xl text-lg opacity-85 italic">
            Speedrun the encyclopedia. Get from one article to another using{" "}
            <span className="not-italic font-semibold text-(--acid)">
              only the links
            </span>{" "}
            — beat the ghost, then trap your friends in a challenge link.
          </p>
        </header>

        <div className="grid md:grid-cols-[1fr_320px] gap-8">
          {/* left: race config */}
          <section className="space-y-6 slide-up" style={{ animationDelay: "0.1s" }}>
            {/* mode cards */}
            <div className="grid sm:grid-cols-3 gap-3">
              <ModeCard
                active={mode === "curated"}
                onClick={() => setMode("curated")}
                title="🎯 Classic"
                blurb="a hand-picked absurd matchup"
              />
              <ModeCard
                active={mode === "random"}
                onClick={() => setMode("random")}
                title="🎲 Chaos"
                blurb="two truly random articles"
              />
              <ModeCard
                active={mode === "custom"}
                onClick={() => setMode("custom")}
                title="🛠️ Custom"
                blurb="pick your own poison"
              />
            </div>

            {/* matchup preview */}
            {mode === "curated" && (
              <div className="card-dark p-5 flex items-center gap-4 flex-wrap">
                <MatchupChip title={pair[0]} />
                <span className="display text-(--coral) text-xl">VS</span>
                <MatchupChip title={pair[1]} target />
                <button
                  onClick={() => setPair(randomFunPair())}
                  className="ml-auto mono text-xs uppercase border border-(--line) px-3 py-2 hover:border-(--acid) cursor-pointer"
                >
                  ↻ reroll
                </button>
              </div>
            )}
            {mode === "random" && (
              <div className="card-dark p-5 mono text-sm opacity-80">
                Two completely random articles will be drawn when the light turns
                green. Could be a Slovenian village. Could be a beetle. Good luck.
              </div>
            )}
            {mode === "custom" && (
              <div className="card-dark p-5 grid sm:grid-cols-2 gap-3">
                <input
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  placeholder="Start article (e.g. Pizza)"
                  className="bg-[#0a0a0e] border border-(--line) px-4 py-3 mono text-sm focus:border-(--acid) outline-none"
                />
                <input
                  value={customTarget}
                  onChange={(e) => setCustomTarget(e.target.value)}
                  placeholder="Target article (e.g. Black hole)"
                  className="bg-[#0a0a0e] border border-(--line) px-4 py-3 mono text-sm focus:border-(--acid) outline-none"
                />
              </div>
            )}

            {/* ghost picker */}
            <div>
              <h3 className="mono text-xs uppercase opacity-60 mb-2">
                Pick your opponent
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {GHOSTS.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setGhost(g.id)}
                    className={`p-3 text-left border cursor-pointer transition-colors ${
                      ghost === g.id
                        ? "border-(--acid) bg-[rgba(215,255,0,0.07)]"
                        : "border-(--line) card-dark hover:border-[#4a4a55]"
                    }`}
                  >
                    <div className="display text-sm">{g.label}</div>
                    <div className="mono text-[11px] opacity-60 mt-1">{g.blurb}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* name + go */}
            <div className="flex gap-3 flex-wrap items-stretch">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Racer name"
                maxLength={24}
                className="bg-[#0a0a0e] border border-(--line) px-4 py-3 mono text-sm focus:border-(--acid) outline-none flex-1 min-w-40"
              />
              <button
                onClick={start}
                disabled={busy}
                className="btn-race px-10 py-3 text-xl uppercase cursor-pointer disabled:opacity-60"
              >
                {busy ? "Revving…" : "🏁 Race"}
              </button>
            </div>
            <button
              onClick={createRoom}
              disabled={busy}
              className="w-full border-2 border-(--sky) text-(--sky) py-3 display text-base uppercase hover:bg-[rgba(77,201,255,0.08)] cursor-pointer disabled:opacity-60"
            >
              ⚔️ Create a room — race your friends live
            </button>
            {error && <p className="mono text-sm text-(--coral)">{error}</p>}
          </section>

          {/* right: rules */}
          <aside
            className="card-dark p-6 h-fit slide-up"
            style={{ animationDelay: "0.2s" }}
          >
            <h2 className="display text-lg text-(--acid) mb-4">HOUSE RULES</h2>
            <ol className="space-y-3 mono text-sm opacity-85 list-decimal list-inside">
              <li>You spawn on a Wikipedia article.</li>
              <li>
                Reach the target clicking{" "}
                <span className="text-(--acid)">only in-article links</span>.
              </li>
              <li>No search bar. No back button. No mercy.</li>
              <li>Fewer clicks + faster time = bragging rights.</li>
              <li>
                Finish → get a <span className="text-(--acid)">challenge link</span>{" "}
                with your ghost baked in. Send it. Ruin friendships.
              </li>
            </ol>
            <div className="checker h-2 mt-6" />
            <p className="mono text-[11px] opacity-50 mt-4">
              100% serverless: your run lives inside the link itself. Built solo in
              12 hours for JecHacks 2026.
            </p>
          </aside>
        </div>
      </div>
      <div className="checker h-4" />
    </main>
  );
}

function ModeCard({
  active,
  onClick,
  title,
  blurb,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  blurb: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`p-4 text-left border cursor-pointer transition-colors ${
        active
          ? "border-(--acid) bg-[rgba(215,255,0,0.07)]"
          : "border-(--line) card-dark hover:border-[#4a4a55]"
      }`}
    >
      <div className="display text-base">{title}</div>
      <div className="mono text-xs opacity-60 mt-1">{blurb}</div>
    </button>
  );
}

function MatchupChip({ title, target }: { title: string; target?: boolean }) {
  return (
    <span
      className={`display text-sm px-3 py-2 ${
        target ? "bg-(--acid) text-[#101014]" : "bg-[#0a0a0e] border border-(--line)"
      }`}
    >
      {title}
    </span>
  );
}
