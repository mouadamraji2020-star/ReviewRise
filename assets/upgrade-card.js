// Sidebar "Upgrade to Pro" card for users on the free trial.
// Pages call window.ReviewRiseUpgradeCard.update(state) with the subscription state they already
// loaded (plan, hasAccess, trialDaysRemaining). The card is only shown for an active trial.
// It never changes a plan. Upgrades are arranged by WhatsApp: the owner sends payment details and
// activates the plan from the admin page after the payment arrives.
(function () {
  var STYLE_ID = "rr-upgrade-style";
  var CARD_ID = "rrUpgradeCard";
  var BAR_ID = "rrUpgradeBar";
  var PLANS_URL = "settings.html#subscription";
  var WHATSAPP_NUMBER = "212766315853"; // ReviewRise owner, international format without "+"

  // The signed-in user's own email, read from their own access token, so the owner can find the account.
  function accountEmail() {
    try {
      var token = localStorage.getItem("reviewrise_token") || "";
      var part = token.split(".")[1];
      if (!part) return "";
      var json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
      var email = JSON.parse(json).email;
      return typeof email === "string" ? email : "";
    } catch (error) {
      return "";
    }
  }

  function whatsappUrl(plan, cycle) {
    var planName = plan === "business" ? "Business" : "Pro";
    var message = "Hello ReviewRise, I'd like to upgrade to the " + planName + " plan" +
      (cycle === "yearly" || cycle === "monthly" ? " (" + cycle + " billing)" : "") + ".";
    var email = accountEmail();
    if (email) message += " My account email: " + email + ".";
    message += " Please send me the payment details.";
    return "https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(message);
  }

  function openWhatsApp(plan, cycle) {
    var url = whatsappUrl(plan, cycle);
    var opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) window.location.href = url;
  }

  var css = [
    ".rr-upgrade { margin-top: auto; padding: 16px 14px; border-radius: 16px;",
    "  border: 1px solid rgba(94, 160, 255, 0.28);",
    "  background: linear-gradient(160deg, rgba(47, 139, 255, 0.22), rgba(62, 198, 255, 0.07) 70%), rgba(255, 255, 255, 0.03);",
    "  color: #e8eef9; box-sizing: border-box; }",
    ".rr-upgrade[hidden] { display: none !important; }",
    ".rr-upgrade-label { display: block; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #7eb6ff; }",
    ".rr-upgrade-days { display: block; margin-top: 4px; font-size: 17px; font-weight: 800; color: #fff; letter-spacing: -0.2px; }",
    ".rr-upgrade-text { margin: 8px 0 0; font-size: 12.5px; line-height: 1.5; color: #b9c7dc; }",
    ".rr-upgrade-btn { display: block; margin-top: 12px; padding: 10px 12px; border-radius: 11px; text-align: center;",
    "  background: #fff; color: #10284d; font-size: 13px; font-weight: 800; text-decoration: none; }",
    ".rr-upgrade-btn:hover { background: #eaf2ff; }",
    ".rr-upgrade-btn:focus-visible { outline: 2px solid #3ec6ff; outline-offset: 2px; }",
    ".rr-upgrade-plans { display: block; margin-top: 10px; text-align: center; font-size: 12px; font-weight: 700; color: #9cc4ff; text-decoration: none; }",
    ".rr-upgrade-plans:hover { color: #fff; text-decoration: underline; }",
    ".sidebar-collapsed .rr-upgrade { display: none; }",
    "@media (max-width: 800px) { .sidebar-collapsed .rr-upgrade { display: block; } .sidebar.open { overflow-y: auto; } }",
    ".rr-upgrade-bar { display: none; }",
    "@media (max-width: 800px) {",
    "  .rr-upgrade-bar:not([hidden]) { display: flex; align-items: center; justify-content: space-between; gap: 10px;",
    "    margin: 12px 16px 0; padding: 10px 12px; border-radius: 14px; box-sizing: border-box;",
    "    background: linear-gradient(135deg, #10284d, #1d4ed8); color: #fff; box-shadow: 0 8px 20px rgba(16, 40, 80, 0.18); }",
    "  .rr-bar-text { min-width: 0; font-size: 13px; line-height: 1.3; }",
    "  .rr-bar-text strong { display: block; font-weight: 800; }",
    "  .rr-bar-text span { color: #cfe0ff; font-weight: 600; }",
    "  .rr-bar-btn { flex: none; padding: 9px 14px; border-radius: 10px; background: #fff; color: #10284d; font-size: 13px; font-weight: 800; text-decoration: none; white-space: nowrap; }",
    "}"
  ].join("\n");

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function ensureCard() {
    var existing = document.getElementById(CARD_ID);
    if (existing) return existing;

    var sidebar = document.querySelector(".sidebar");
    if (!sidebar) return null;

    var card = document.createElement("div");
    card.className = "rr-upgrade";
    card.id = CARD_ID;
    card.hidden = true;

    var label = document.createElement("span");
    label.className = "rr-upgrade-label";
    label.textContent = "Free trial";

    var days = document.createElement("span");
    days.className = "rr-upgrade-days";
    days.id = "rrUpgradeDays";

    var text = document.createElement("p");
    text.className = "rr-upgrade-text";
    text.textContent = "Upgrade to Pro for up to 5 businesses, Customer Intelligence, Smart Alerts and advanced analytics.";

    var button = document.createElement("a");
    button.className = "rr-upgrade-btn";
    button.href = whatsappUrl("pro");
    button.target = "_blank";
    button.rel = "noopener noreferrer";
    button.textContent = "Upgrade to Pro";
    button.addEventListener("click", function () {
      // Rebuild the link on click so it always carries the current account email.
      button.href = whatsappUrl("pro");
    });

    var plans = document.createElement("a");
    plans.className = "rr-upgrade-plans";
    plans.href = PLANS_URL;
    plans.textContent = "Compare plans";
    plans.addEventListener("click", function (event) {
      // On the Settings page the link points at the page we are already on, so open the tab directly.
      if (/settings\.html$/i.test(window.location.pathname) && typeof window.showSection === "function") {
        event.preventDefault();
        window.showSection("subscription");
      }
    });

    card.appendChild(label);
    card.appendChild(days);
    card.appendChild(text);
    card.appendChild(button);
    card.appendChild(plans);
    sidebar.appendChild(card);
    return card;
  }

  // On phones the sidebar is hidden behind the menu button, so a slim banner under the top bar shows the same offer.
  function ensureBar() {
    var existing = document.getElementById(BAR_ID);
    if (existing) return existing;

    var header = document.querySelector(".app-workspace .top-navbar") || document.querySelector(".top-navbar");
    if (!header) return null;

    var bar = document.createElement("div");
    bar.className = "rr-upgrade-bar";
    bar.id = BAR_ID;
    bar.hidden = true;

    var text = document.createElement("div");
    text.className = "rr-bar-text";
    var title = document.createElement("strong");
    title.textContent = "Free trial";
    var days = document.createElement("span");
    days.id = "rrBarDays";
    text.appendChild(title);
    text.appendChild(days);

    var button = document.createElement("a");
    button.className = "rr-bar-btn";
    button.href = whatsappUrl("pro");
    button.target = "_blank";
    button.rel = "noopener noreferrer";
    button.textContent = "Upgrade";
    button.addEventListener("click", function () {
      button.href = whatsappUrl("pro");
    });

    bar.appendChild(text);
    bar.appendChild(button);
    header.insertAdjacentElement("afterend", bar);
    return bar;
  }

  function daysText(days) {
    if (typeof days !== "number" || !isFinite(days)) return "Trial active";
    if (days <= 0) return "Ends today";
    if (days === 1) return "1 day left";
    return days + " days left";
  }

  function update(state) {
    try {
      var onTrial = !!state && state.plan === "trial" && state.hasAccess === true;
      ensureStyle();
      var card = ensureCard();
      var bar = ensureBar();
      var label = onTrial ? daysText(state.trialDaysRemaining) : "";
      if (card) {
        card.hidden = !onTrial;
        if (onTrial) document.getElementById("rrUpgradeDays").textContent = label;
      }
      if (bar) {
        bar.hidden = !onTrial;
        if (onTrial) document.getElementById("rrBarDays").textContent = label;
      }
    } catch (error) {
      // The card is a convenience; never let it break the page.
    }
  }

  window.ReviewRiseUpgradeCard = { update: update };
  window.ReviewRiseWhatsApp = { open: openWhatsApp, url: whatsappUrl };

  // A page may have received the subscription state before this file finished loading.
  if (window.__rrTrialState) update(window.__rrTrialState);
})();
