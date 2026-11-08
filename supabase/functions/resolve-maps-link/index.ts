// Public helper for the Free Google Review Link Generator.
// Google's "Share" button gives a short link (maps.app.goo.gl/...). The browser cannot follow it
// (Google blocks that), so this function follows it on the server and returns the business's Google
// "feature id" (looks like 0x1234abcd:0x5678ef01). The web page turns that into the review link.
//
// Safety: only Google hosts are ever contacted, at most 6 redirects are followed, nothing is stored,
// and each network address is limited to 30 requests per 10 minutes.
// No secrets are needed. Turn "Verify JWT" OFF for this function (visitors are not signed in).

const ALLOWED_ORIGINS = [
  "https://mouadamraji2020-star.github.io",
];

const ALLOWED_HOSTS = [
  "maps.app.goo.gl",
  "goo.gl",
  "g.co",
  "maps.google.com",
  "google.com",
  "www.google.com",
  "consent.google.com",
];

const FID = /0x[0-9a-f]{1,16}:0x[0-9a-f]{1,16}/i;
const MAX_HOPS = 6;
const LIMIT = 30;
const WINDOW_MS = 10 * 60 * 1000;
const hits = new Map<string, number[]>();

function requestOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return null;
  return origin;
}

function json(body: unknown, status: number, origin: string | null): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Vary": "Origin",
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  if (status === 204) return new Response(null, { status, headers });
  return new Response(JSON.stringify(body), { status, headers });
}

function hostAllowed(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_HOSTS.includes(host) || /^maps\.google\.[a-z.]{2,6}$/.test(host) || /^www\.google\.[a-z.]{2,6}$/.test(host);
}

function findFid(text: string): string | null {
  let current = text;
  for (let i = 0; i < 3; i++) {
    const match = current.match(FID);
    if (match) return match[0].toLowerCase();
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return null;
}

function limited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= LIMIT) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

export async function resolveFid(start: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(start);
  } catch {
    return null;
  }
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (!hostAllowed(url)) return null;
    const direct = findFid(url.href);
    if (direct) return direct;
    const response = await fetcher(url.href, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "en",
      },
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      try {
        url = new URL(location, url);
      } catch {
        return null;
      }
      continue;
    }
    return null;
  }
  return null;
}

Deno.serve(async (request) => {
  const origin = requestOrigin(request);
  if (request.method === "OPTIONS") return json({}, 204, origin);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

  const forwarded = request.headers.get("x-forwarded-for") || "";
  const ip = forwarded.split(",").pop()?.trim() || "unknown";
  if (limited(ip)) return json({ error: "Too many requests", reason: "rate_limited" }, 429, origin);

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid request" }, 400, origin);
  }
  const raw = typeof payload.url === "string" ? payload.url.trim().slice(0, 600) : "";
  if (!raw) return json({ error: "Invalid request", reason: "missing_url" }, 400, origin);

  try {
    const fid = await resolveFid(raw);
    if (!fid) return json({ error: "Not found", reason: "no_place" }, 404, origin);
    return json({ fid }, 200, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("resolve-maps-link failed:", message.slice(0, 120));
    return json({ error: "Could not follow the link", reason: "fetch_failed" }, 502, origin);
  }
});
