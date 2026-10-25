// Owner-only statistics for the ReviewRise admin page.
// Caller must be signed in AND their user id must be listed in the ADMIN_USER_IDS secret
// (comma-separated). Returns counts and a user list; never returns feedback text or payment details.

type Row = Record<string, unknown>;

const ALLOWED_ORIGINS = [
  "https://mouadamraji2020-star.github.io",
];

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

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

function serviceHeaders(serviceKey: string): Record<string, string> {
  return {
    apikey: serviceKey,
    Authorization: "Bearer " + serviceKey,
    Accept: "application/json",
  };
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

async function listAuthUsers(supabaseUrl: string, serviceKey: string): Promise<Row[] | null> {
  const users: Row[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await fetch(
      supabaseUrl + "/auth/v1/admin/users?page=" + page + "&per_page=" + PAGE_SIZE,
      { headers: serviceHeaders(serviceKey) },
    );
    if (!response.ok) return null;
    const body = await response.json();
    const batch = body && Array.isArray(body.users) ? body.users as Row[] : [];
    users.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return users;
}

async function fetchAllRows(
  supabaseUrl: string,
  serviceKey: string,
  path: string,
): Promise<{ rows: Row[]; missing: boolean } | null> {
  const rows: Row[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const response = await fetch(supabaseUrl + path, {
      headers: {
        ...serviceHeaders(serviceKey),
        Range: from + "-" + (from + PAGE_SIZE - 1),
        "Range-Unit": "items",
      },
    });
    if (!response.ok) {
      const text = await response.text();
      if (response.status === 404 || text.includes("PGRST205") || text.includes("does not exist")) {
        return { rows: [], missing: true };
      }
      return null;
    }
    const batch = await response.json();
    if (!Array.isArray(batch)) return null;
    rows.push(...batch as Row[]);
    if (batch.length < PAGE_SIZE) break;
  }
  return { rows, missing: false };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function time(value: unknown): number | null {
  const parsed = Date.parse(str(value));
  return isFinite(parsed) ? parsed : null;
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function countBy(rows: Row[], field: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = str(row[field]);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function lastDays(days: number, now: number): string[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) keys.push(dayKey(now - i * DAY_MS));
  return keys;
}

Deno.serve(async (request) => {
  const origin = requestOrigin(request);

  if (request.method === "OPTIONS") return json({}, 204, origin);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const adminIds = (Deno.env.get("ADMIN_USER_IDS") || "")
    .split(",").map((id) => id.trim().toLowerCase()).filter(isUserId);
  if (!supabaseUrl || !anonKey || !serviceKey || !adminIds.length) {
    return json({ error: "Admin statistics are not configured" }, 500, origin);
  }

  const userId = await authenticatedUserId(supabaseUrl, anonKey, serviceKey, request);
  if (!userId) return json({ error: "Unauthorized" }, 401, origin);
  if (!adminIds.includes(userId.toLowerCase())) return json({ error: "Forbidden" }, 403, origin);

  const [authUsers, profiles, businesses, feedback, payments] = await Promise.all([
    listAuthUsers(supabaseUrl, serviceKey),
    fetchAllRows(supabaseUrl, serviceKey,
      "/rest/v1/profiles?select=id,full_name,plan,subscription_status,trial_ends_at,onboarding_completed&order=id"),
    fetchAllRows(supabaseUrl, serviceKey, "/rest/v1/Reviewlinks?select=id,user_id&order=id"),
    fetchAllRows(supabaseUrl, serviceKey, "/rest/v1/Feedback?select=id,user_id,rating,created_at&order=id"),
    fetchAllRows(supabaseUrl, serviceKey, "/rest/v1/payment_events?select=id&order=id"),
  ]);

  if (!authUsers || !profiles || !businesses || !feedback || !payments) {
    return json({ error: "Statistics could not be loaded" }, 500, origin);
  }

  const now = Date.now();
  const profileById = new Map<string, Row>();
  for (const profile of profiles.rows) profileById.set(str(profile.id), profile);
  const businessCounts = countBy(businesses.rows, "user_id");
  const feedbackCounts = countBy(feedback.rows, "user_id");

  const totals = {
    users: authUsers.length,
    confirmed_users: 0,
    new_7d: 0,
    new_30d: 0,
    active_7d: 0,
    onboarded: 0,
    with_business: 0,
    with_feedback: 0,
    trial_active: 0,
    trial_expired: 0,
    pro: 0,
    business: 0,
    businesses: businesses.rows.length,
    feedback: feedback.rows.length,
    feedback_low: feedback.rows.filter((row) => Number(row.rating) <= 3).length,
    feedback_7d: feedback.rows.filter((row) => (time(row.created_at) || 0) >= now - 7 * DAY_MS).length,
    payment_events: payments.missing ? 0 : payments.rows.length,
  };

  const signupDays = new Map<string, number>();
  for (const key of lastDays(30, now)) signupDays.set(key, 0);

  const users = authUsers.map((user) => {
    const id = str(user.id);
    const profile = profileById.get(id) || {};
    const created = time(user.created_at);
    const lastSignIn = time(user.last_sign_in_at);
    const plan = str(profile.plan);
    const status = str(profile.subscription_status);
    const trialEnds = time(profile.trial_ends_at);
    const businessCount = businessCounts.get(id) || 0;
    const feedbackCount = feedbackCounts.get(id) || 0;

    if (user.email_confirmed_at) totals.confirmed_users++;
    if (created !== null && created >= now - 7 * DAY_MS) totals.new_7d++;
    if (created !== null && created >= now - 30 * DAY_MS) totals.new_30d++;
    if (lastSignIn !== null && lastSignIn >= now - 7 * DAY_MS) totals.active_7d++;
    if (profile.onboarding_completed === true) totals.onboarded++;
    if (businessCount > 0) totals.with_business++;
    if (feedbackCount > 0) totals.with_feedback++;
    if (plan === "trial") {
      if (trialEnds !== null && trialEnds <= now) totals.trial_expired++;
      else totals.trial_active++;
    } else if (plan === "pro" && status === "active") totals.pro++;
    else if (plan === "business" && status === "active") totals.business++;

    if (created !== null) {
      const key = dayKey(created);
      if (signupDays.has(key)) signupDays.set(key, (signupDays.get(key) || 0) + 1);
    }

    return {
      email: str(user.email),
      full_name: str(profile.full_name),
      created_at: str(user.created_at),
      last_sign_in_at: str(user.last_sign_in_at),
      plan,
      status,
      trial_ends_at: str(profile.trial_ends_at),
      onboarding_completed: profile.onboarding_completed === true,
      businesses: businessCount,
      feedback: feedbackCount,
    };
  }).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  return json({
    generated_at: new Date(now).toISOString(),
    totals,
    signups_by_day: Array.from(signupDays, ([date, count]) => ({ date, count })),
    users,
  }, 200, origin);
});
