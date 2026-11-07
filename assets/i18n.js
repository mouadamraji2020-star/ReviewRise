// ReviewRise language support: English (default), French and German.
//
// The pages are written in English. This file swaps the words on screen for the chosen language and
// changes nothing else: no colours, sizes or layout are touched. It translates the page as it is
// being built (so there is no flash of English), translates text that page scripts add later
// (messages, lists, cards), and switches language instantly without reloading the page.
// Anything without a translation simply stays in English.
//
// The choice is remembered in this browser only (localStorage key "rr_lang"). Visitors see English
// until they pick another language with the switcher.
(function () {
  var LANGS = {
    en: { label: "English", short: "EN", locale: "" },
    fr: { label: "Français", short: "FR", locale: "fr-FR" },
    de: { label: "Deutsch", short: "DE", locale: "de-DE" }
  };
  var KEY = "rr_lang";
  var root = document.documentElement;

  function readChoice() {
    var fromUrl = "";
    try { fromUrl = (new URLSearchParams(window.location.search).get("lang") || "").toLowerCase(); } catch (e) { /* ignore */ }
    if (LANGS[fromUrl]) {
      try { localStorage.setItem(KEY, fromUrl); } catch (e) { /* ignore */ }
      return fromUrl;
    }
    try {
      var saved = localStorage.getItem(KEY) || "";
      if (LANGS[saved]) return saved;
    } catch (e) { /* ignore */ }
    return "en";
  }

  var lang = readChoice();
  var scriptEl = document.currentScript;
  var base = scriptEl && scriptEl.src ? scriptEl.src.replace(/[^\/]*$/, "") : "assets/";

  // ---------- Dictionaries ----------
  var dicts = {};      // language -> { exact: {}, patterns: [] }
  var pending = {};    // language -> [callbacks waiting for the file]

  function norm(text) {
    return String(text).replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  }
  function escapeRegex(text) {
    return text.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  }

  window.RR_register = function (code, dict) {
    var exact = {};
    var patterns = [];
    Object.keys(dict).forEach(function (key) {
      var nkey = norm(key);
      if (/\{#?\d+\}/.test(nkey)) {
        // {0} matches any text; {#0} matches a number only.
        var source = "";
        var last = 0;
        nkey.replace(/\{(#?)\d+\}/g, function (all, isNum, offset) {
          source += escapeRegex(nkey.slice(last, offset)) + (isNum ? "(\\d+(?:\\.\\d+)?)" : "(.+?)");
          last = offset + all.length;
          return all;
        });
        source += escapeRegex(nkey.slice(last));
        patterns.push({ re: new RegExp("^" + source + "$"), out: dict[key], literal: nkey.replace(/\{#?\d+\}/g, "").length });
      } else {
        exact[nkey] = dict[key];
      }
    });
    patterns.sort(function (a, b) { return b.literal - a.literal; });
    dicts[code] = { exact: exact, patterns: patterns };
    (pending[code] || []).forEach(function (cb) { cb(); });
    pending[code] = [];
  };

  function loadDict(code, done) {
    if (code === "en" || dicts[code]) { done(); return; }
    (pending[code] = pending[code] || []).push(done);
    if (pending[code].length > 1) return;
    var tag = document.createElement("script");
    tag.src = base + "i18n-" + code + ".js";
    tag.onerror = function () { (pending[code] || []).forEach(function (cb) { cb(); }); pending[code] = []; };
    (document.head || root).appendChild(tag);
  }

  function lookup(key, code) {
    var found = lookupWhole(key, code);
    if (found != null || key.indexOf(" \u00b7 ") === -1) return found;
    // Lines like "Riad Al Andalus · 2 days ago": translate each part, keep names and dates as they are.
    var any = false;
    var parts = key.split(" \u00b7 ").map(function (part) {
      var one = lookupWhole(part, code);
      if (one != null) any = true;
      return one != null ? one : part;
    });
    return any ? parts.join(" \u00b7 ") : null;
  }

  function lookupWhole(key, code) {
    var dict = dicts[code];
    if (!dict || !key) return null;
    if (Object.prototype.hasOwnProperty.call(dict.exact, key)) return dict.exact[key];
    for (var i = 0; i < dict.patterns.length; i++) {
      var m = dict.patterns[i].re.exec(key);
      if (m) {
        return dict.patterns[i].out.replace(/\{(\d+)\}/g, function (all, n) {
          var piece = m[Number(n) + 1];
          if (piece === undefined) return "";
          var inner = lookup(piece, code);
          return inner != null ? inner : piece;
        });
      }
    }
    return null;
  }

  // ---------- Translating the page ----------
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, CODE: 1, PRE: 1, SVG: 1 };
  var ATTRS = ["placeholder", "title", "aria-label", "alt"];
  var textState = new WeakMap(); // text node -> { orig, out }
  var observer = null;

  function skipped(node, attrOnly) {
    for (var el = node.nodeType === 1 ? node : node.parentNode; el && el.nodeType === 1; el = el.parentNode) {
      if (!attrOnly && SKIP[el.nodeName.toUpperCase()]) return true;
      if (el.hasAttribute("data-no-i18n") || el.getAttribute("contenteditable") === "true") return true;
    }
    return false;
  }

  // The English text a node currently stands for (before any translation of ours).
  function englishOf(node) {
    var st = textState.get(node);
    return st && st.out === node.nodeValue ? st.orig : node.nodeValue;
  }

  var forceInSvg = false;
  function applyTextForced(node) { forceInSvg = true; try { applyText(node); } finally { forceInSvg = false; } }

  function applyText(node) {
    var st = textState.get(node);
    if (lang !== "en" && st && st.lang === lang && st.out === node.nodeValue) return; // already ours
    var english = reDateStr(englishOf(node));
    var key = norm(english);
    if (!key) return;
    // The logo is written as "Review" + <span>Rise</span>; the brand name is never translated.
    if (key === "Review" && node.parentNode && /^ReviewRise$/.test(norm(node.parentNode.textContent))) return;
    var out = lang === "en" ? null : lookup(key, lang);
    if (out == null) {
      // Untranslated (or English): make sure the node shows the English original.
      if (st && st.out === node.nodeValue && node.nodeValue !== english) node.nodeValue = english;
      if (st) textState.delete(node);
      return;
    }
    if (!forceInSvg && skipped(node)) return;
    var lead = /^[.,;:?!]/.test(out) ? "" : english.match(/^\s*/)[0];
    var trail = english.match(/\s*$/)[0];
    var value = lead + out + trail;
    textState.set(node, { orig: english, out: value, lang: lang });
    if (node.nodeValue !== value) node.nodeValue = value;
  }

  function applyAttrs(el) {
    if (el.nodeType !== 1) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var name = ATTRS[i];
      if (!el.hasAttribute(name)) continue;
      var store = el.__rrAttr || (el.__rrAttr = {});
      var current = el.getAttribute(name);
      var rec = store[name];
      var english = rec && rec.out === current ? rec.orig : current;
      var out = lang === "en" ? null : lookup(norm(english), lang);
      if (out == null || skipped(el, true)) {
        if (rec && rec.out === current && current !== english) el.setAttribute(name, english);
        delete store[name];
        continue;
      }
      store[name] = { orig: english, out: out };
      if (current !== out) el.setAttribute(name, out);
    }
    if (el.nodeName === "INPUT" && /^(button|submit|reset)$/i.test(el.type) && el.value) {
      var rv = el.__rrVal;
      var eng = rv && rv.out === el.value ? rv.orig : el.value;
      var ov = lang === "en" ? null : lookup(norm(eng), lang);
      if (ov != null) { el.__rrVal = { orig: eng, out: ov }; el.value = ov; }
      else if (rv && rv.out === el.value) { el.value = eng; el.__rrVal = null; }
    }
  }

  // Elements that hold a whole headline written with line breaks: data-i18n-lines="English text".
  function applyLines(el) {
    var key = norm(el.getAttribute("data-i18n-lines") || "");
    if (el.__rrLinesOrig === undefined) el.__rrLinesOrig = el.innerHTML;
    var out = lang === "en" ? null : lookup(key, lang);
    if (out != null && el.__rrLinesDone === lang) return;
    if (out == null) {
      if (el.__rrLinesDone) { el.innerHTML = el.__rrLinesOrig; el.__rrLinesDone = false; }
      return;
    }
    while (el.firstChild) el.removeChild(el.firstChild);
    out.split("|").forEach(function (part, i) {
      if (i) el.appendChild(document.createElement("br"));
      // [[text]] marks the highlighted word (a span), like the original headline.
      part.split(/(\[\[.+?\]\])/).forEach(function (piece) {
        if (!piece) return;
        var hit = piece.match(/^\[\[(.+)\]\]$/);
        if (hit) {
          var span = document.createElement("span");
          span.textContent = hit[1];
          el.appendChild(span);
        } else {
          el.appendChild(document.createTextNode(piece));
        }
      });
    });
    el.__rrLinesDone = lang;
  }

  function walk(node) {
    if (node.nodeType === 3) { applyText(node); return; }
    if (node.nodeType !== 1) return;
    if (node.hasAttribute("data-no-i18n")) return;
    if (node.hasAttribute("data-i18n-lines")) { applyLines(node); return; }
    var tag = node.nodeName.toUpperCase();
    if (tag === "SVG") {
      // Charts keep their hover text in <title> elements; translate only those.
      var titles = node.getElementsByTagName("title");
      for (var t = 0; t < titles.length; t++) {
        for (var tc = titles[t].firstChild; tc; tc = tc.nextSibling) if (tc.nodeType === 3) applyTextForced(tc);
      }
      return;
    }
    if (SKIP[tag]) { applyAttrs(node); return; }
    applyAttrs(node);
    for (var child = node.firstChild; child; child = child.nextSibling) walk(child);
  }

  var titleEnglish = null;
  function applyTitle() {
    if (titleEnglish === null) titleEnglish = document.title;
    var out = lang === "en" ? null : lookup(norm(titleEnglish), lang);
    var wanted = out == null ? titleEnglish : out;
    if (document.title !== wanted) document.title = wanted;
  }

  function observe() {
    if (observer) return;
    observer = new MutationObserver(function (records) {
      if (lang === "en") return;
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === "characterData") { if (r.target.parentNode && r.target.parentNode.nodeName.toLowerCase() === "title" && r.target.parentNode.parentNode && r.target.parentNode.parentNode.namespaceURI) applyTextForced(r.target); else applyText(r.target); }
        else if (r.type === "attributes") applyAttrs(r.target);
        else for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]);
      }
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  // ---------- Dates, dialogs ----------
  // Dates the page writes with the browser's default format follow the chosen language. Each one is
  // remembered so that it can be rewritten in place when the language is switched.
  var dateLog = {};
  var dateLogCount = 0;
  ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"].forEach(function (name) {
    var original = Date.prototype[name];
    Date.prototype[name] = function (loc, options) {
      if (loc) return original.call(this, loc, options);
      var wanted = LANGS[lang].locale;
      var result;
      try { result = original.call(this, wanted || undefined, options); } catch (e) { result = original.call(this, loc, options); }
      if (dateLogCount < 3000 && typeof result === "string" && result.length > 3 && !dateLog[result]) {
        dateLog[result] = { time: this.getTime(), name: name, options: options };
        dateLogCount++;
      }
      return result;
    };
  });

  function formatDate(entry) {
    var wanted = LANGS[lang].locale || undefined;
    var proto = Date.prototype[entry.name];
    try { return proto.call(new Date(entry.time), wanted, entry.options); } catch (e) { return null; }
  }

  var redate = false;
  // Rewrites any remembered date inside a piece of text into the current language's format.
  function reDateStr(text) {
    if (!redate || !/\d/.test(text)) return text;
    var keys = Object.keys(dateLog).sort(function (a, b) { return b.length - a.length; });
    var next = text;
    for (var i = 0; i < keys.length; i++) {
      if (next.indexOf(keys[i]) === -1) continue;
      var fresh = formatDate(dateLog[keys[i]]);
      if (fresh && fresh !== keys[i]) {
        next = next.split(keys[i]).join(fresh);
        if (!dateLog[fresh]) dateLog[fresh] = dateLog[keys[i]];
      }
    }
    return next;
  }

  function refreshDates() {
    var keys = Object.keys(dateLog);
    if (!keys.length || !document.body) return;
    // Longest first so "5 Nov 2026, 12:00" is matched before "12:00".
    keys.sort(function (a, b) { return b.length - a.length; });
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var node;
    var changes = [];
    while ((node = walker.nextNode())) {
      var value = node.nodeValue;
      if (!/\d/.test(value)) continue;
      var next = value;
      for (var i = 0; i < keys.length; i++) {
        if (next.indexOf(keys[i]) === -1) continue;
        var fresh = formatDate(dateLog[keys[i]]);
        if (fresh && fresh !== keys[i]) {
          next = next.split(keys[i]).join(fresh);
          if (!dateLog[fresh]) { dateLog[fresh] = dateLog[keys[i]]; }
        }
      }
      if (next !== value) changes.push([node, next]);
    }
    changes.forEach(function (c) { c[0].nodeValue = c[1]; });
  }

  ["alert", "confirm", "prompt"].forEach(function (name) {
    var original = window[name];
    if (typeof original !== "function") return;
    window[name] = function (message) {
      var args = Array.prototype.slice.call(arguments);
      if (lang !== "en" && typeof message === "string") {
        var out = lookup(norm(message), lang);
        if (out != null) args[0] = out;
      }
      return original.apply(window, args);
    };
  });

  // ---------- Switcher ----------
  var switchers = [];

  var css = [
    ".rr-lang { position: relative; display: inline-flex; align-items: center; margin: 0 6px; flex: none; }",
    ".rr-lang select { appearance: none; -webkit-appearance: none; font: inherit; font-size: 13px; font-weight: 700; line-height: 1;",
    "  padding: 8px 24px 8px 12px; border: 1px solid rgba(120, 140, 170, 0.45); border-radius: 999px; cursor: pointer;",
    "  background: #fff url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M1 1l4 4 4-4' fill='none' stroke='%235d6c84' stroke-width='1.6' stroke-linecap='round'/></svg>\") no-repeat right 9px center; color: #10203f; }",
    ".rr-lang select:focus-visible { outline: 2px solid #2f7cf6; outline-offset: 2px; }",
    ".rr-lang-float { position: fixed; z-index: 60; bottom: 14px; right: 14px; margin: 0; }",
    "@media print { .rr-lang { display: none; } }",
    ".rr-lang-float select { box-shadow: 0 6px 18px rgba(16, 32, 63, 0.18); }",
    "@media (max-width: 520px) { .rr-lang { margin: 0 4px; } .rr-lang select { padding-top: 7px; padding-bottom: 7px; padding-left: 10px; font-size: 12.5px; } }",
    // Long German and French words may wrap instead of pushing the layout wider.
    "html[lang=de] body, html[lang=fr] body { overflow-wrap: break-word; }"
  ].join("\n");

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
      select.appendChild(option);
    });
    select.value = lang;
    select.addEventListener("change", function () { setLanguage(select.value); });
    switchers.push(select);
    wrap.appendChild(select);
    return wrap;
  }

  function placeSwitcher() {
    if (document.querySelector(".rr-lang")) return;
    var style = document.createElement("style");
    style.id = "rr-i18n-style";
    style.textContent = css;
    document.head.appendChild(style);
    // One small floating menu in the bottom corner. It is fixed in place, so it can never move or
    // resize anything that is already on the page.
    var floating = buildSwitcher();
    floating.classList.add("rr-lang-float");
    document.body.appendChild(floating);
  }

  // Legal texts are only published in English; say so instead of showing a half-translated page.
  function legalNote() {
    if (!/\/(privacy|terms)\.html$/i.test(window.location.pathname)) return;
    var existing = document.getElementById("rr-legal-note");
    if (lang === "en") { if (existing) existing.remove(); return; }
    var main = document.querySelector("main") || document.body;
    var note = existing || document.createElement("p");
    note.id = "rr-legal-note";
    note.setAttribute("data-no-i18n", "");
    note.style.cssText = "margin:0 0 16px;padding:12px 14px;border-radius:12px;background:#eef4ff;color:#10203f;font-size:14px;";
    note.textContent = lang === "fr"
      ? "Ce document juridique est disponible uniquement en anglais."
      : "Dieses Rechtsdokument ist nur auf Englisch verfügbar.";
    if (!existing) main.insertBefore(note, main.firstChild);
  }

  // ---------- Applying a language ----------
  function applyAll() {
    root.setAttribute("lang", lang);
    redate = true;
    if (document.body) walk(document.body);
    redate = false;
    applyTitle();
    legalNote();
    refreshDates();
    switchers.forEach(function (select) { select.value = lang; });
  }

  function setLanguage(next) {
    if (!LANGS[next] || next === lang) return;
    loadDict(next, function () {
      lang = next;
      try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
      if (next !== "en") observe();
      applyAll();
      window.dispatchEvent(new CustomEvent("rr-language-changed", { detail: { lang: next } }));
    });
  }

  window.ReviewRiseLang = {
    get current() { return lang; },
    set: setLanguage,
    translate: function (text) { var out = lang === "en" ? null : lookup(norm(text), lang); return out == null ? text : out; }
  };

  // ---------- Start ----------
  root.setAttribute("lang", lang);
  if (lang !== "en") {
    // Load the dictionary now, before the page is drawn, and translate while the page is being built.
    document.write('<script src="' + base + "i18n-" + lang + '.js"><\/script>');
    observe();
  }

  function ready() {
    placeSwitcher();
    if (lang !== "en") { applyAll(); observe(); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
  window.addEventListener("load", function () { if (lang !== "en") applyTitle(); });
})();
