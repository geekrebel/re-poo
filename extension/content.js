// RE-Poo — Real Estate Search Helper
// 1. Hides listing cards matching exclusion rules — Domain's own per-listing
//    isRetirement flag (which catches retirement villas "disguised" as Houses),
//    plus visible-text keywords as a fallback.
// 2. Appends an approximate monthly figure to weekly rent prices,
//    e.g. "$900 per week" -> "$900 per week (≈ $3,900/mo)".
// Works with map-agent.js (MAIN world), which colours map pins for flagged
// listings and reports their ids back here.
(function () {
  const DEFAULTS = {
    hideRetirement: true,
    extraKeywords: [],
    showMonthly: true,
    colorMapPins: true,
    pinStyle: "red", // "red" | "poop"
    deepScan: true
  };

  const HIDDEN_CLASS = "wrh-hidden";
  const MARKER = " (≈ ";
  const ANNOTATION_RE = / \(≈ \$[\d,]+\/mo\)/g;

  let settings = { ...DEFAULTS };

  const hasExtensionStorage =
    typeof chrome !== "undefined" && !!chrome.storage && !!chrome.storage.sync;

  // ---------- exclusion keywords ----------

  function cleanKeywords() {
    return (settings.extraKeywords || [])
      .map((k) => String(k).trim())
      .filter(Boolean);
  }

  function activeKeywords() {
    const words = [];
    if (settings.hideRetirement) words.push("retirement living");
    words.push(...cleanKeywords());
    return words;
  }

  let cachedRe = null;
  let cachedKey = null;
  function keywordRegex() {
    const words = activeKeywords();
    const key = words.join("\n");
    if (key !== cachedKey) {
      cachedKey = key;
      cachedRe = words.length
        ? new RegExp(
            words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
            "i"
          )
        : null;
    }
    return cachedRe;
  }

  // ---------- structured listing data (Domain) ----------
  // Domain marks retirement listings with features.isRetirement even when the
  // displayed property type says "House", so this catches listings the visible
  // text never would.

  let dataFlaggedIds = new Set(); // from the page's __NEXT_DATA__
  let markerFlaggedIds = new Set(); // reported by map-agent.js

  function listingModelFlagged(model) {
    if (!model) return false;
    const features = model.features || {};
    if (settings.hideRetirement) {
      if (features.isRetirement === true) return true;
      if (
        /retirement/i.test(
          String(features.propertyTypeFormatted || features.propertyType || "")
        )
      ) {
        return true;
      }
    }
    const keywords = cleanKeywords();
    if (keywords.length) {
      const hay = JSON.stringify(model).toLowerCase();
      for (const k of keywords) {
        if (hay.includes(k.toLowerCase())) return true;
      }
    }
    return false;
  }

  let lastListingsMap = {};

  function computeDataFlaggedIds() {
    dataFlaggedIds = new Set();
    lastListingsMap = {};
    try {
      const nd = document.getElementById("__NEXT_DATA__");
      if (!nd) return;
      const data = JSON.parse(nd.textContent);
      lastListingsMap =
        data?.props?.pageProps?.componentProps?.listingsMap || {};
      for (const [id, entry] of Object.entries(lastListingsMap)) {
        if (entry && listingModelFlagged(entry.listingModel)) {
          dataFlaggedIds.add(String(id));
        }
      }
    } catch (e) {
      // Page data not in the expected shape; text-based hiding still applies.
    }
  }

  function hideFlaggedIds() {
    for (const id of [
      ...dataFlaggedIds,
      ...markerFlaggedIds,
      ...deepFlaggedIds,
      ...clusterFlaggedIds
    ]) {
      for (const el of document.querySelectorAll(
        `li[data-testid="listing-${id}"]`
      )) {
        el.classList.add(HIDDEN_CLASS);
      }
    }
  }

  // ---------- deep scan of listing descriptions (Domain) ----------
  // Land-lease / over-55 villages (Pine Needles, GreenLife, Kincumber
  // Nautical Village, ...) are often listed as a plain "House" with
  // isRetirement=false; the only reliable tell is the listing description.
  // The extracted text is cached, so each listing is fetched at most once and
  // keyword changes re-evaluate without refetching.

  const DEEP_PHRASES =
    /land[\s-]*lease|over[\s-]*5[05]s?\b|55\s*(?:\+|plus)|lifestyle\s+(?:village|community|resort|estate)|retirement\s+(?:village|community|living|resort|estate)|seniors?\s+(?:living|village|community)|rental\s+village|gated\s+community|site\s+(?:fees?|rent)\b/i;

  const deepCache = new Map(); // id -> { t, txt }
  let deepFlaggedIds = new Set();
  const deepQueue = [];
  let deepActive = 0;

  const hasLocalStorageArea =
    hasExtensionStorage && !!chrome.storage.local;

  function loadDeepCache(done) {
    if (!hasLocalStorageArea) {
      done();
      return;
    }
    chrome.storage.local.get({ deepScanCache: {} }, (res) => {
      for (const [id, v] of Object.entries(res.deepScanCache || {})) {
        deepCache.set(id, v);
      }
      done();
    });
  }

  let persistTimer = null;
  function persistDeepCache() {
    if (!hasLocalStorageArea) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      let entries = [...deepCache.entries()];
      if (entries.length > 2000) {
        entries.sort((a, b) => (b[1].t || 0) - (a[1].t || 0));
        entries = entries.slice(0, 2000);
        deepCache.clear();
        for (const [k, v] of entries) deepCache.set(k, v);
      }
      chrome.storage.local.set({ deepScanCache: Object.fromEntries(deepCache) });
    }, 1000);
  }

  function deepEvaluate(id) {
    const entry = deepCache.get(String(id));
    if (!entry || !entry.txt) return false;
    if (DEEP_PHRASES.test(entry.txt)) return true;
    for (const k of cleanKeywords()) {
      if (entry.txt.includes(k.toLowerCase())) return true;
    }
    return false;
  }

  function recomputeDeepFlagged() {
    deepFlaggedIds = new Set();
    if (!settings.deepScan) return;
    for (const id of deepCache.keys()) {
      if (deepEvaluate(id)) deepFlaggedIds.add(String(id));
    }
  }

  // ---------- village address clustering ----------
  // Parks hide individual listings behind euphemisms ("relaxed villa living")
  // but share one base street address. Once any listing at "61 Karalta Road"
  // is identified as a village, every unit-style listing at that address is
  // flagged too.

  let clusterFlaggedIds = new Set();

  // Unit-style listings ("41/33 Karalta Road") cluster on the shared base
  // address. Standalone-looking listings cluster on street+suburb, because
  // parks like Kincumber Nautical Village name their own internal streets
  // ("1 Thomas Gilbert Place") — one flagged listing marks the street. The two
  // key spaces are kept separate so a flagged village at "61 Karalta Rd" does
  // not taint standalone houses elsewhere on Karalta Rd.
  function baseAddressKey(model) {
    const street = String(model?.address?.street || "");
    const suburb = String(model?.address?.suburb || "").trim().toLowerCase();
    if (!street) return null;
    if (street.includes("/")) {
      const base = street
        .split("/")
        .pop()
        .split(",")[0]
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
      return base ? { key: base + "|" + suburb, unit: true } : null;
    }
    const base = street
      .split(",")[0]
      .trim()
      .toLowerCase()
      .replace(/^\d+[a-z]?\s+/, "") // strip the street number
      .replace(/\s+/g, " ");
    return base ? { key: base + "|" + suburb, unit: false } : null;
  }

  // Geographic clustering: multi-street parks (e.g. Broadlands Green Point
  // spans First/Second/Third/Frangipani Avenues off Milpera Rd) defeat
  // street-name keys. A listing within GEO_RADIUS_M of at least two flagged
  // listings is inside the park; requiring two votes protects normal houses
  // across the road from a park boundary.
  const GEO_RADIUS_M = 175;
  const GEO_MIN_VOTES = 2;

  function nearFlaggedPoints(addr, flaggedPts) {
    if (!addr || typeof addr.lat !== "number" || typeof addr.lng !== "number") {
      return false;
    }
    const cosLat = Math.cos((addr.lat * Math.PI) / 180);
    let votes = 0;
    for (const [lat, lng] of flaggedPts) {
      const dx = (lng - addr.lng) * 111320 * cosLat;
      const dy = (lat - addr.lat) * 110574;
      if (dx * dx + dy * dy <= GEO_RADIUS_M * GEO_RADIUS_M) {
        votes++;
        if (votes >= GEO_MIN_VOTES) return true;
      }
    }
    return false;
  }

  // ---------- persistent village registry ----------
  // Flagged villages are remembered across sessions: once any listing at a
  // base address (or coordinate) is flagged by strong evidence — Domain's
  // isRetirement flag or a description match — the whole park stays known,
  // even when later listings there are pure euphemism. Unit-base keys
  // ("67 koolang road|green point") and street keys ("frangipani avenue|
  // green point") never collide: street keys have their number stripped.
  let savedBases = new Set();
  let savedPts = []; // [lat, lng] of strongly flagged listings
  const savedPtKeys = new Set();

  function ptKey(p) {
    return p[0].toFixed(5) + "," + p[1].toFixed(5);
  }

  function loadRegistry(done) {
    if (!hasLocalStorageArea) {
      done();
      return;
    }
    chrome.storage.local.get({ villageBases: [], villagePts: [] }, (res) => {
      savedBases = new Set(res.villageBases || []);
      savedPts = (res.villagePts || []).filter(
        (p) => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number"
      );
      for (const p of savedPts) savedPtKeys.add(ptKey(p));
      done();
    });
  }

  let registryTimer = null;
  function persistRegistry() {
    if (!hasLocalStorageArea) return;
    clearTimeout(registryTimer);
    registryTimer = setTimeout(() => {
      chrome.storage.local.set({
        villageBases: [...savedBases].slice(-800),
        villagePts: savedPts.slice(-3000)
      });
    }, 1000);
  }

  function recomputeClusters() {
    clusterFlaggedIds = new Set();
    let registryChanged = false;
    // Strongly flagged listings feed the registry (never cluster-inherited
    // ones — that would let one mistake snowball).
    for (const [id, entry] of Object.entries(lastListingsMap)) {
      if (!(dataFlaggedIds.has(String(id)) || deepFlaggedIds.has(String(id)))) continue;
      const model = entry?.listingModel;
      const info = baseAddressKey(model);
      if (info && !savedBases.has(info.key)) {
        savedBases.add(info.key);
        registryChanged = true;
      }
      const addr = model?.address;
      if (addr && typeof addr.lat === "number" && typeof addr.lng === "number") {
        const p = [addr.lat, addr.lng];
        if (!savedPtKeys.has(ptKey(p))) {
          savedPtKeys.add(ptKey(p));
          savedPts.push(p);
          registryChanged = true;
        }
      }
    }
    if (registryChanged) persistRegistry();
    for (const [id, entry] of Object.entries(lastListingsMap)) {
      if (dataFlaggedIds.has(String(id)) || deepFlaggedIds.has(String(id))) continue;
      const model = entry?.listingModel;
      const info = baseAddressKey(model);
      if (info && savedBases.has(info.key)) {
        clusterFlaggedIds.add(String(id));
        continue;
      }
      if (savedPts.length >= GEO_MIN_VOTES && nearFlaggedPoints(model?.address, savedPts)) {
        clusterFlaggedIds.add(String(id));
      }
    }
  }

  const reaFlaggedIds = new Set(); // learned from REA's own API responses

  function broadcastDeepIds() {
    window.postMessage(
      {
        type: "wrh-deep-ids",
        ids: [...deepFlaggedIds, ...clusterFlaggedIds, ...reaFlaggedIds]
      },
      window.location.origin
    );
  }

  function extractListingText(html) {
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return "";
    try {
      const data = JSON.parse(m[1]);
      const listing =
        data?.props?.pageProps?.componentProps?.rootGraphQuery?.listingByIdV2 || {};
      return [listing.headline, listing.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .slice(0, 4000);
    } catch (e) {
      return "";
    }
  }

  // Politeness rules, learned the hard way (Akamai blocks the whole browsing
  // session, not just the extension):
  // - One fetch at a time ACROSS ALL TABS (Web Locks are shared per origin,
  //   so the named lock serialises every Domain tab's scanner).
  // - ~3-4.5s between fetches with jitter (max ~15-20/min total).
  // - Only the visible tab scans; background tabs wait.
  // - On repeated failures, back off for 10 minutes; failures are requeued,
  //   never cached.
  const DEEP_DELAY_MS = 3000;
  const DEEP_JITTER_MS = 1500;
  const DEEP_BACKOFF_MS = 10 * 60 * 1000;
  let deepPausedUntil = 0;
  let deepFailStreak = 0;

  function deepFetchFailed(id, url) {
    deepFailStreak++;
    deepQueue.push({ id: String(id), url });
    if (deepFailStreak >= 3) {
      deepPausedUntil = Date.now() + DEEP_BACKOFF_MS;
    }
  }

  function pumpDeepQueue() {
    if (deepActive >= 1 || !deepQueue.length) return;
    if (document.hidden) return; // resumes on visibilitychange
    const now = Date.now();
    if (now < deepPausedUntil) {
      setTimeout(pumpDeepQueue, deepPausedUntil - now + 100);
      return;
    }
    const { id, url } = deepQueue.shift();
    if (deepCache.has(String(id))) {
      pumpDeepQueue();
      return;
    }
    deepActive++;
    const run = async () => {
      try {
        const r = await fetch(url, { credentials: "same-origin" });
        const html = r.ok ? await r.text() : null;
        if (html === null || html.indexOf('id="__NEXT_DATA__"') === -1) {
          deepFetchFailed(id, url); // rate limited or bot-challenged
        } else {
          deepFailStreak = 0;
          deepCache.set(String(id), { t: Date.now(), txt: extractListingText(html) });
          persistDeepCache();
          if (settings.deepScan && deepEvaluate(id)) {
            deepFlaggedIds.add(String(id));
            recomputeClusters();
            hideFlaggedIds();
            updatePill();
            broadcastDeepIds();
          }
        }
      } catch (e) {
        deepFetchFailed(id, url);
      }
      // Hold the cross-tab lock through the cooldown so the global rate
      // stays capped no matter how many tabs are open.
      await new Promise((resolve) =>
        setTimeout(resolve, DEEP_DELAY_MS + Math.random() * DEEP_JITTER_MS)
      );
    };
    const locked =
      navigator.locks && navigator.locks.request
        ? navigator.locks.request("wrh-deep-fetch", run)
        : run();
    Promise.resolve(locked).finally(() => {
      deepActive--;
      pumpDeepQueue();
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pumpDeepQueue();
  });

  function queueDeepScans() {
    if (!settings.deepScan) return;
    // Every listing is scanned: parks like Kincumber Nautical Village give
    // homes standalone-looking addresses on internal streets. Unit-style
    // addresses go first (far likelier to be villages); the cache means each
    // listing is fetched at most once, ever.
    const units = [];
    const others = [];
    for (const [id, entry] of Object.entries(lastListingsMap)) {
      const model = entry?.listingModel || {};
      if (dataFlaggedIds.has(String(id))) continue; // already excluded
      if (deepCache.has(String(id))) continue; // cached
      if (!model.url) continue;
      const item = { id: String(id), url: model.url };
      (String(model.address?.street || "").includes("/") ? units : others).push(item);
    }
    deepQueue.push(...units, ...others);
    pumpDeepQueue();
  }

  // ---------- hiding listing cards by visible text ----------

  function findCard(el) {
    // Domain wraps every search result in li[data-testid="listing-<id>"].
    const exact = el.closest('li[data-testid^="listing-"]');
    if (exact) return exact;
    // Fallback for other layouts (REA etc.): a generic card, but only if it
    // looks like a listing (photo + link) so filter-menu options, nav items
    // and the like are never hidden.
    const generic = el.closest("li, article");
    if (generic && generic.querySelector("img") && generic.querySelector("a[href]")) {
      return generic;
    }
    return null;
  }

  function hidePass(root) {
    const re = keywordRegex();
    if (!re) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !re.test(node.nodeValue)) continue;
      const card = node.parentElement && findCard(node.parentElement);
      if (card) card.classList.add(HIDDEN_CLASS);
    }
  }

  function unhideAll() {
    for (const el of document.querySelectorAll("." + HIDDEN_CLASS)) {
      el.classList.remove(HIDDEN_CLASS);
    }
  }

  // ---------- weekly -> monthly annotation ----------

  // Matches "$900 per week", "$1,200 per week", "$650pw", "$650 p.w.",
  // "$650 p/w", "650/week", "$650 weekly".
  const weeklyRentRegex =
    /\$?\s*(\d{1,3}(?:,\d{3})+|\d{2,5})\s*(?:per\s*week|p\.w\.?|p\/w|pw\b|\/\s*w(?:ee)?k\b|weekly\b)/gi;

  // Cheap pre-check so the tree walk skips most nodes without running
  // the full (global, stateful) regex.
  const quickTest = /per\s*week|p\.w|p\/w|pw\b|\/\s*w(?:ee)?k\b|weekly\b/i;

  const formatAUD = (value) =>
    value.toLocaleString("en-AU", {
      style: "currency",
      currency: "AUD",
      maximumFractionDigits: 0
    });

  function annotate(text) {
    weeklyRentRegex.lastIndex = 0;
    return text.replace(weeklyRentRegex, (match, amount, offset, whole) => {
      // Already annotated (also stops the MutationObserver reacting to our own edit).
      if (whole.startsWith(MARKER, offset + match.length)) return match;
      const weekly = parseInt(amount.replace(/,/g, ""), 10);
      if (!weekly) return match;
      return `${match}${MARKER}${formatAUD(Math.round((weekly * 52) / 12))}/mo)`;
    });
  }

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"]);

  function isSkippable(node) {
    const parent = node.parentNode;
    if (!parent) return true;
    if (SKIP_TAGS.has(parent.nodeName)) return true;
    if (parent.isContentEditable) return true;
    return false;
  }

  function annotateTextNode(node) {
    const text = node.nodeValue;
    if (!text || !quickTest.test(text) || isSkippable(node)) return;
    const newText = annotate(text);
    if (newText !== text) node.nodeValue = newText;
  }

  function annotatePass(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) annotateTextNode(node);
  }

  function deannotatePass(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue;
      if (!text || !text.includes(MARKER)) continue;
      ANNOTATION_RE.lastIndex = 0;
      const cleaned = text.replace(ANNOTATION_RE, "");
      if (cleaned !== text) node.nodeValue = cleaned;
    }
  }

  // ---------- counter pill ----------

  function ensureStyles() {
    if (document.getElementById("wrh-styles")) return;
    const style = document.createElement("style");
    style.id = "wrh-styles";
    style.textContent = `
      .${HIDDEN_CLASS} { display: none !important; }
      html.wrh-reveal .${HIDDEN_CLASS} {
        display: revert !important;
        opacity: 0.45;
        outline: 3px dashed #cc6600;
      }
      #wrh-pill {
        position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
        background: #0b7e36; color: #fff; font: 13px/1.4 system-ui, sans-serif;
        padding: 8px 14px; border-radius: 999px; cursor: pointer;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); user-select: none;
      }
    `;
    document.head.appendChild(style);
  }

  function updatePill() {
    const count = document.querySelectorAll("." + HIDDEN_CLASS).length;
    let pill = document.getElementById("wrh-pill");
    if (!count) {
      document.documentElement.classList.remove("wrh-reveal");
      if (pill) pill.remove();
      return;
    }
    if (!pill) {
      pill = document.createElement("div");
      pill.id = "wrh-pill";
      pill.title = "Listings hidden by RE-Poo. Click to peek.";
      pill.addEventListener("click", () =>
        document.documentElement.classList.toggle("wrh-reveal")
      );
      document.body.appendChild(pill);
    }
    const label = `${count} listing${count === 1 ? "" : "s"} hidden — click to peek`;
    if (pill.textContent !== label) pill.textContent = label;
  }

  // ---------- bridge to map-agent.js (MAIN world) ----------

  function broadcastRules() {
    window.postMessage(
      {
        type: "wrh-rules",
        rules: {
          colorMapPins: settings.colorMapPins,
          pinStyle: settings.pinStyle,
          hideRetirement: settings.hideRetirement,
          keywords: cleanKeywords(),
          // Registry coordinates let the REA agent mark pins purely by
          // proximity to villages learned on Domain (and vice versa).
          pts: savedPts.slice(-500)
        }
      },
      window.location.origin
    );
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || typeof event.data !== "object") return;
    if (event.data.type === "wrh-get-rules") {
      broadcastRules();
      broadcastDeepIds();
    } else if (event.data.type === "wrh-flagged-ids" && Array.isArray(event.data.ids)) {
      for (const id of event.data.ids) markerFlaggedIds.add(String(id));
      hideFlaggedIds();
      updatePill();
    } else if (
      event.data.type === "wrh-marker-listings" &&
      Array.isArray(event.data.listings)
    ) {
      // Listings discovered by map panning — merge them so the deep scan and
      // clustering cover them too (the page's __NEXT_DATA__ never updates).
      let changed = false;
      for (const item of event.data.listings) {
        if (!item || item.id == null || typeof item.listingModel !== "object") continue;
        const id = String(item.id);
        if (id in lastListingsMap) continue;
        lastListingsMap[id] = { listingModel: item.listingModel };
        if (listingModelFlagged(item.listingModel)) dataFlaggedIds.add(id);
        changed = true;
      }
      if (changed) {
        recomputeClusters();
        hideFlaggedIds();
        updatePill();
        broadcastDeepIds();
        queueDeepScans();
      }
    } else if (
      event.data.type === "wrh-rea-listings" &&
      Array.isArray(event.data.listings)
    ) {
      // REA API records observed by rea-agent.js. Flag retirement-ish ones —
      // by property type/text, by user keyword, or by a base address already
      // burned in the registry (REA types Pine Needles units as plain
      // "House"/"Villa", but their addresses still say 61 Karalta Road) —
      // and fold their addresses and coordinates back into the registry.
      const re =
        /retirement|over\s*-?\s*5[05]|land\s*lease|lifestyle\s+(?:village|community|resort|estate)|rental\s+village/i;
      const keywords = cleanKeywords();
      let changed = false;
      for (const item of event.data.listings) {
        if (!item || item.id == null) continue;
        const hay =
          String(item.propertyType || "") +
          " " +
          String(item.text || "") +
          " " +
          String(item.street || "");
        const kwHit = keywords.some((k) =>
          hay.toLowerCase().includes(k.toLowerCase())
        );
        const info = baseAddressKey({
          address: {
            street: String(item.street || ""),
            suburb: String(item.suburb || "")
          }
        });
        const contentHit =
          (settings.hideRetirement && re.test(hay)) || kwHit;
        const baseHit =
          settings.hideRetirement && info && savedBases.has(info.key);
        if (!contentHit && !baseHit) continue;
        const id = String(item.id);
        if (!reaFlaggedIds.has(id)) {
          reaFlaggedIds.add(id);
          changed = true;
        }
        // Strong (content) hits teach the registry their base address, so
        // future plain-typed siblings match by address on either site.
        if (contentHit && info && !savedBases.has(info.key)) {
          savedBases.add(info.key);
          persistRegistry();
          changed = true;
        }
        if (typeof item.lat === "number" && typeof item.lng === "number") {
          const p = [item.lat, item.lng];
          if (!savedPtKeys.has(ptKey(p))) {
            savedPtKeys.add(ptKey(p));
            savedPts.push(p);
            persistRegistry();
            changed = true;
          }
        }
      }
      if (changed) {
        broadcastDeepIds();
        broadcastRules(); // refresh the agent's registry points
      }
    }
  });

  // ---------- orchestration ----------

  function applyAll() {
    ensureStyles();
    unhideAll();
    markerFlaggedIds.clear(); // map-agent re-reports under the current rules
    computeDataFlaggedIds();
    recomputeDeepFlagged();
    recomputeClusters();
    hidePass(document.body);
    hideFlaggedIds();
    if (settings.showMonthly) {
      annotatePass(document.body);
    } else {
      deannotatePass(document.body);
    }
    updatePill();
    broadcastRules();
    broadcastDeepIds();
    queueDeepScans();
  }

  function handleTextNode(node) {
    if (settings.showMonthly) annotateTextNode(node);
    const re = keywordRegex();
    if (re && node.nodeValue && re.test(node.nodeValue)) {
      const card = node.parentElement && findCard(node.parentElement);
      if (card) card.classList.add(HIDDEN_CLASS);
    }
  }

  // Re-run for content added later (SPA navigation, infinite scroll, re-renders).
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        handleTextNode(mutation.target);
      } else {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            handleTextNode(node);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            hidePass(node);
            if (settings.showMonthly) annotatePass(node);
          }
        }
      }
    }
    hideFlaggedIds();
    updatePill();
  });

  function start() {
    loadDeepCache(() => {
      loadRegistry(() => {
        applyAll();
        observer.observe(document.body, {
          childList: true,
          characterData: true,
          subtree: true
        });
      });
    });
  }

  if (hasExtensionStorage) {
    chrome.storage.sync.get(DEFAULTS, (loaded) => {
      settings = { ...DEFAULTS, ...loaded };
      start();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local") {
        // Registry updates from other tabs — e.g. a Domain tab learning a
        // village should light up an already-open REA tab, and vice versa.
        let touched = false;
        if (changes.villagePts) {
          for (const p of changes.villagePts.newValue || []) {
            if (
              Array.isArray(p) &&
              typeof p[0] === "number" &&
              typeof p[1] === "number" &&
              !savedPtKeys.has(ptKey(p))
            ) {
              savedPtKeys.add(ptKey(p));
              savedPts.push(p);
              touched = true;
            }
          }
        }
        if (changes.villageBases) {
          for (const b of changes.villageBases.newValue || []) {
            if (!savedBases.has(b)) {
              savedBases.add(b);
              touched = true;
            }
          }
        }
        if (touched) {
          recomputeClusters();
          hideFlaggedIds();
          updatePill();
          broadcastDeepIds();
          broadcastRules();
        }
        return;
      }
      if (area !== "sync") return;
      for (const [key, change] of Object.entries(changes)) {
        if (key in settings) settings[key] = change.newValue;
      }
      applyAll();
    });
  } else {
    // No extension context (e.g. injected for testing): run with defaults.
    start();
  }
})();
