// Owner-only: activates a paid plan (Pro or Business) for a customer after a manual payment
// (for example a bank transfer arranged on WhatsApp).
// The caller must be signed in AND their user id must be listed in the ADMIN_USER_IDS secret.
// The customer is identified by email and looked up on the server; no user id is trusted from the browser.

type Row = Record<string, unknown>;

const ALLOWED_ORIGINS = [
  "https://mouadamraji2020-star.github.io",
];

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;
const PLANS = ["pro", "business"];
const CYCLES = ["monthly", "yearly"];

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

async function findUserIdByEmail(
  supabaseUrl: string,
  serviceKey: string,
  email: string,
): Promise<{ id: string | null; failed: boolean }> {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await fetch(
      supabaseUrl + "/auth/v1/admin/users?page=" + page + "&per_page=" + PAGE_SIZE,
      { headers: serviceHeaders(serviceKey) },
    );
    if (!response.ok) return { id: null, failed: true };
    const body = await response.json();
    const users = body && Array.isArray(body.users) ? body.users as Row[] : [];
    for (const user of users) {
      const candidate = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
      const id = typeof user.id === "string" ? user.id : "";
      if (candidate === email && isUserId(id)) return { id, failed: false };
    }
    if (users.length < PAGE_SIZE) break;
  }
  return { id: null, failed: false };
}

// Adds whole calendar months in UTC, keeping the day (or the last day of a shorter month).
function addMonths(from: Date, months: number): Date {
  const result = new Date(from.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
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
  if (missing.length || !supabaseUrl || !anonKey || !serviceKey) {
    console.error("admin-set-plan not configured:", missing.join(", "));
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

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const plan = typeof payload.plan === "string" ? payload.plan : "";
  const cycle = typeof payload.billing_cycle === "string" ? payload.billing_cycle : "";
  if (!email || email.length > 254 || !email.includes("@")) {
    return json({ error: "Invalid request", reason: "Enter a valid customer email." }, 400, origin);
  }
  if (!PLANS.includes(plan)) {
    return json({ error: "Invalid request", reason: "Plan must be Pro or Business." }, 400, origin);
  }
  if (!CYCLES.includes(cycle)) {
    return json({ error: "Invalid request", reason: "Billing must be monthly or yearly." }, 400, origin);
  }

  const found = await findUserIdByEmail(supabaseUrl, serviceKey, email);
  if (found.failed) {
    return json({ error: "Lookup failed", reason: "Could not look up the customer." }, 500, origin);
  }
  if (!found.id) {
    return json({ error: "Not found", reason: "No account uses that email." }, 404, origin);
  }
  const customerId = found.id;

  const currentResponse = await fetch(
    supabaseUrl + "/rest/v1/profiles?id=eq." + encodeURIComponent(customerId) +
      "&select=plan,subscription_status,current_period_end",
    { headers: serviceHeaders(serviceKey) },
  );
  if (!currentResponse.ok) {
    const text = (await currentResponse.text()).replace(/\s+/g, " ").slice(0, 160);
    console.error("admin-set-plan could not read profile:", currentResponse.status, text);
    return json({ error: "Profile not readable", reason: "Could not read the profile (HTTP " + currentResponse.status + " " + text + ")" }, 500, origin);
  }
  const currentRows = await currentResponse.json();
  const current = Array.isArray(currentRows) && currentRows[0] && typeof currentRows[0] === "object"
    ? currentRows[0] as Row
    : null;
  if (!current) {
    return json({ error: "Not found", reason: "That account has no profile yet." }, 404, origin);
  }

  // Renewing the same active plan before it ends adds time on top of the current end date.
  const now = new Date();
  let start = now;
  const existingEnd = typeof current.current_period_end === "string" ? new Date(current.current_period_end) : null;
  if (
    current.plan === plan && current.subscription_status === "active" &&
    existingEnd && isFinite(existingEnd.getTime()) && existingEnd.getTime() > now.getTime()
  ) {
    start = existingEnd;
  }
  const periodEnd = addMonths(start, cycle === "yearly" ? 12 : 1);

  const update = await fetch(
    supabaseUrl + "/rest/v1/profiles?id=eq." + encodeURIComponent(customerId),
    {
      method: "PATCH",
      headers: { ...serviceHeaders(serviceKey, true), Prefer: "return=representation" },
      body: JSON.stringify({
        plan,
        subscription_status: "active",
        billing_cycle: cycle,
        current_period_end: periodEnd.toISOString(),
        cancel_at_period_end: false,
      }),
    },
  );
  if (!update.ok) {
    const text = (await update.text()).replace(/\s+/g, " ").slice(0, 160);
    console.error("admin-set-plan update failed:", update.status, text);
    return json({ error: "Update failed", reason: "Could not update the plan (HTTP " + update.status + " " + text + ")" }, 500, origin);
  }
  const updated = await update.json();
  if (!Array.isArray(updated) || !updated.length) {
    return json({ error: "Update failed", reason: "No profile was updated." }, 500, origin);
  }

  console.info("admin-set-plan: admin", adminId, "set", plan, cycle, "for", customerId, "until", periodEnd.toISOString());
  return json({
    ok: true,
    email,
    plan,
    billing_cycle: cycle,
    current_period_end: periodEnd.toISOString(),
    extended: start !== now,
  }, 200, origin);
}

Deno.serve(async (request) => {
  try {
    return await handle(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("admin-set-plan unexpected error:", message);
    return json({ error: "Unexpected error", reason: "Unexpected error: " + message.slice(0, 120) }, 500, requestOrigin(request));
  }
});
