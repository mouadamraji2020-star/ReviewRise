const ALLOWED_ORIGINS = [
  "https://mouadamraji2020-star.github.io",
];

function requestOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return null;
  return origin;
}

function json(body: unknown, status: number, origin: string | null): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Vary": "Origin",
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  if (status === 204) return new Response(null, { status, headers });
  return new Response(JSON.stringify(body), { status, headers });
}

function isUserId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function authenticatedUserId(
  supabaseUrl: string,
  anonKey: string,
  serviceKey: string,
  request: Request,
): Promise<string | null> {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match) return null;
  const token = match[1];
  if (!token || token === serviceKey) return null;

  const response = await fetch(supabaseUrl + "/auth/v1/user", {
    headers: {
      apikey: anonKey,
      Authorization: "Bearer " + token,
    },
  });
  if (!response.ok) return null;

  const body = await response.json();
  const id = body && typeof body.id === "string" ? body.id : "";
  return isUserId(id) ? id : null;
}

function serviceHeaders(serviceKey: string, jsonBody = false): HeadersInit {
  const headers: Record<string, string> = {
    apikey: serviceKey,
    Authorization: "Bearer " + serviceKey,
    Accept: "application/json",
  };
  if (jsonBody) headers["Content-Type"] = "application/json";
  return headers;
}

async function restResult(
  response: Response,
): Promise<"ok" | "missing" | "error"> {
  if (response.ok) return "ok";
  const text = await response.text();
  if (response.status === 404 || text.includes("PGRST205") || text.includes("does not exist")) {
    return "missing";
  }
  return "error";
}

async function removeRows(
  supabaseUrl: string,
  serviceKey: string,
  path: string,
): Promise<"ok" | "missing" | "error"> {
  const response = await fetch(supabaseUrl + path, {
    method: "DELETE",
    headers: {
      ...serviceHeaders(serviceKey) as Record<string, string>,
      Prefer: "return=minimal",
    },
  });
  return restResult(response);
}

function inList(ids: string[]): string {
  return ids.map((id) => /^[0-9]+$/.test(id) ? id : '"' + id + '"').join(",");
}

async function ownedReviewLinkIds(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
): Promise<string[] | null> {
  const response = await fetch(
    supabaseUrl + "/rest/v1/Reviewlinks?user_id=eq." + encodeURIComponent(userId) + "&select=id",
    { headers: serviceHeaders(serviceKey) },
  );
  if (!response.ok) return null;
  const rows = await response.json();
  if (!Array.isArray(rows)) return null;
  return rows.map((row) => {
    const id = row && (typeof row.id === "number" || typeof row.id === "string") ? String(row.id) : "";
    return /^[0-9]+$/.test(id) || isUserId(id) ? id : "";
  }).filter(Boolean);
}

async function removeOwnedLogos(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
): Promise<"ok" | "missing" | "error"> {
  const listed = await fetch(supabaseUrl + "/storage/v1/object/list/business-logos", {
    method: "POST",
    headers: serviceHeaders(serviceKey, true),
    body: JSON.stringify({ prefix: "", search: userId, limit: 1000 }),
  });
  if (!listed.ok) return "ok";

  let rows: unknown;
  try {
    rows = await listed.json();
  } catch {
    return "ok";
  }
  if (!Array.isArray(rows) || !rows.length) return "ok";

  const prefixes = rows.map((row) => {
    const name = row && typeof row.name === "string" ? row.name : "";
    return name.startsWith(userId + "-") ? name : "";
  }).filter(Boolean);

  if (!prefixes.length) return "ok";

  const removed = await fetch(supabaseUrl + "/storage/v1/object/business-logos", {
    method: "DELETE",
    headers: serviceHeaders(serviceKey, true),
    body: JSON.stringify({ prefixes }),
  });
  return removed.ok ? "ok" : "error";
}

Deno.serve(async (request) => {
  const origin = requestOrigin(request);

  if (request.method === "OPTIONS") {
    return json({}, 204, origin);
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: "Account deletion is not configured" }, 500, origin);
  }

  const userId = await authenticatedUserId(supabaseUrl, anonKey, serviceKey, request);
  if (!userId) {
    return json({ error: "Unauthorized" }, 401, origin);
  }

  const linkIds = await ownedReviewLinkIds(supabaseUrl, serviceKey, userId);
  if (!linkIds) {
    return json({ error: "Account could not be deleted" }, 500, origin);
  }

  if (linkIds.length) {
    const feedback = await removeRows(
      supabaseUrl,
      serviceKey,
      "/rest/v1/Feedback?review_link_id=in.(" + inList(linkIds) + ")",
    );
    if (feedback === "error") {
      return json({ error: "Account could not be deleted" }, 500, origin);
    }
  }

  const links = await removeRows(
    supabaseUrl,
    serviceKey,
    "/rest/v1/Reviewlinks?user_id=eq." + encodeURIComponent(userId),
  );
  if (links === "error") {
    return json({ error: "Account could not be deleted" }, 500, origin);
  }

  const payments = await removeRows(
    supabaseUrl,
    serviceKey,
    "/rest/v1/payment_events?user_id=eq." + encodeURIComponent(userId),
  );
  if (payments === "error") {
    return json({ error: "Account could not be deleted" }, 500, origin);
  }

  await removeOwnedLogos(supabaseUrl, serviceKey, userId);

  const profile = await removeRows(
    supabaseUrl,
    serviceKey,
    "/rest/v1/profiles?id=eq." + encodeURIComponent(userId),
  );
  if (profile === "error") {
    return json({ error: "Account could not be deleted" }, 500, origin);
  }

  const deleted = await fetch(supabaseUrl + "/auth/v1/admin/users/" + userId, {
    method: "DELETE",
    headers: serviceHeaders(serviceKey),
  });

  if (!deleted.ok) {
    return json({ error: "Account could not be deleted" }, 500, origin);
  }

  return json({ deleted: true }, 200, origin);
});
