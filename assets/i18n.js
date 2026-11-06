// ReviewRise language support: English (default), French and German.
// The pages are written in English. This file translates what is on screen using the
// dictionaries in assets/i18n-fr.js and assets/i18n-de.js, and keeps translating text that the
// pages add later (messages, lists, cards). Anything without a translation simply stays in English.
// The chosen language is kept in this browser only (localStorage key "rr_lang").
(function () {
  var LANGS = {
    en: { label: "English", dir: "ltr", locale: "" },
    fr: { label: "Français", dir: "ltr", locale: "fr-FR" },
    de: { label: "Deutsch", dir: "ltr", locale: "de-DE" }
  };
  var KEY = "rr_lang";

  function stored() {
    try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; }
  }

  function pick() {
    var fromUrl = "";
    try { fromUrl = (new URLSearchParams(window.location.search).get("lang") || "").toLowerCase(); } catch (e) { /* ignore */ }
    if (LANGS[fromUrl]) {
      try { localStorage.setItem(KEY, fromUrl); } catch (e) { /* ignore */ }
      return fromUrl;
    }
    var saved = stored();
    if (LANGS[saved]) return saved;
    // First visit: follow the phone or browser language when we support it.
    var nav = ((navigator.languages && navigator.languages[0]) || navigator.language || "en").toLowerCase();
    var short = nav.slice(0, 2);
    return LANGS[short] ? short : "en";
  }

  var lang = pick();
  var root = document.documentElement;
  root.setAttribute("lang", lang);
  root.setAttribute("dir", LANGS[lang].dir);

  var scriptEl = document.currentScript;
  var base = scriptEl && scriptEl.src ? scriptEl.src.replace(/[^\/]*$/, "") : "assets/";

  function setLanguage(next) {
    if (!LANGS[next] || next === lang) return;
    try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
    window.location.reload();
  }

  window.ReviewRiseLang = { current: lang, set: setLanguage, dir: LANGS[lang].dir };

  // ---------- Switcher (shown in every language) ----------
  function buildSwitcher() {
    var wrap = document.createElement("label");
    wrap.className = "rr-lang";
    wrap.setAttribute("data-no-i18n", "");
    var select = document.createElement("select");
    select.setAttribute("aria-label", "Language / Langue / Sprache");
    Object.keys(LANGS).forEach(function (code) {
      var option = document.createElement("option");
      option.value = code;
      option.textContent = LANGS[code].label;
      if (code === lang) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener("change", function () { setLanguage(select.value); });
    wrap.appendChild(select);
    return wrap;
  }

  function placeSwitcher() {
    // Put a switcher in every header area the page has (only the visible one shows).
    var spots = [".header-actions", ".top-navbar-actions", ".topbar-side", ".auth-topnav", "header.top", ".top-actions"];
    var placed = 0;
    for (var i = 0; i < spots.length; i++) {
      var spot = document.querySelector(spots[i]);
      if (!spot) continue;
      var wrap = buildSwitcher();
      wrap.classList.add("rr-lang-inline");
      if (spots[i] === ".header-actions" || spots[i] === ".top-navbar-actions") spot.insertBefore(wrap, spot.firstChild);
      else spot.appendChild(wrap);
      placed++;
    }
    if (!placed) {
      var floating = buildSwitcher();
      floating.classList.add("rr-lang-float");
      document.body.appendChild(floating);
    }
  }

  var css = [
    ".rr-lang { display: inline-flex; align-items: center; margin: 0 8px; flex: none; }",
    ".rr-lang select { appearance: none; -webkit-appearance: none; font: inherit; font-size: 13px; font-weight: 700; line-height: 1;",
    "  padding: 8px 26px 8px 12px; border: 1px solid rgba(120, 140, 170, 0.45); border-radius: 999px; color: inherit; cursor: pointer;",
    "  background: #fff url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M1 1l4 4 4-4' fill='none' stroke='%235d6c84' stroke-width='1.6' stroke-linecap='round'/></svg>\") no-repeat right 10px center; color: #10203f; }",
        ".rr-lang select:focus-visible { outline: 2px solid #2f7cf6; outline-offset: 2px; }",
    ".rr-lang-float { position: fixed; z-index: 60; bottom: 14px; inset-inline-end: 14px; margin: 0; }",
    ".rr-lang-float select { box-shadow: 0 6px 18px rgba(16, 32, 63, 0.18); }",
    "@media (max-width: 520px) { .rr-lang { margin: 0 4px; } .rr-lang select { padding-top: 7px; padding-bottom: 7px; font-size: 12.5px; } }"
  ];
  function addStyle() {
    var style = document.createElement("style");
    style.id = "rr-i18n-style";
    style.textContent = css.join("\n");
    document.head.appendChild(style);
  }

  // ---------- Dates follow the chosen language ----------
  var locale = LANGS[lang].locale;
  if (locale) {
    ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"].forEach(function (name) {
      var original = Date.prototype[name];
      Date.prototype[name] = function (loc, options) {
        try { return original.call(this, loc || locale, options); } catch (e) { return original.call(this, loc, options); }
      };
    });
  }

  if (lang === "en") {
    function startEnglish() { addStyle(); placeSwitcher(); }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startEnglish);
    else startEnglish();
    return;
  }

  // ---------- Translation ----------
  // The dictionary file for the chosen language is loaded right now, before the page scripts run.
  document.write('<script src="' + base + "i18n-" + lang + '.js"><\/script>');

  var exact = {};
  var patterns = [];
  var ready = false;

  function norm(text) {
    return String(text).replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  }

  function escapeRegex(text) {
    return text.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  }

  function compile() {
    var dict = window.RR_DICT || {};
    Object.keys(dict).forEach(function (key) {
      var nkey = norm(key);
      if (/\{\d+\}/.test(nkey)) {
        var parts = nkey.split(/\{\d+\}/);
        var source = "^" + parts.map(escapeRegex).join("(.+?)") + "$";
        patterns.push({ re: new RegExp(source), out: dict[key], literal: nkey.replace(/\{\d+\}/g, "").length });
      } else {
        exact[nkey] = dict[key];
      }
    });
    // More specific (longer fixed text) patterns first.
    patterns.sort(function (a, b) { return b.literal - a.literal; });
    ready = true;
  }

  function lookup(key) {
    if (!key) return null;
    if (Object.prototype.hasOwnProperty.call(exact, key)) return exact[key];
    for (var i = 0; i < patterns.length; i++) {
      var m = patterns[i].re.exec(key);
      if (m) {
        return patterns[i].out.replace(/\{(\d+)\}/g, function (all, n) {
          var piece = m[Number(n) + 1];
          if (piece === undefined) return "";
          var inner = lookup(piece);
          return inner != null ? inner : piece;
        });
      }
    }
    return null;
  }

  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, CODE: 1, PRE: 1, SVG: 1, OPTION_NEVER: 1 };
  var states = new WeakMap();
  var ATTRS = ["placeholder", "title", "aria-label", "alt"];

  function skipped(node, attrOnly) {
    for (var el = node.nodeType === 1 ? node : node.parentNode; el && el.nodeType === 1; el = el.parentNode) {
      if (!attrOnly && SKIP[el.nodeName.toUpperCase()]) return true;
      if (el.hasAttribute("data-no-i18n") || el.getAttribute("contenteditable") === "true") return true;
    }
    return false;
  }

  function translateText(node) {
    var raw = node.nodeValue;
    var st = states.get(node);
    if (st && st.out === raw) return;
    var key = norm(raw);
    if (!key) return;
    // The logo is written as "Review" + <span>Rise</span>; the brand name is never translated.
    if (key === "Review" && node.nextSibling && node.nextSibling.nodeType === 1 && /^Rise$/.test(node.nextSibling.textContent)) return;
    var out = lookup(key);
    if (out == null) { if (st) states.delete(node); return; }
    if (skipped(node)) return;
    var lead = /^[.,;:?!]/.test(out) ? "" : raw.match(/^\s*/)[0];
    var trail = raw.match(/\s*$/)[0];
    var value = lead + out + trail;
    states.set(node, { out: value });
    node.nodeValue = value;
  }

  function translateAttrs(el) {
    if (el.nodeType !== 1) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var name = ATTRS[i];
      if (!el.hasAttribute(name)) continue;
      var value = el.getAttribute(name);
      if (el.__rrAttr && el.__rrAttr[name] === value) continue;
      var out = lookup(norm(value));
      if (out == null || skipped(el, true)) continue;
      (el.__rrAttr || (el.__rrAttr = {}))[name] = out;
      el.setAttribute(name, out);
    }
    if (el.nodeName === "INPUT" && /^(button|submit|reset)$/i.test(el.type) && el.value) {
      var v = lookup(norm(el.value));
      if (v != null) el.value = v;
    }
  }

  function walk(node) {
    if (node.nodeType === 3) { translateText(node); return; }
    if (node.nodeType !== 1) return;
    if (node.hasAttribute("data-no-i18n")) return;
    if (SKIP[node.nodeName.toUpperCase()]) { translateAttrs(node); return; }
    var lines = node.getAttribute("data-i18n-lines");
    if (lines) {
      var tl = lookup(norm(lines));
      if (tl != null) {
        while (node.firstChild) node.removeChild(node.firstChild);
        tl.split("|").forEach(function (part, i) {
          if (i) node.appendChild(document.createElement("br"));
          // [[text]] marks the highlighted word (a span), like the original headline.
          part.split(/(\[\[.+?\]\])/).forEach(function (piece) {
            if (!piece) return;
            var hit = piece.match(/^\[\[(.+)\]\]$/);
            if (hit) {
              var span = document.createElement("span");
              span.textContent = hit[1];
              node.appendChild(span);
            } else {
              node.appendChild(document.createTextNode(piece));
            }
          });
        });
        return;
      }
    }
    translateAttrs(node);
    for (var child = node.firstChild; child; child = child.nextSibling) walk(child);
  }

  function translateTitle() {
    var out = lookup(norm(document.title));
    if (out != null) document.title = out;
  }

  function translateDialogs() {
    ["alert", "confirm", "prompt"].forEach(function (name) {
      var original = window[name];
      if (typeof original !== "function") return;
      window[name] = function (message) {
        var args = Array.prototype.slice.call(arguments);
        if (typeof message === "string") {
          var out = lookup(norm(message));
          if (out != null) args[0] = out;
        }
        return original.apply(window, args);
      };
    });
  }

  var observer = null;
  function observe() {
    observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === "characterData") translateText(r.target);
        else if (r.type === "attributes") translateAttrs(r.target);
        else for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]);
      }
    });
    observer.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS
    });
  }

  // Legal texts are only published in English; say so instead of showing a half-translated page.
  function legalNote() {
    if (!/\/(privacy|terms)\.html$/i.test(window.location.pathname)) return;
    var main = document.querySelector("main") || document.body;
    var note = document.createElement("p");
    note.setAttribute("data-no-i18n", "");
    note.style.cssText = "margin:0 0 16px;padding:12px 14px;border-radius:12px;background:#eef4ff;color:#10203f;font-size:14px;";
    note.textContent = lang === "fr"
      ? "Ce document juridique est disponible uniquement en anglais."
      : "Dieses Rechtsdokument ist nur auf Englisch verfügbar.";
    main.insertBefore(note, main.firstChild);
  }

  function start() {
    addStyle();
    legalNote();
    if (document.body) { placeSwitcher(); walk(document.body); }
    translateTitle();
  }

  // The dictionary file calls this as soon as it has loaded (before the page scripts run).
  window.RR_register = function (dict) {
    window.RR_DICT = dict;
    compile();
    translateDialogs();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { start(); observe(); });
    } else {
      start();
      observe();
    }
  };
  // The title can be set by the page after load.
  window.addEventListener("load", translateTitle);
  window.ReviewRiseLang.translate = function (text) { var out = ready ? lookup(norm(text)) : null; return out == null ? text : out; };
})();
