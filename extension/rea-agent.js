// RE-Poo — realestate.com.au map agent (experimental).
// Runs in the page's MAIN world at document_idle. REA map markers carry
// lat/lng and the listing id in their DOM ids (BuyMapIndividual_<lat>_<lng>_
// <id>), so pins for known villages are marked straight from the shared
// registry the moment the map renders — no data access needed. Listing
// metadata is harvested opportunistically from REA's lexa GraphQL responses
// (fetch/XHR observers) as the user pans and zooms; the page-load mexa call
// is not interceptable usefully (it 401s / retries out of reach), which is
// why the observers deliberately install late — after Kasada has settled —
// rather than at document_start.
(function () {
  let rules = null; // includes registry points (pts) from content.js
  let flaggedIds = new Set();

  // Wider than Domain's 175m: REA and Domain geocode the same park a couple
  // of hundred metres apart (observed: 236m for 33 Karalta Rd), so cross-site
  // matching needs slack. One vote suffices (vs two for card hiding) — a
  // wrongly-marked pin is visible and harmless in a way a wrongly-hidden
  // card is not.
  const GEO_RADIUS_M = 250;
  const GEO_MIN_VOTES = 1;

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
    if (!document.head) return; // runs at document_start; head arrives shortly
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
      button.wrh-rea-poop span.wrh-poop-pin.wrh-has-count {
        font-size: 13px; font-weight: 700; color: #fff;
        text-shadow: 0 1px 2px rgba(0,0,0,0.7);
      }
      button.wrh-rea-flagged span { color: #fff !important; }
    `;
    document.head.appendChild(style);
  }

  function setMarkerStyle(btn, flagged) {
    const poop = rules.pinStyle === "poop";
    btn.classList.toggle("wrh-rea-flagged", flagged && !poop);
    btn.classList.toggle("wrh-rea-poop", flagged && poop);
    let s = btn.querySelector("span.wrh-poop-pin");
    if (flagged && poop) {
      // Cluster pins carry a bundled-listing count — keep it visible
      // ("💩33"), it's useful intel about how big the park is.
      const countEl = btn.querySelector("div span:not(.wrh-poop-pin)");
      const count = countEl ? countEl.textContent.trim() : "";
      const label = count ? "\u{1F4A9}" + count : "\u{1F4A9}";
      if (!s) {
        s = document.createElement("span");
        s.className = "wrh-poop-pin";
        btn.appendChild(s);
      }
      if (s.textContent !== label) s.textContent = label;
      s.classList.toggle("wrh-has-count", !!count);
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
      // propertyType may be a string or an object like
      // {id: "retirement", display: "Retirement Living"}.
      const ptRaw = o.propertyType ?? o.propertyTypeDisplay;
      const pt =
        typeof ptRaw === "string"
          ? ptRaw
          : ptRaw && typeof ptRaw === "object"
            ? String(ptRaw.display ?? ptRaw.id ?? "")
            : "";
      if (id != null && pt) {
        const addr = o.address;
        found.push({
          id: String(id),
          propertyType: pt,
          street:
            typeof addr === "string"
              ? addr
              : (addr &&
                  (addr.streetAddress ||
                    (addr.display &&
                      (addr.display.shortAddress || addr.display.fullAddress)))) ||
                "",
          suburb:
            (addr && typeof addr === "object" && (addr.suburb || addr.locality)) ||
            o.suburb ||
            "",
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
    if (found.length) sendHarvest(found.slice(0, 500));
    return found.length;
  }

  // The agent runs at document_start but content.js only listens from
  // document_idle — postMessage is fire-and-forget, so harvests from the
  // page-load API responses must be buffered until the rules handshake
  // proves content.js is awake.
  let contentReady = false;
  let pendingHarvest = [];

  // Diagnostics, readable from the page console as window.__wrhReaDebug.
  const dbg = {
    fetchSeen: 0,
    xhrSeen: 0,
    harvested: 0,
    buffered: 0,
    flushedAt: null,
    rulesAt: null,
    ptsCount: 0,
    flaggedIdCount: 0,
    reqs: [] // last 30 intercepted requests: {t, u, json, found}
  };
  window.__wrhReaDebug = dbg;

  function trackReq(type, url) {
    const rec = { t: type, u: String(url).slice(0, 140), json: false, found: 0 };
    dbg.reqs.push(rec);
    if (dbg.reqs.length > 30) dbg.reqs.shift();
    return rec;
  }

  // Debug: keep a snippet of REA-host JSON responses the walker found no
  // records in, so unknown schemas (mexa) can be adapted.
  dbg.samples = [];
  function sampleMiss(rec, json) {
    if (rec.found === 0 && /realestate\.com\.au/.test(rec.u) && dbg.samples.length < 3) {
      try {
        dbg.samples.push({ u: rec.u, body: JSON.stringify(json).slice(0, 3000) });
      } catch (e) {}
    }
  }

  function sendHarvest(listings) {
    dbg.harvested += listings.length;
    if (!contentReady) {
      pendingHarvest.push(...listings);
      dbg.buffered = pendingHarvest.length;
      if (pendingHarvest.length > 2000) {
        pendingHarvest = pendingHarvest.slice(-2000);
      }
      return;
    }
    window.postMessage(
      { type: "wrh-rea-listings", listings },
      window.location.origin
    );
  }

  const API_URL_RE = /lexa|graphql|listing|map|search/i;

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);
    try {
      const url = String(
        typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || ""
      );
      if (API_URL_RE.test(url)) {
        dbg.fetchSeen++;
        const rec = trackReq("fetch", url);
        p.then((res) => {
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("json")) {
            rec.json = true;
            res
              .clone()
              .json()
              .then((j) => {
                rec.found = harvest(j);
                sampleMiss(rec, j);
              })
              .catch(() => {});
          }
        }).catch(() => {});
      }
    } catch (e) {}
    return p;
  };

  const origXhrOpen = XMLHttpRequest.prototype.open;
  const origXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__wrhUrl = String(url || "");
    return origXhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (API_URL_RE.test(this.__wrhUrl || "")) {
      dbg.xhrSeen++;
      const rec = trackReq("xhr", this.__wrhUrl);
      this.addEventListener("load", () => {
        try {
          if (this.responseType === "json" && this.response) {
            rec.json = true;
            rec.found = harvest(this.response);
            sampleMiss(rec, this.response);
          } else if (
            (this.responseType === "" || this.responseType === "text") &&
            typeof this.responseText === "string" &&
            (this.responseText.startsWith("{") || this.responseText.startsWith("["))
          ) {
            rec.json = true;
            const parsed = JSON.parse(this.responseText);
            rec.found = harvest(parsed);
            sampleMiss(rec, parsed);
          } else {
            rec.json = "skipped:" + (this.responseType || "text-nonjson");
          }
        } catch (e) {
          rec.json = "error";
        }
      });
    }
    return origXhrSend.apply(this, args);
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
      dbg.rulesAt = Date.now();
      dbg.ptsCount = Array.isArray(rules.pts) ? rules.pts.length : 0;
      if (!contentReady) {
        contentReady = true;
        if (pendingHarvest.length) {
          dbg.flushedAt = Date.now();
          sendHarvest(pendingHarvest.splice(0, pendingHarvest.length));
          dbg.buffered = 0;
        }
      }
      scan();
    } else if (event.data.type === "wrh-deep-ids" && Array.isArray(event.data.ids)) {
      flaggedIds = new Set(event.data.ids.map(String));
      dbg.flaggedIdCount = flaggedIds.size;
      scan();
    }
  });

  window.postMessage({ type: "wrh-get-rules" }, window.location.origin);
})();
