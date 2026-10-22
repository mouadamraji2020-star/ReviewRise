// Sends the business owner an email when a customer leaves private (1-3 star) feedback.
// Called by a Supabase Database Webhook on INSERT into public."Feedback".
// Required secrets: WEBHOOK_SECRET, RESEND_API_KEY. Optional: ALERT_FROM_EMAIL.

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function serviceHeaders(serviceKey: string): Record<string, string> {
  return {
    apikey: serviceKey,
    Authorization: "Bearer " + serviceKey,
    Accept: "application/json",
  };
}

async function selectOne(
  supabaseUrl: string,
  serviceKey: string,
  path: string,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(supabaseUrl + path, { headers: serviceHeaders(serviceKey) });
  if (!response.ok) return null;
  const rows = await response.json();
  return Array.isArray(rows) && rows[0] && typeof rows[0] === "object" ? rows[0] : null;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const webhookSecret = Deno.env.get("WEBHOOK_SECRET");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("ALERT_FROM_EMAIL") || "ReviewRise <onboarding@resend.dev>";
  if (!supabaseUrl || !serviceKey || !webhookSecret || !resendKey) {
    return json({ error: "Notifications are not configured" }, 500);
  }

  const provided = request.headers.get("x-webhook-secret") || "";
  if (!sameSecret(provided, webhookSecret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const record = payload && typeof payload.record === "object" && payload.record
    ? payload.record as Record<string, unknown>
    : null;
  if (payload.type !== "INSERT" || !record) {
    return json({ skipped: "not an insert" }, 200);
  }

  const rating = Number(record.rating);
  const comment = typeof record.feedback === "string" ? record.feedback.trim() : "";
  if (!(rating >= 1 && rating <= 3) || comment === "") {
    return json({ skipped: "not private feedback" }, 200);
  }

  let ownerId: string | null = isUuid(record.user_id) ? record.user_id : null;
  let businessName = typeof record.business === "string" ? record.business : "";

  if (!ownerId && record.review_link_id != null) {
    const link = await selectOne(
      supabaseUrl,
      serviceKey,
      "/rest/v1/Reviewlinks?id=eq." + encodeURIComponent(String(record.review_link_id)) +
        "&select=user_id,business_name",
    );
    if (link && isUuid(link.user_id)) ownerId = link.user_id;
    if (link && !businessName && typeof link.business_name === "string") {
      businessName = link.business_name;
    }
  }
  if (!ownerId) {
    return json({ skipped: "owner not found" }, 200);
  }

  const profile = await selectOne(
    supabaseUrl,
    serviceKey,
    "/rest/v1/profiles?id=eq." + encodeURIComponent(ownerId) + "&select=email_on_private_feedback",
  );
  if (!profile || profile.email_on_private_feedback !== true) {
    return json({ skipped: "notifications off" }, 200);
  }

  const userResponse = await fetch(supabaseUrl + "/auth/v1/admin/users/" + ownerId, {
    headers: serviceHeaders(serviceKey),
  });
  if (!userResponse.ok) {
    return json({ error: "Owner lookup failed" }, 500);
  }
  const user = await userResponse.json();
  const ownerEmail = user && typeof user.email === "string" ? user.email : "";
  if (!ownerEmail) {
    return json({ skipped: "owner has no email" }, 200);
  }

  const safeBusiness = escapeHtml(businessName || "your business");
  const safeComment = escapeHtml(comment).replace(/\n/g, "<br>");
  const stars = "★".repeat(rating) + "☆".repeat(5 - rating);

  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + resendKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [ownerEmail],
      subject: "New private feedback for " + (businessName || "your business") + " (" + rating + "/5)",
      html:
        '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">' +
        '<h2 style="margin:0 0 8px">New private feedback</h2>' +
        '<p style="margin:0 0 16px;color:#475569">A customer of <strong>' + safeBusiness +
        "</strong> left a " + rating + "-star rating and a private message.</p>" +
        '<p style="font-size:22px;margin:0 0 12px;color:#f59e0b">' + stars + "</p>" +
        '<blockquote style="margin:0 0 20px;padding:14px 16px;background:#f1f5f9;border-radius:10px">' +
        safeComment + "</blockquote>" +
        "<p>Reply to this customer's concern quickly, before it turns into a public review.</p>" +
        '<p style="color:#94a3b8;font-size:12px">You receive this because email alerts are on in your ReviewRise Settings.</p>' +
        "</div>",
    }),
  });

  if (!sent.ok) {
    return json({ error: "Email could not be sent" }, 502);
  }
  return json({ sent: true }, 200);
});
