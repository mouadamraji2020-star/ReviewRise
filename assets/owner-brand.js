// Owner pages: shows the owner's own business (logo + name) at the top of the sidebar,
// with a small "Powered by ReviewRise" line. Uses the business list the pages already keep in the
// browser, so it makes no extra network requests. If nothing is known yet (first login, no business,
// or several businesses with "All" selected) the normal ReviewRise logo stays.
(function () {
  var brand = document.querySelector(".sidebar-brand");
  if (!brand) return;
  var original = brand.innerHTML;
  var COLORS = ["#2b7fff", "#1c9a52", "#b45309", "#7c3aed", "#db2777", "#0e7490"];

  var style = document.createElement("style");
  style.textContent =
    ".dash-logo-mark.ob-mark{width:34px;height:34px;border-radius:10px;overflow:hidden;justify-content:center;color:#fff;font-weight:800;font-size:16px;line-height:1}" +
    ".dash-logo-mark.ob-mark img{height:100%;width:100%;max-width:none;object-fit:cover}" +
    ".dash-logo-name.ob-name{display:flex;flex-direction:column;gap:3px;min-width:0;max-width:140px;line-height:1.1}" +
    ".ob-name .ob-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#fff;font-size:15px;font-weight:700;letter-spacing:-0.2px}" +
    ".ob-name .ob-powered{display:block;font-size:10.5px;font-weight:500;color:#8fa3c4;letter-spacing:0;white-space:nowrap}" +
    ".ob-name .ob-powered b{font-weight:700;color:#b9c8e2}";
  document.head.appendChild(style);

  function userId() {
    try {
      var token = localStorage.getItem("reviewrise_token");
      var json = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return json.sub ? String(json.sub) : "";
    } catch (e) { return ""; }
  }

  var OWN_KEY = "reviewrise_brand_cache";
  var SUPABASE_URL = "https://intlhwmvldxdiytemjlr.supabase.co";

  function readCache(key, id) {
    try {
      var cache = JSON.parse(localStorage.getItem(key) || "null");
      if (!cache || String(cache.owner_id) !== id || !Array.isArray(cache.links) || !cache.links.length) return null;
      return cache;
    } catch (e) { return null; }
  }

  // Pages that do not keep their own business list (e.g. first visit on Feedback) still get the brand:
  // one small request, remembered for 10 minutes in its own storage key.
  function refreshOwnCache() {
    var id = userId();
    if (!id || !window.fetch) return;
    var own = readCache(OWN_KEY, id);
    if (own && Date.now() - (own.saved_at || 0) < 10 * 60 * 1000) return;
    var token = localStorage.getItem("reviewrise_token");
    var keyEl = (window.SUPABASE_KEY || "");
    if (!keyEl) {
      var m = document.documentElement.innerHTML.match(/SUPABASE_KEY\s*=\s*["']([^"']+)["']/);
      keyEl = m ? m[1] : "";
    }
    if (!keyEl) return;
    fetch(SUPABASE_URL + "/rest/v1/Reviewlinks?select=id,business_name,logo_url,is_primary,user_id&order=created_at.asc", {
      headers: { apikey: keyEl, Authorization: "Bearer " + token }
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (rows) {
      if (!Array.isArray(rows)) return;
      localStorage.setItem(OWN_KEY, JSON.stringify({ owner_id: id, saved_at: Date.now(), links: rows }));
    }).catch(function () {});
  }

  function currentBusiness() {
    var id = userId();
    if (!id) return null;
    var links;
    try {
      var cache = readCache("reviewrise_reviewlinks_data", id) || readCache(OWN_KEY, id);
      if (!cache) return null;
      links = cache.links.filter(function (l) {
        return l && l.id != null && l.business_name && (l.user_id == null || String(l.user_id) === id);
      });
    } catch (e) { return null; }
    if (!links.length) return null;
    var selected = "";
    try { selected = localStorage.getItem("reviewrise_selected_business_" + id) || ""; } catch (e) {}
    var found = links.filter(function (l) { return String(l.id) === selected; })[0];
    if (found) return found;
    return links.length === 1 ? links[0] : null;
  }

  function letterColor(name) {
    var sum = 0;
    for (var i = 0; i < name.length; i++) sum += name.charCodeAt(i);
    return COLORS[sum % COLORS.length];
  }

  var shown = null;

  function render() {
    var biz = currentBusiness();
    var key = biz ? String(biz.id) + "|" + biz.business_name + "|" + (biz.logo_url || "") : "";
    if (key === shown) return;
    shown = key;
    if (!biz) { brand.innerHTML = original; return; }

    var name = String(biz.business_name).trim();
    var mark = document.createElement("span");
    mark.className = "dash-logo-mark ob-mark";
    var letter = function () {
      mark.textContent = (name.charAt(0) || "R").toUpperCase();
      mark.style.background = letterColor(name);
    };
    if (typeof biz.logo_url === "string" && /^https:\/\//i.test(biz.logo_url)) {
      var img = document.createElement("img");
      img.alt = "";
      img.onerror = function () { mark.textContent = ""; letter(); };
      img.src = biz.logo_url;
      mark.appendChild(img);
    } else {
      letter();
    }

    var text = document.createElement("span");
    text.className = "dash-logo-name ob-name";
    var title = document.createElement("strong");
    title.className = "ob-title";
    title.setAttribute("data-no-i18n", "");
    title.textContent = name;
    title.title = name;
    var powered = document.createElement("small");
    powered.className = "ob-powered";
    powered.innerHTML = "Powered by <b>ReviewRise</b>";
    text.appendChild(title);
    text.appendChild(powered);

    brand.textContent = "";
    brand.appendChild(mark);
    brand.appendChild(text);
  }

  // The pages write the business list / selection into localStorage; re-draw when they do.
  try {
    var originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key) {
      var result = originalSet.apply(this, arguments);
      if (this === window.localStorage && /^reviewrise_(reviewlinks_data|brand_cache|selected_business_)/.test(String(key))) {
        setTimeout(render, 0);
      }
      return result;
    };
    var originalRemove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) {
      var result = originalRemove.apply(this, arguments);
      if (this === window.localStorage && /^reviewrise_(reviewlinks_data|brand_cache|selected_business_)/.test(String(key))) {
        setTimeout(render, 0);
      }
      return result;
    };
  } catch (e) {}
  window.addEventListener("storage", render);
  render();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refreshOwnCache);
  else refreshOwnCache();
})();
