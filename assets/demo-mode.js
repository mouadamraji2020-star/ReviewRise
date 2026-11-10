// Live demo: runs the REAL ReviewRise pages with example data, so visitors see exactly what owners see.
// It only switches on with ?demo=1 (and then stays on for that browser tab). While it is on:
//   * nothing is read from or written to the real database: every request to the server is answered here;
//   * the browser's saved data is replaced by a temporary in-memory copy, so a real signed-in owner is never touched.
(function () {
  var on = false;
  try {
    if (/[?&]demo=1(&|$)/.test(location.search)) sessionStorage.setItem("rr_demo", "1");
    on = sessionStorage.getItem("rr_demo") === "1";
  } catch (e) { return; }
  if (!on) return;

  var UID = "d3m0d3m0-0000-4000-8000-000000000001";
  var realStore = window.localStorage;
  function b64(o) { return btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); }
  var TOKEN = b64({ alg: "HS256", typ: "JWT" }) + "." +
    b64({ sub: UID, email: "demo@reviewrise.example", exp: 4102444800, role: "authenticated", user_metadata: { full_name: "Demo Owner" } }) + ".demo";

  // ---- in-memory storage (the visitor's language choice is the only thing passed through) ----
  var mem = {};
  var PASS = { rr_lang: 1 };
  var shim = {
    getItem: function (k) { k = String(k); if (PASS[k]) return realStore.getItem(k); return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem: function (k, v) { k = String(k); if (PASS[k]) realStore.setItem(k, v); else mem[k] = String(v); },
    removeItem: function (k) { k = String(k); if (PASS[k]) realStore.removeItem(k); else delete mem[k]; },
    clear: function () { mem = {}; },
    key: function (i) { return Object.keys(mem)[i] || null; },
    get length() { return Object.keys(mem).length; }
  };
  try { Object.defineProperty(window, "localStorage", { value: shim, configurable: true }); } catch (e) { return; }

  // ---- example data ----
  var DAY = 864e5, now = Date.now();
  var iso = function (d, h) { return new Date(now - d * DAY - (h || 0) * 36e5).toISOString(); };
  var business = {
    id: 1, business_name: "Demo Riad", logo_url: null, is_primary: true, created_at: iso(40), user_id: UID,
    google_review_url: "https://search.google.com/local/writereview?placeid=demo", google_review_link: "https://search.google.com/local/writereview?placeid=demo",
    positive_threshold: 4, private_feedback_enabled: true, google_redirect_enabled: true, phone: "", city: "Tangier", country: "Morocco"
  };
  var C = {
    low1: ["Check-in took more than 40 minutes and nobody apologised.", "Waited a very long time at check-in again.", "The check-in process was slow and confusing.", "Check-in took too long after our long trip."],
    low2: ["The room was noisy at night because of the street.", "Noisy at night, we could not sleep.", "Too much noise at night from the terrace."],
    low3: ["Breakfast was cold and the coffee was weak.", "Cold breakfast, the eggs were not warm.", "The wifi did not work in our room."],
    pos: ["Lovely stay, the staff made us feel at home.", "Beautiful rooftop and a great location.", "Best breakfast in the medina. We will come back!", "Very clean and the team was so kind.", "Perfect for a weekend in Tangier.", "Great value and a warm welcome.", "The room was spotless and quiet.", "Friendly staff and excellent mint tea."]
  };
  var feedback = [];
  var plan = [
    [1, C.low1[0], 2], [1, C.low2[0], 3], [2, C.low1[1], 4], [2, C.low2[1], 6], [2, C.low3[0], 8], [3, C.low1[2], 9], [3, C.low3[2], 12], [3, C.low2[2], 14],
    [3, C.low3[1], 17], [3, C.low1[3], 19]
  ];
  var ratings = [];
  plan.forEach(function (p) { ratings.push({ r: p[0] === 1 ? 1 : p[0], t: p[1], d: p[2] }); });
  // fill up to 48 responses: positives (4 and 5 stars)
  for (var i = 0; i < 38; i++) {
    ratings.push({ r: i % 3 === 0 ? 4 : 5, t: i % 2 === 0 ? C.pos[i % C.pos.length] : "", d: Math.floor((i * 29) / 38) + (i % 3) * 0.2 });
  }
  ratings.forEach(function (x, idx) {
    feedback.push({ id: 1000 - idx, rating: x.r, feedback: x.t || null, business: business.business_name, review_link_id: 1, user_id: UID, created_at: iso(x.d, (idx * 7) % 13), handled_at: null, owner_note: null });
  });
  feedback[1].handled_at = iso(1); feedback[1].owner_note = "Called the guest and offered a quiet room next time.";
  feedback[6].handled_at = iso(5); feedback[6].owner_note = "Router replaced on the second floor.";
  feedback.sort(function (a, b) { return Date.parse(b.created_at) - Date.parse(a.created_at); });

  var profile = { id: UID, full_name: "Demo Owner", onboarding_completed: true, plan: "pro", subscription_status: "active", billing_cycle: "monthly",
    current_period_end: new Date(now + 20 * DAY).toISOString(), email_on_private_feedback: false, business_name: business.business_name, phone: "", trial_ends_at: null };
  var sub = { plan: "pro", subscription_status: "active", has_access: true, trial_ends_at: null, trial_days_remaining: null, billing_cycle: "monthly",
    current_period_end: new Date(now + 20 * DAY).toISOString(), payment_provider: "manual", cancel_at_period_end: false, business_count: 1, business_limit: 5 };
  var payments = [{ id: 1, created_at: iso(10), customer_email: "demo@reviewrise.example", plan: "pro", billing_cycle: "monthly", amount: 20, currency: "USD", method: "Bank transfer", period_end: new Date(now + 20 * DAY).toISOString() }];

  mem.reviewrise_token = TOKEN;
  mem.reviewrise_refresh_token = "demo";
  mem.reviewrise_reviewlinks_data = JSON.stringify({ owner_id: UID, links: [business] });

  // ---- answer every server request here; never reach the real server ----
  var realFetch = window.fetch.bind(window);
  function reply(body, status) {
    return new Response(status === 204 ? null : JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json" } });
  }
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.indexOf(".supabase.co") === -1) return realFetch(input, init);
    var method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    var body = {};
    try { body = JSON.parse((init && init.body) || "{}"); } catch (e) {}
    return new Promise(function (resolve) {
      var r;
      if (url.indexOf("/auth/v1/user") !== -1) r = reply({ id: UID, email: "demo@reviewrise.example", email_confirmed_at: iso(40), user_metadata: { full_name: "Demo Owner" } });
      else if (url.indexOf("/auth/v1/token") !== -1) r = reply({ access_token: TOKEN, refresh_token: "demo", expires_in: 3600, token_type: "bearer", user: { id: UID, email: "demo@reviewrise.example" } });
      else if (url.indexOf("/auth/v1/logout") !== -1) { try { sessionStorage.removeItem("rr_demo"); } catch (e) {} r = reply({}, 204); }
      else if (url.indexOf("get_my_subscription_state") !== -1) r = reply([sub]);
      else if (url.indexOf("can_create_review_link") !== -1) r = reply(true);
      else if (url.indexOf("get_my_payments") !== -1) r = reply(payments);
      else if (url.indexOf("get_public_review_link") !== -1) r = reply([business]);
      else if (url.indexOf("update_feedback_status") !== -1) {
        feedback.forEach(function (f) {
          if (String(f.id) === String(body.p_id)) { f.handled_at = body.p_handled ? (f.handled_at || new Date().toISOString()) : null; f.owner_note = body.p_note || null; }
        });
        r = reply({ ok: true });
      }
      else if (url.indexOf("/rest/v1/rpc/") !== -1) r = reply({ ok: true });
      else if (url.indexOf("/rest/v1/Feedback") !== -1) r = method === "GET" ? reply(feedback) : reply([], method === "DELETE" ? 204 : 200);
      else if (url.indexOf("/rest/v1/Reviewlinks") !== -1) r = method === "GET" ? reply([business]) : reply([business]);
      else if (url.indexOf("/rest/v1/profiles") !== -1) r = method === "GET" ? reply([profile]) : reply([profile]);
      else if (url.indexOf("/functions/v1/") !== -1) r = reply({ ok: true });
      else r = method === "GET" ? reply([]) : reply({ ok: true });
      resolve(r);
    });
  };

  // ---- small floating bar ----
  function bar() {
    if (document.getElementById("rrDemoBar")) return;
    var css = document.createElement("style");
    css.textContent =
      "#rrDemoBar{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483000;display:flex;align-items:center;gap:10px;max-width:calc(100vw - 24px);padding:9px 10px 9px 16px;border-radius:999px;background:#0c1424;color:#e7eefb;font:600 13px/1.2 Inter,system-ui,sans-serif;box-shadow:0 12px 32px rgba(10,20,40,.35)}" +
      "body{padding-bottom:76px}#rrDemoBar span{white-space:nowrap}#rrDemoBar .short{display:none}#rrDemoBar button{border:0;border-radius:999px;padding:8px 14px;font:700 13px Inter,system-ui,sans-serif;cursor:pointer;white-space:nowrap}" +
      "#rrDemoBar .go{background:#2b7fff;color:#fff}#rrDemoBar .x{background:rgba(255,255,255,.12);color:#e7eefb}" +
      "@media(max-width:520px){#rrDemoBar .long{display:none}#rrDemoBar .short{display:inline}#rrDemoBar{gap:8px;padding-left:14px;bottom:12px}#rrDemoBar button{padding:9px 12px}}";
    document.head.appendChild(css);
    var el = document.createElement("div");
    el.id = "rrDemoBar";
    el.innerHTML = "<span class=\"long\">Demo with example data</span><span class=\"short\">Demo</span><button class=\"go\" type=\"button\">Start free trial</button><button class=\"x\" type=\"button\">Exit demo</button>";
    function leave(url) { try { sessionStorage.removeItem("rr_demo"); } catch (e) {} location.href = url; }
    el.querySelector(".go").addEventListener("click", function () { leave("dashboard.html"); });
    el.querySelector(".x").addEventListener("click", function () { leave("index.html"); });
    document.body.appendChild(el);
  }
  if (document.body) bar(); else document.addEventListener("DOMContentLoaded", bar);
})();
