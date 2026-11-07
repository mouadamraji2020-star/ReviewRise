// Emails the owner when a new support message arrives (Help Center form or Settings > Report a Problem).
// Called by a Supabase Database Webhook on INSERT into public.support_messages.
// Required secrets: WEBHOOK_SECRET, RESEND_API_KEY, ALERT_TO_EMAIL.
// Optional secret: ALERT_FROM_EMAIL (default "ReviewRise <onboarding@resend.dev>", which Resend lets you
// use for testing, and which can only deliver to the email address of your own Resend account).
// The email's Reply-To is the customer's address, so pressing "Reply" in your mailbox answers the customer.

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const webhookSecret = Deno.env.get("WEBHOOK_SECRET");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const toEmail = Deno.env.get("ALERT_TO_EMAIL");
  const fromEmail = Deno.env.get("ALERT_FROM_EMAIL") || "ReviewRise <onboarding@resend.dev>";
  if (!webhookSecret || !resendKey || !toEmail) {
    return json({ error: "Alerts are not configured" }, 500);
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

  const name = text(record.name, 120) || "(no name)";
  const email = text(record.email, 160);
  const subject = text(record.subject, 160) || "(no subject)";
  const message = text(record.message, 4000);
  const category = text(record.category, 60);
  const source = record.source === "settings" ? "Settings (Report a Problem)" : "Help Center form";

  const safeMessage = escapeHtml(message).replace(/\n/g, "<br>");
  const details = [
    "From: " + escapeHtml(name) + (email ? " &lt;" + escapeHtml(email) + "&gt;" : ""),
    "Sent from: " + escapeHtml(source),
  ];
  if (category) details.push("Category: " + escapeHtml(category));

  const body: Record<string, unknown> = {
    from: fromEmail,
    to: [toEmail],
    subject: "New support message: " + subject,
    html:
      '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">' +
      '<h2 style="margin:0 0 8px">New support message</h2>' +
      '<p style="margin:0 0 14px;color:#475569;line-height:1.6">' + details.join("<br>") + "</p>" +
      '<p style="margin:0 0 6px;font-weight:700">' + escapeHtml(subject) + "</p>" +
      '<blockquote style="margin:0 0 18px;padding:14px 16px;background:#f1f5f9;border-radius:10px;line-height:1.6">' +
      safeMessage + "</blockquote>" +
      '<p style="color:#475569">Press <strong>Reply</strong> to answer the customer directly. ' +
      "You can also mark the message as done in your ReviewRise Admin page.</p>" +
      "</div>",
  };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) body.reply_to = email;

  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + resendKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!sent.ok) {
    const detail = (await sent.text()).replace(/\s+/g, " ").slice(0, 200);
    console.error("notify-support-message: email failed", sent.status, detail);
    return json({ error: "Email could not be sent" }, 502);
  }
  return json({ sent: true }, 200);
});
