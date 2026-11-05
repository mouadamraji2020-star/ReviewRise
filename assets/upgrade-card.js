// Sidebar "Upgrade to Pro" card for users on the free trial.
// Pages call window.ReviewRiseUpgradeCard.update(state) with the subscription state they already
// loaded (plan, hasAccess, trialDaysRemaining). The card is only shown for an active trial.
// It reads no data itself and never changes a plan; it just links to the plans in Settings.
(function () {
  var STYLE_ID = "rr-upgrade-style";
  var CARD_ID = "rrUpgradeCard";
  var PLANS_URL = "settings.html#subscription";

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
    ".sidebar-collapsed .rr-upgrade { display: none; }",
    "@media (max-width: 800px) { .sidebar-collapsed .rr-upgrade { display: block; } }"
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
    button.href = PLANS_URL;
    button.textContent = "Upgrade to Pro";
    button.addEventListener("click", function (event) {
      // On the Settings page the link points at the page we are already on, so open the tab directly.
      if (/settings\.html$/i.test(window.location.pathname) && typeof window.showSection === "function") {
        event.preventDefault();
        window.showSection("subscription");
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, "", "#subscription");
        }
      }
    });

    card.appendChild(label);
    card.appendChild(days);
    card.appendChild(text);
    card.appendChild(button);
    sidebar.appendChild(card);
    return card;
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
      if (!card) return;
      card.hidden = !onTrial;
      if (onTrial) {
        document.getElementById("rrUpgradeDays").textContent = daysText(state.trialDaysRemaining);
      }
    } catch (error) {
      // The card is a convenience; never let it break the page.
    }
  }

  window.ReviewRiseUpgradeCard = { update: update };

  // A page may have received the subscription state before this file finished loading.
  if (window.__rrTrialState) update(window.__rrTrialState);
})();
