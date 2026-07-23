"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import RaceClient, { type RoomProps } from "@/components/RaceClient";
import {
  fetchRandomSummary,
  fetchSummary,
  isBlockedTitle,
  normalizeTitle,
  prefetchArticle,
  randomFunPairExcept,
} from "@/lib/wiki";
import type { Room } from "@/lib/rooms";

type Stage = "join" | "lobby" | "race" | "error";

export default function RoomClient({ code }: { code: string }) {
  const [stage, setStage] = useState<Stage>("join");
  const [room, setRoom] = useState<Room | null>(null);
  const [name, setName] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Working…");
  const [copied, setCopied] = useState(false);
  const [copyFallback, setCopyFallback] = useState("");
  const [draftStart, setDraftStart] = useState("");
  const [draftTarget, setDraftTarget] = useState("");
  const [pairDirty, setPairDirty] = useState(false);
  const [pairStatus, setPairStatus] = useState("");
  const clockOffsetRef = useRef(0); // serverNow - clientNow, corrects local clock skew

  // restore identity (host lands here right after creating the room)
  useEffect(() => {
    setName(localStorage.getItem("wr-name") ?? "");
    const saved = sessionStorage.getItem(`wr-room-${code}`);
    if (saved) {
      setPlayerId(saved);
      setStage("lobby");
    }
  }, [code]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/room/${code}`, { cache: "no-store" });
      if (res.status === 404) {
        // the only truly fatal answer — the room genuinely doesn't exist
        setError("Room not found — check the code.");
        setStage("error");
        return null;
      }
      if (!res.ok) return null; // transient 5xx — keep polling
      const r: Room & { serverNow?: number } = await res.json();
      if (r.serverNow) clockOffsetRef.current = r.serverNow - Date.now();
      setRoom(r);
      if (r.startAt) setStage("race");
      return r;
    } catch {
      return null; // network blip — keep polling
    }
  }, [code]);

  // lobby polling
  useEffect(() => {
    if (stage !== "lobby") return;
    refresh();
    const id = setInterval(refresh, 1500);
    return () => clearInterval(id);
  }, [stage, refresh]);

  // warm up the start article while everyone waits in the lobby — race opens instantly
  useEffect(() => {
    if (stage === "lobby" && room?.start) prefetchArticle(room.start);
  }, [stage, room?.start]);

  useEffect(() => {
    if (!room) return;
    setDraftStart(room.start);
    setDraftTarget(room.target);
    setPairDirty(false);
  }, [room?.round, room?.start, room?.target]);

  const join = async () => {
    setBusy(true);
    setBusyLabel("Joining…");
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
      setStage("lobby");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join.");
    } finally {
      setBusy(false);
    }
  };

  const configurePair = async (start: string, target: string): Promise<Room> => {
    if (!room) throw new Error("Room is still loading.");
    const res = await fetch(`/api/room/${code}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "configure",
        playerId,
        round: room.round,
        start,
        target,
      }),
    });
    const next = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(next?.error ?? "Couldn't update the matchup.");
    }
    setRoom(next);
    setDraftStart(next.start);
    setDraftTarget(next.target);
    setPairDirty(false);
    return next as Room;
  };

  const resolveCustomPair = async (): Promise<[string, string]> => {
    if (!draftStart.trim() || !draftTarget.trim()) {
      throw new Error("Fill in both articles.");
    }
    const [start, target] = await Promise.all([
      fetchSummary(draftStart.trim()),
      fetchSummary(draftTarget.trim()),
    ]);
    if (isBlockedTitle(start.title) || isBlockedTitle(target.title)) {
      throw new Error("Use regular Wikipedia articles, not a special namespace.");
    }
    if (normalizeTitle(start.title) === normalizeTitle(target.title)) {
      throw new Error(
        `Both fields resolve to “${start.title}” — choose two different articles.`
      );
    }
    return [start.title, target.title];
  };

  const applyCustomPair = async () => {
    setBusy(true);
    setBusyLabel("Checking custom matchup…");
    setError("");
    setPairStatus("");
    try {
      const [start, target] = await resolveCustomPair();
      await configurePair(start, target);
      setPairStatus("✓ Custom matchup ready for everyone");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update the matchup.");
    } finally {
      setBusy(false);
    }
  };

  const rerollClassic = async () => {
    if (!room) return;
    setBusy(true);
    setBusyLabel("Picking classic matchup…");
    setError("");
    setPairStatus("");
    try {
      const pair = randomFunPairExcept(room.start, room.target);
      await configurePair(pair[0], pair[1]);
      setPairStatus("✓ New classic matchup ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reroll the matchup.");
    } finally {
      setBusy(false);
    }
  };

  const rerollChaos = async () => {
    setBusy(true);
    setBusyLabel("Drawing chaos matchup…");
    setError("");
    setPairStatus("");
    try {
      let pair: [string, string] | null = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        const [start, target] = await Promise.all([
          fetchRandomSummary(),
          fetchRandomSummary(),
        ]);
        if (
          !isBlockedTitle(start.title) &&
          !isBlockedTitle(target.title) &&
          normalizeTitle(start.title) !== normalizeTitle(target.title)
        ) {
          pair = [start.title, target.title];
          break;
        }
      }
      if (!pair) throw new Error("Couldn't draw two usable random articles.");
      await configurePair(pair[0], pair[1]);
      setPairStatus("✓ Chaos matchup ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't draw random articles.");
    } finally {
      setBusy(false);
    }
  };

  const startRace = async () => {
    if (!room) return;
    setBusy(true);
    setBusyLabel("Starting round…");
    setError("");
    setPairStatus("");
    try {
      let activeRoom = room;
      if (pairDirty) {
        const [start, target] = await resolveCustomPair();
        activeRoom = await configurePair(start, target);
      }
      const res = await fetch(`/api/room/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          playerId,
          round: activeRoom.round,
        }),
      });
      const next = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(next?.error ?? "Couldn't start the race.");
      }
      setRoom(next);
      setStage("race");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the race.");
    } finally {
      setBusy(false);
    }
  };

  const handleRoomRoundChange = useCallback((nextRoom: Room) => {
    setRoom(nextRoom);
    setError("");
    setPairStatus(`Round ${nextRoom.round} is ready`);
    setBusy(false);
    // Always unmount the completed RaceClient first. If the host started very
    // quickly, the lobby's immediate poll will mount the new round afterward.
    setStage("lobby");
  }, []);

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyFallback(window.location.href); // clipboard blocked — show the url
    }
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
      round: room.round,
      startAt: room.startAt,
      playerName: me?.name ?? "Racer",
      isHost: room.hostId === playerId,
      clockOffset: clockOffsetRef.current,
    };
    return (
      <RaceClient
        key={`${room.code}:${room.round}`}
        room={props}
        onRoomRoundChange={handleRoomRoundChange}
      />
    );
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
    <main className="min-h-screen speedlines flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="card-dark max-w-2xl w-full p-5 sm:p-8 slide-up my-4">
        <div className="checker h-3 mb-6" />
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
          <h1 className="display text-2xl">
            ROOM <span className="text-(--acid)">{code}</span>
          </h1>
          <span className="mono text-xs uppercase text-(--sky)">
            round {room?.round ?? "…"}
          </span>
        </div>
        {room && (
          <div className="mono text-sm mb-6 flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate" title={room.start}>
              {room.start}
            </span>
            <span className="shrink-0 text-(--coral)">→</span>
            <span className="min-w-0 truncate text-(--acid)" title={room.target}>
              {room.target}
            </span>
          </div>
        )}

        {room && playerId === room.hostId && (
          <section className="border border-(--line) bg-[#0a0a0e] p-4 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="mono text-xs uppercase opacity-60">choose the matchup</h2>
              <span className="mono text-[11px] opacity-50">host controls</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
              <button
                onClick={rerollClassic}
                disabled={busy}
                className="min-h-11 border border-(--line) px-3 py-2.5 mono text-xs uppercase hover:border-(--acid) cursor-pointer disabled:opacity-50"
              >
                ↻ Classic reroll
              </button>
              <button
                onClick={rerollChaos}
                disabled={busy}
                className="min-h-11 border border-(--line) px-3 py-2.5 mono text-xs uppercase hover:border-(--sky) cursor-pointer disabled:opacity-50"
              >
                🎲 Full chaos
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
              <input
                value={draftStart}
                onChange={(event) => {
                  setDraftStart(event.target.value);
                  setPairDirty(true);
                  setPairStatus("");
                  setError("");
                }}
                disabled={busy}
                maxLength={200}
                placeholder="Start article"
                className="min-w-0 bg-[#101014] border border-(--line) px-3 py-2.5 mono text-sm focus:border-(--acid) outline-none disabled:opacity-60"
              />
              <input
                value={draftTarget}
                onChange={(event) => {
                  setDraftTarget(event.target.value);
                  setPairDirty(true);
                  setPairStatus("");
                  setError("");
                }}
                disabled={busy}
                maxLength={200}
                placeholder="Target article"
                className="min-w-0 bg-[#101014] border border-(--line) px-3 py-2.5 mono text-sm focus:border-(--acid) outline-none disabled:opacity-60"
              />
            </div>
            <button
              onClick={applyCustomPair}
              disabled={busy || !pairDirty}
              className="min-h-11 w-full border border-(--line) py-2 mono text-xs uppercase hover:border-(--acid) cursor-pointer disabled:opacity-40"
            >
              ✓ Use custom matchup
            </button>
          </section>
        )}

        <div className="mb-6">
          <h3 className="mono text-xs uppercase opacity-60 mb-2">
            racers ({room?.players.length ?? "…"}/8)
          </h3>
          <div className="space-y-1 min-w-0 overflow-hidden">
            {room?.players.map((p) => (
              <div
                key={p.id}
                className="mono text-sm flex min-w-0 items-center gap-2"
              >
                <span className="shrink-0">🏎️</span>
                <span
                  title={p.name}
                  className={`min-w-0 truncate ${
                    p.id === playerId ? "text-(--acid)" : ""
                  }`}
                >
                  {p.name}
                </span>
                {p.id === room.hostId && (
                  <span className="shrink-0 opacity-50 text-xs">(host)</span>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          {error && (
            <p className="mono text-sm text-(--coral) border border-(--coral) px-3 py-2">
              ⚠️ {error}
            </p>
          )}
          {pairStatus && (
            <p className="mono text-xs text-(--acid) text-center">{pairStatus}</p>
          )}
          <button
            onClick={copyInvite}
            className="min-h-11 w-full border border-(--line) py-2.5 mono text-sm uppercase hover:border-(--acid) cursor-pointer"
          >
            {copied ? "✓ Invite copied" : "📎 Copy invite link"}
          </button>
          {copyFallback && (
            <input
              readOnly
              value={copyFallback}
              onFocus={(e) => e.target.select()}
              className="w-full bg-[#0a0a0e] border border-(--line) px-3 py-2 mono text-xs"
            />
          )}
          {room && playerId === room.hostId ? (
            <button
              onClick={startRace}
              disabled={busy}
              className="btn-race w-full py-3 text-lg uppercase cursor-pointer disabled:opacity-60"
            >
              {busy ? busyLabel : `🚦 Start round ${room.round}`}
            </button>
          ) : (
            <p className="mono text-sm opacity-60 text-center animate-pulse">
              waiting for the host to set up round {room?.round ?? "…"}…
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
