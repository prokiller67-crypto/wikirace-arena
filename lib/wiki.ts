// Wikipedia REST API helpers — all client-side, CORS is open (origin: *)

const REST = "https://en.wikipedia.org/api/rest_v1";

export interface WikiSummary {
  title: string; // canonical title
  description?: string;
  extract?: string;
  thumbnail?: string;
}

export function normalizeTitle(t: string): string {
  return t.replace(/_/g, " ").trim().toLowerCase();
}

export function titleToPath(t: string): string {
  return encodeURIComponent(t.replace(/ /g, "_"));
}

// Namespaces that are not part of the race
const BLOCKED_NS =
  /^(File|Category|Help|Special|Portal|Talk|Wikipedia|Template|Draft|Module|MediaWiki|TimedText|Book|User|WP|Media)( talk)?:/i;

export function isBlockedTitle(title: string): boolean {
  return BLOCKED_NS.test(title.replace(/_/g, " "));
}

// Race the Vercel proxy AGAINST direct Wikipedia in parallel — first успешный
// ответ побеждает, второй отменяется. Каждый игрок автоматически получает свой
// самый быстрый маршрут (у кого-то душат wikipedia.org, у кого-то дальше CDN).
async function fetchFastest(urls: string[], accept: string, timeoutMs: number): Promise<Response> {
  const ctrls = urls.map(() => new AbortController());
  const kill = setTimeout(() => ctrls.forEach((c) => c.abort()), timeoutMs);
  try {
    const winner = await Promise.any(
      urls.map(async (url, i) => {
        const res = await fetch(url, { headers: { accept }, signal: ctrls[i].signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return { res, i };
      })
    );
    ctrls.forEach((c, j) => {
      if (j !== winner.i) c.abort();
    });
    return winner.res;
  } catch {
    throw new Error("fetch failed");
  } finally {
    clearTimeout(kill);
  }
}

export async function fetchSummary(title: string): Promise<WikiSummary> {
  const res = await fetchFastest(
    [
      `/api/wiki/summary?title=${encodeURIComponent(title)}`,
      `${REST}/page/summary/${titleToPath(title)}?redirect=true`,
    ],
    "application/json",
    8000
  ).catch(() => {
    throw new Error(`No article found for “${title}”`);
  });
  const j = await res.json();
  if (!j.title) throw new Error(`No article found for “${title}”`);
  return {
    title: j.title as string,
    description: j.description,
    extract: j.extract,
    thumbnail: j.thumbnail?.source,
  };
}

export async function fetchRandomSummary(): Promise<WikiSummary> {
  const res = await fetchFastest(
    [`/api/wiki/random`, `${REST}/page/random/summary`],
    "application/json",
    8000
  ).catch(() => {
    throw new Error("Random article failed");
  });
  const j = await res.json();
  return { title: j.title, description: j.description, thumbnail: j.thumbnail?.source };
}

export interface LoadedArticle {
  canonicalTitle: string;
  html: string; // sanitized body html, links annotated with data-title
}

// LRU-ish cache + in-flight dedupe: hover-prefetch makes most clicks instant.
// Caps are deliberately small — unbounded prefetch was OOM-crashing Chrome tabs
// ("Aw, Snap! error code 5") during long multiplayer races.
const articleCache = new Map<string, LoadedArticle>();
const inFlight = new Map<string, Promise<LoadedArticle>>();
const CACHE_MAX = 12;
const PREFETCH_MAX_PARALLEL = 2;

export async function fetchArticle(title: string): Promise<LoadedArticle> {
  const key = normalizeTitle(title);
  const cached = articleCache.get(key);
  if (cached) return cached;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      const res = await fetchFastest(
        [
          `/api/wiki/html?title=${encodeURIComponent(title)}`,
          `${REST}/page/html/${titleToPath(title)}`,
        ],
        "text/html",
        10000
      ).catch(() => {
        throw new Error(`Couldn't load “${title}”`);
      });
      const raw = await res.text();
      const art = sanitizeArticle(raw);
      if (articleCache.size >= CACHE_MAX) {
        const oldest = articleCache.keys().next().value;
        if (oldest !== undefined) articleCache.delete(oldest);
      }
      articleCache.set(key, art);
      return art;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, p);
  return p;
}

// fire-and-forget warm-up used by hover/mousedown prefetch — hard-capped so
// sweeping the cursor across a link-dense paragraph can't stampede the tab
export function prefetchArticle(title: string): void {
  const key = normalizeTitle(title);
  if (articleCache.has(key) || inFlight.has(key)) return;
  if (inFlight.size >= PREFETCH_MAX_PARALLEL) return;
  fetchArticle(title).catch(() => {});
}

function sanitizeArticle(raw: string): LoadedArticle {
  const doc = new DOMParser().parseFromString(raw, "text/html");
  const canonicalTitle = doc.title || "";

  // remove anything executable or irrelevant
  doc
    .querySelectorAll(
      "script, style, link, meta, base, .mw-editsection, .noprint, .mw-empty-elt, [typeof='mw:Extension/ref'] ~ style, .navbox, .vertical-navbox, .sistersitebox, .metadata.plainlinks, table.ambox, .mw-authority-control"
    )
    .forEach((el) => el.remove());

  // strip all inline event handlers just in case
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith("on")) el.removeAttribute(attr.name);
    }
  });

  // imagemap <area> hrefs bypass our <a> interception and hard-navigate the
  // browser to a 404 — strip them
  doc.querySelectorAll("area").forEach((el) => el.removeAttribute("href"));

  // annotate links
  doc.querySelectorAll("a").forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    a.removeAttribute("target");
    // only relative ./Title links are playable; interwiki (mw:WikiLink/Interwiki),
    // external and citation urls are inert
    if (!href.startsWith("./")) {
      a.removeAttribute("href");
      a.classList.add("wl-inert");
      return;
    }
    let t = href.replace(/^\.\//, "");
    const hashIdx = t.indexOf("#");
    if (hashIdx >= 0) t = t.slice(0, hashIdx);
    t = decodeURIComponent(t).replace(/_/g, " ");
    const isNew = a.classList.contains("new"); // red link, article doesn't exist
    // footnote [1] links and reference backlinks point at the CURRENT article —
    // clicking them must not count as a hop
    const isSelf =
      normalizeTitle(t) === normalizeTitle(canonicalTitle) || href.includes("#cite_");
    if (!t || isNew || isSelf || isBlockedTitle(t)) {
      a.removeAttribute("href");
      a.classList.add("wl-inert");
      return;
    }
    a.setAttribute("data-wl-title", t);
    a.setAttribute("href", `#${titleToPath(t)}`);
    a.classList.add("wl-link");
  });

  // protocol-relative images work fine; lazy-load them
  doc.querySelectorAll("img").forEach((img) => img.setAttribute("loading", "lazy"));

  return { canonicalTitle, html: doc.body.innerHTML };
}

// Curated fun start→target pairs (start, target)
export const FUN_PAIRS: [string, string][] = [
  ["Pizza", "Black hole"],
  ["Minecraft", "Ancient Rome"],
  ["Cheese", "Napoleon"],
  ["Basketball", "William Shakespeare"],
  ["TikTok", "Dinosaur"],
  ["Homework", "Volcano"],
  ["Ketchup", "Moon landing"],
  ["Skateboarding", "Albert Einstein"],
  ["Ice cream", "World War II"],
  ["Spider-Man", "Photosynthesis"],
  ["Coffee", "Great Wall of China"],
  ["Chess", "Hurricane"],
  ["Banana", "Eiffel Tower"],
  ["Video game", "Leonardo da Vinci"],
  ["High school", "Mount Everest"],
  ["Smartphone", "Julius Caesar"],
  ["Soccer", "DNA"],
  ["Candy", "Titanic"],
  ["Guitar", "Saturn"],
  ["Meme", "French Revolution"],
];

export function randomFunPair(): [string, string] {
  return FUN_PAIRS[Math.floor(Math.random() * FUN_PAIRS.length)];
}
