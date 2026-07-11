"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import RaceClient, { type RoomProps } from "@/components/RaceClient";
import type { Room } from "@/lib/rooms";

type Stage = "join" | "lobby" | "race" | "error";

export default function RoomClient({ code }: { code: string }) {
  const [stage, setStage] = useState<Stage>("join");
  const [room, setRoom] = useState<Room | null>(null);
  const [name, setName] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const joinedRef = useRef(false);
  const clockOffsetRef = useRef(0); // serverNow - clientNow, corrects local clock skew

  // restore identity (host lands here right after creating the room)
  useEffect(() => {
    setName(localStorage.getItem("wr-name") ?? "");
    const saved = sessionStorage.getItem(`wr-room-${code}`);
    if (saved) {
      setPlayerId(saved);
      joinedRef.current = true;
      setStage("lobby");
    }
  }, [code]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/room/${code}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Room not found — check the code.");
      const r: Room & { serverNow?: number } = await res.json();
      if (r.serverNow) clockOffsetRef.current = r.serverNow - Date.now();
      setRoom(r);
      if (r.startAt) setStage("race");
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Room not found.");
      setStage("error");
      return null;
    }
  }, [code]);

  // lobby polling
  useEffect(() => {
    if (stage !== "lobby") return;
    refresh();
    const id = setInterval(refresh, 1500);
    return () => clearInterval(id);
  }, [stage, refresh]);

  const join = async () => {
    setBusy(true);
    setError("");
    try {
      const trimmed = name.trim() || "Racer";
      localStorage.setItem("wr-name", trimmed);
      const res = await fetch(`/api/room/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join", name: trimmed }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? "Couldn't join the room.");
      }
      const j = await res.json();
      sessionStorage.setItem(`wr-room-${code}`, j.playerId);
      setPlayerId(j.playerId);
      setRoom(j.room);
      joinedRef.current = true;
      setStage("lobby");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join.");
    } finally {
      setBusy(false);
    }
  };

  const startRace = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/room/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", playerId }),
      });
      if (res.ok) {
        setRoom(await res.json());
        setStage("race");
      }
    } finally {
      setBusy(false);
    }
  };

  const copyInvite = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  if (stage === "error") {
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

  if (stage === "race" && room?.startAt && playerId) {
    const me = room.players.find((p) => p.id === playerId);
    const props: RoomProps = {
      code: room.code,
      playerId,
      start: room.start,
      target: room.target,
      startAt: room.startAt,
      playerName: me?.name ?? "Racer",
      clockOffset: clockOffsetRef.current,
    };
    return <RaceClient room={props} />;
  }

  if (stage === "join") {
    return (
      <main className="min-h-screen speedlines flex flex-col items-center justify-center p-6">
        <div className="card-dark max-w-md w-full p-8 slide-up">
          <div className="checker h-3 mb-6" />
          <h1 className="display text-2xl mb-1">
            JOIN ROOM <span className="text-(--acid)">{code}</span>
          </h1>
          <p className="mono text-sm opacity-70 mb-6">
            You&apos;ve been challenged to a wiki race. Type a name, buckle up.
          </p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && join()}
            placeholder="Racer name"
            maxLength={24}
            autoFocus
            className="w-full bg-[#0a0a0e] border border-(--line) px-4 py-3 mono text-sm focus:border-(--acid) outline-none mb-4"
          />
          {error && <p className="mono text-sm text-(--coral) mb-4">{error}</p>}
          <button
            onClick={join}
            disabled={busy}
            className="btn-race w-full py-3 text-lg uppercase cursor-pointer disabled:opacity-60"
          >
            {busy ? "Joining…" : "🏁 Join the race"}
          </button>
        </div>
      </main>
    );
  }

  // lobby
  return (
    <main className="min-h-screen speedlines flex flex-col items-center justify-center p-6">
      <div className="card-dark max-w-lg w-full p-8 slide-up">
        <div className="checker h-3 mb-6" />
        <h1 className="display text-2xl mb-1">
          ROOM <span className="text-(--acid)">{code}</span>
        </h1>
        {room && (
          <p className="mono text-sm opacity-80 mb-6">
            {room.start} <span className="text-(--coral)">→</span> {room.target}
          </p>
        )}
        <div className="mb-6">
          <h3 className="mono text-xs uppercase opacity-60 mb-2">
            racers ({room?.players.length ?? "…"}/8)
          </h3>
          <div className="space-y-1">
            {room?.players.map((p) => (
              <div key={p.id} className="mono text-sm flex items-center gap-2">
                <span>🏎️</span>
                <span className={p.id === playerId ? "text-(--acid)" : ""}>
                  {p.name}
                  {p.id === room.hostId && (
                    <span className="opacity-50 text-xs"> (host)</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <button
            onClick={copyInvite}
            className="w-full border border-(--line) py-2.5 mono text-sm uppercase hover:border-(--acid) cursor-pointer"
          >
            {copied ? "✓ Invite copied" : "📎 Copy invite link"}
          </button>
          {room && playerId === room.hostId ? (
            <button
              onClick={startRace}
              disabled={busy}
              className="btn-race w-full py-3 text-lg uppercase cursor-pointer disabled:opacity-60"
            >
              🚦 Start the race
            </button>
          ) : (
            <p className="mono text-sm opacity-60 text-center animate-pulse">
              waiting for the host to hit the gas…
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
