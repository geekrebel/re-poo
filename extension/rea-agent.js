// RE-Poo — realestate.com.au map agent (experimental).
// Runs in the page's MAIN world. REA map markers carry lat/lng and the
// listing id in their DOM ids (BuyMapIndividual_<lat>_<lng>_<id>), so pins
// can be marked straight from the shared village registry — villages learned
// while browsing Domain flag REA pins with no data fetching at all.
// Additionally, JSON responses from REA's own data APIs are observed via a
// fetch wrapper to learn REA-side retirement listings, which content.js
// folds back into the registry.
(function () {
  let rules = null; // includes registry points (pts) from content.js
  let flaggedIds = new Set();

  const GEO_RADIUS_M = 175;
  const GEO_MIN_VOTES = 2;

  function nearRegistry(lat, lng) {
    if (!rules || !Array.isArray(rules.pts) || rules.pts.length < GEO_MIN_VOTES) {
      return false;
    }
    const cosLat = Math.cos((lat * Math.PI) / 180);
    let votes = 0;
    for (const p of rules.pts) {
      if (!Array.isArray(p)) continue;
      const dx = (p[1] - lng) * 111320 * cosLat;
      const dy = (p[0] - lat) * 110574;
      if (dx * dx + dy * dy <= GEO_RADIUS_M * GEO_RADIUS_M) {
        votes++;
        if (votes >= GEO_MIN_VOTES) return true;
      }
    }
    return false;
  }

  function ensureStyles() {
    if (document.getElementById("wrh-rea-styles")) return;
    const style = document.createElement("style");
    style.id = "wrh-rea-styles";
    style.textContent = `
      button.wrh-rea-flagged > div {
        background: #a10000 !important;
        border-color: #a10000 !important;
      }
      button.wrh-rea-poop > div { visibility: hidden; }
      button.wrh-rea-poop { position: relative; }
      button.wrh-rea-poop span.wrh-poop-pin {
        position: absolute; inset: 0; display: flex;
        align-items: center; justify-content: center;
        font-size: 18px; visibility: visible; pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  function setMarkerStyle(btn, flagged) {
    const poop = rules.pinStyle === "poop";
    btn.classList.toggle("wrh-rea-flagged", flagged && !poop);
    btn.classList.toggle("wrh-rea-poop", flagged && poop);
    let s = btn.querySelector("span.wrh-poop-pin");
    if (flagged && poop) {
      if (!s) {
        s = document.createElement("span");
        s.className = "wrh-poop-pin";
        s.textContent = "\u{1F4A9}";
        btn.appendChild(s);
      }
    } else if (s) {
      s.remove();
    }
  }

  const MARKER_ID_RE =
    /^BuyMap(?:Individual|Cluster)_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)_(\d+)/;

  function scan() {
    if (!rules) return;
    ensureStyles();
    for (const btn of document.querySelectorAll(
      'button[id^="BuyMapIndividual_"], button[id^="BuyMapCluster_"]'
    )) {
      const m = btn.id.match(MARKER_ID_RE);
      if (!m) continue;
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      const id = m[3];
      const flagged = flaggedIds.has(id) || nearRegistry(lat, lng);
      setMarkerStyle(btn, !!rules.colorMapPins && flagged);
    }
  }

  // ---------- API response observation ----------
  // The map page has no embedded listing data; it arrives via client fetches.
  // Watch JSON responses for listing-shaped objects and forward a minimal
  // record to content.js. Read-only: responses are cloned, never modified.

  function harvest(json) {
    const found = [];
    (function walk(o, depth) {
      if (!o || typeof o !== "object" || depth > 12 || found.length >= 500) return;
      if (Array.isArray(o)) {
        for (const v of o) walk(v, depth + 1);
        return;
      }
      const id = o.listingId ?? o.id;
      const pt = o.propertyType;
      if (id != null && typeof pt === "string") {
        found.push({
          id: String(id),
          propertyType: pt,
          text: [o.name, o.title, o.headline, o.description]
            .filter((x) => typeof x === "string")
            .join(" ")
            .slice(0, 500),
          lat:
            o.lat ??
            o.latitude ??
            o.location?.latitude ??
            o.address?.location?.latitude,
          lng:
            o.lon ??
            o.lng ??
            o.longitude ??
            o.location?.longitude ??
            o.address?.location?.longitude
        });
      }
      for (const v of Object.values(o)) walk(v, depth + 1);
    })(json, 0);
    if (found.length) {
      window.postMessage(
        { type: "wrh-rea-listings", listings: found.slice(0, 500) },
        window.location.origin
      );
    }
  }

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);
    try {
      const url = String(
        typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || ""
      );
      if (/lexa|graphql|listing|map|search/i.test(url)) {
        p.then((res) => {
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("json")) {
            res.clone().json().then(harvest).catch(() => {});
          }
        }).catch(() => {});
      }
    } catch (e) {}
    return p;
  };

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 150);
  }

  new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  setInterval(() => {
    if (!document.hidden) scan();
  }, 1500);

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || typeof event.data !== "object") return;
    if (event.data.type === "wrh-rules" && event.data.rules) {
      rules = event.data.rules;
      scan();
    } else if (event.data.type === "wrh-deep-ids" && Array.isArray(event.data.ids)) {
      flaggedIds = new Set(event.data.ids.map(String));
      scan();
    }
  });

  window.postMessage({ type: "wrh-get-rules" }, window.location.origin);
})();
