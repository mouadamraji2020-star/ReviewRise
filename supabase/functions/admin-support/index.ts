// Owner-only: lists support messages, marks them as done / new again, and deletes them.
// The caller must be signed in AND their user id must be listed in the ADMIN_USER_IDS secret,
// AND the request must carry the owner's ADMIN_PASSCODE (checked on the server every time).
// Required secrets: ADMIN_USER_IDS, ADMIN_PASSCODE (the same ones admin-stats uses).

type Row = Record<string, unknown>;

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
    "Cache-Control": "no-store",
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

function serviceHeaders(serviceKey: string, jsonBody = false): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: serviceKey,
    Authorization: "Bearer " + serviceKey,
    Accept: "application/json",
  };
  if (jsonBody) headers["Content-Type"] = "application/json";
  return headers;
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
    headers: { apikey: anonKey, Authorization: "Bearer " + token },
  });
  if (!response.ok) return null;
  const body = await response.json();
  const id = body && typeof body.id === "string" ? body.id : "";
  return isUserId(id) ? id : null;
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

// Compares two passcodes without leaking how many leading characters matched.
async function passcodeMatches(given: string, expected: string): Promise<boolean> {
  const a = await sha256(given);
  const b = await sha256(expected);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function handle(request: Request): Promise<Response> {
  const origin = requestOrigin(request);

  if (request.method === "OPTIONS") return json({}, 204, origin);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const adminIds = (Deno.env.get("ADMIN_USER_IDS") || "")
    .split(",").map((id) => id.trim().toLowerCase()).filter(isUserId);
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!anonKey) missing.push("SUPABASE_ANON_KEY");
  if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!adminIds.length) missing.push("ADMIN_USER_IDS (missing or not a valid user id)");
  const passcode = Deno.env.get("ADMIN_PASSCODE") || "";
  if (passcode.length < 10) missing.push("ADMIN_PASSCODE (at least 10 characters)");
  if (missing.length || !supabaseUrl || !anonKey || !serviceKey) {
    console.error("admin-support not configured:", missing.join(", "));
    return json({ error: "Not configured", reason: "Missing: " + missing.join(", ") }, 500, origin);
  }

  const adminId = await authenticatedUserId(supabaseUrl, anonKey, serviceKey, request);
  if (!adminId) return json({ error: "Unauthorized" }, 401, origin);
  if (!adminIds.includes(adminId.toLowerCase())) return json({ error: "Forbidden" }, 403, origin);

  let payload: Row;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid request", reason: "The request was not valid JSON." }, 400, origin);
  }

  const given = typeof payload.passcode === "string" ? payload.passcode.slice(0, 200) : "";
  if (!given) return json({ error: "Passcode required", reason: "passcode_required" }, 403, origin);
  if (!(await passcodeMatches(given, passcode))) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.warn("admin-support: wrong passcode for admin", adminId);
    return json({ error: "Incorrect passcode", reason: "passcode_invalid" }, 403, origin);
  }

  const action = typeof payload.action === "string" ? payload.action : "list";

  if (action === "delete") {
    const id = Number(payload.id);
    if (!Number.isInteger(id) || id < 1) {
      return json({ error: "Invalid request", reason: "Invalid message id." }, 400, origin);
    }
    const removal = await fetch(
      supabaseUrl + "/rest/v1/support_messages?id=eq." + id,
      { method: "DELETE", headers: { ...serviceHeaders(serviceKey), Prefer: "return=minimal" } },
    );
    if (!removal.ok) {
      const text = (await removal.text()).replace(/\s+/g, " ").slice(0, 160);
      console.error("admin-support delete failed:", removal.status, text);
      return json({ error: "Delete failed", reason: "Could not delete the message (HTTP " + removal.status + ")" }, 500, origin);
    }
    console.info("admin-support: admin", adminId, "deleted message", id);
    return json({ ok: true, id }, 200, origin);
  }

  if (action === "mark") {
    const id = Number(payload.id);
    const status = payload.status === "new" ? "new" : "done";
    if (!Number.isInteger(id) || id < 1) {
      return json({ error: "Invalid request", reason: "Invalid message id." }, 400, origin);
    }
    const update = await fetch(
      supabaseUrl + "/rest/v1/support_messages?id=eq." + id,
      {
        method: "PATCH",
        headers: { ...serviceHeaders(serviceKey, true), Prefer: "return=minimal" },
        body: JSON.stringify({ status }),
      },
    );
    if (!update.ok) {
      const text = (await update.text()).replace(/\s+/g, " ").slice(0, 160);
      console.error("admin-support update failed:", update.status, text);
      return json({ error: "Update failed", reason: "Could not update the message (HTTP " + update.status + ")" }, 500, origin);
    }
    return json({ ok: true, id, status }, 200, origin);
  }

  const response = await fetch(
    supabaseUrl +
      "/rest/v1/support_messages?select=id,created_at,name,email,subject,message,category,source,page,status" +
      "&order=created_at.desc&limit=200",
    { headers: serviceHeaders(serviceKey) },
  );
  if (!response.ok) {
    const text = (await response.text()).replace(/\s+/g, " ").slice(0, 160);
    console.error("admin-support could not read messages:", response.status, text);
    return json({
      error: "Messages could not be loaded",
      reason: "Could not read support_messages (HTTP " + response.status + "). Has the support-messages SQL been run?",
    }, 500, origin);
  }
  const rows = await response.json();
  const messages = Array.isArray(rows) ? rows : [];
  const newCount = messages.filter((m) => (m as Row).status === "new").length;
  return json({ messages, new_count: newCount }, 200, origin);
}

Deno.serve(async (request) => {
  try {
    return await handle(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("admin-support unexpected error:", message);
    return json({ error: "Unexpected error", reason: "Unexpected error: " + message.slice(0, 120) }, 500, requestOrigin(request));
  }
});
