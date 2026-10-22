type Row = Record<string, unknown>;

const SUBSCRIPTION_FIELDS = [
  "plan",
  "subscription_status",
  "trial_started_at",
  "trial_ends_at",
  "billing_cycle",
  "current_period_end",
  "payment_provider",
  "cancel_at_period_end",
];

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
  return new Response(JSON.stringify(body), { status, headers });
}

function isUserId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isSecretKey(key: string): boolean {
  const name = key.toLowerCase();
  return name.includes("password") ||
    name.includes("access_token") ||
    name.includes("refresh_token") ||
    name.includes("service_role") ||
    name.includes("secret") ||
    name.includes("cvv") ||
    name.includes("card_number") ||
    name === "token" ||
    name === "pan";
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  const copy: Row = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSecretKey(key)) continue;
    copy[key] = sanitize(item);
  }
  return copy;
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

async function selectRows(
  supabaseUrl: string,
  serviceKey: string,
  path: string,
): Promise<{ rows: unknown[] | null; missing: boolean }> {
  const response = await fetch(supabaseUrl + path, {
    headers: {
      apikey: serviceKey,
      Authorization: "Bearer " + serviceKey,
      Accept: "application/json",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 404 || text.includes("PGRST205") || text.includes("does not exist")) {
      return { rows: [], missing: true };
    }
    return { rows: null, missing: false };
  }
  try {
    const parsed = JSON.parse(text);
    return { rows: Array.isArray(parsed) ? parsed : [], missing: false };
  } catch {
    return { rows: null, missing: false };
  }
}

function safeIds(rows: unknown[]): string[] {
  return rows.map((row) => {
    if (!row || typeof row !== "object") return "";
    const id = (row as Row).id;
    const text = typeof id === "number" ? String(id) : typeof id === "string" ? id : "";
    return /^[0-9]+$/.test(text) || isUserId(text) ? text : "";
  }).filter(Boolean);
}

function inList(ids: string[]): string {
  return ids.map((id) => /^[0-9]+$/.test(id) ? id : '"' + id + '"').join(",");
}

function subscriptionFrom(profile: Row | null): Row {
  const subscription: Row = {};
  if (!profile) return subscription;
  SUBSCRIPTION_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(profile, field)) {
      subscription[field] = profile[field];
    }
  });
  return subscription;
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
    return json({ error: "Export service is not configured" }, 500, origin);
  }

  const userId = await authenticatedUserId(supabaseUrl, anonKey, serviceKey, request);
  if (!userId) {
    return json({ error: "Unauthorized" }, 401, origin);
  }

  const profileResult = await selectRows(
    supabaseUrl,
    serviceKey,
    "/rest/v1/profiles?id=eq." + encodeURIComponent(userId) + "&select=*",
  );
  const businessResult = await selectRows(
    supabaseUrl,
    serviceKey,
    "/rest/v1/Reviewlinks?user_id=eq." + encodeURIComponent(userId) + "&select=*",
  );

  if (!profileResult.rows || profileResult.missing || !businessResult.rows) {
    return json({ error: "Account data could not be exported" }, 500, origin);
  }

  const linkIds = safeIds(businessResult.rows);
  let feedbackRows: unknown[] = [];
  if (linkIds.length) {
    const feedbackResult = await selectRows(
      supabaseUrl,
      serviceKey,
      "/rest/v1/Feedback?review_link_id=in.(" + inList(linkIds) + ")&select=*",
    );
    if (!feedbackResult.rows) {
      return json({ error: "Account data could not be exported" }, 500, origin);
    }
    feedbackRows = feedbackResult.rows;
  }

  const paymentResult = await selectRows(
    supabaseUrl,
    serviceKey,
    "/rest/v1/payment_events?user_id=eq." + encodeURIComponent(userId) + "&select=*",
  );
  if (!paymentResult.rows) {
    return json({ error: "Account data could not be exported" }, 500, origin);
  }

  const profile = profileResult.rows[0] && typeof profileResult.rows[0] === "object"
    ? sanitize(profileResult.rows[0]) as Row
    : null;

  return json({
    exported_at: new Date().toISOString(),
    profile,
    businesses: sanitize(businessResult.rows),
    feedback: sanitize(feedbackRows),
    subscription: subscriptionFrom(profile),
    payment_events: sanitize(paymentResult.missing ? [] : paymentResult.rows),
  }, 200, origin);
});
