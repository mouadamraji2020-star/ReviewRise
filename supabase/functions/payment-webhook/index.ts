type PaymentEvent = {
  provider: "cih" | "lana_cash";
  plan: "pro" | "business";
  billing_cycle: "monthly" | "yearly";
  status: "active" | "canceled" | "expired";
};

function json(body: Record<string, string>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatePaymentEvent(value: unknown): PaymentEvent | null {
  if (!isRecord(value)) return null;

  const provider = value.provider;
  const plan = value.plan;
  const billingCycle = value.billing_cycle;
  const status = value.status;

  if (provider !== "cih" && provider !== "lana_cash") return null;
  if (plan !== "pro" && plan !== "business") return null;
  if (billingCycle !== "monthly" && billingCycle !== "yearly") return null;
  if (status !== "active" && status !== "canceled" && status !== "expired") return null;

  return {
    provider,
    plan,
    billing_cycle: billingCycle,
    status,
  };
}

// TODO: Verify CIH and LANA CASH webhook signatures before this can return true.
function verifyProviderWebhook(_request: Request, _event: PaymentEvent): boolean {
  return false;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Payment service is not configured" }, 500);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const event = validatePaymentEvent(payload);
  if (!event) {
    return json({ error: "Invalid payment event" }, 400);
  }

  if (!verifyProviderWebhook(request, event)) {
    return json(
      { error: "Payment provider verification is not configured yet" },
      501,
    );
  }

  return json(
    { error: "Payment provider verification is not configured yet" },
    501,
  );
});
