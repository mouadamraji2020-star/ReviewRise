// Anonymous page counter for the owner's Admin page (public pages only).
// No cookies, no names. Respects "Do Not Track". Skipped for the owner's own browser (set by the Admin page).
(function () {
  try {
    if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return;
    if (localStorage.getItem("rr_no_track") === "1") return;
  } catch (e) {}
  if (!/^https?:$/.test(location.protocol) || /^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname)) return;
  var url = "https://intlhwmvldxdiytemjlr.supabase.co/rest/v1/rpc/count_page_open";
  // Public (publishable) key: the same one every page of the site already uses.
  var key = "sb_publishable_0KjZZApJCuvTEJH3nNyLUg_aps6aXaA";
  try {
    fetch(url, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", apikey: key },
      body: JSON.stringify({ p_page: location.pathname, p_referrer: document.referrer || null })
    }).catch(function () {});
  } catch (e) {}
})();
