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
        if (exceptionIds.has(String(id))) continue;
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
      ...clusterFlaggedIds,
      ...userVillageIds
    ]) {
      if (exceptionIds.has(String(id))) continue;
      for (const el of document.querySelectorAll(
        `li[data-testid="listing-${id}"]`
      )) {
        el.classList.add(HIDDEN_CLASS);
      }
    }
    for (const key of personalHides.keys()) {
      if (!key.startsWith(SITE + ":")) continue;
      const id = key.slice(SITE.length + 1);
      for (const el of document.querySelectorAll(
        `li[data-testid="listing-${id}"]`
      )) {
        el.classList.add(HIDDEN_CLASS);
        el.classList.add("wrh-hidden-user");
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

  // After the extension is reloaded, this instance is orphaned: chrome.*
  // calls throw "Extension context invalidated". Timers may still fire, so
  // every deferred storage touch checks liveness first.
  function extAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

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
      if (!extAlive()) return;
      // Merge with storage rather than overwrite (same multi-tab race as the
      // registry): adopt entries other tabs cached, then write the union.
      chrome.storage.local.get({ deepScanCache: {} }, (res) => {
        for (const [id, v] of Object.entries(res.deepScanCache || {})) {
          if (!deepCache.has(id)) deepCache.set(id, v);
        }
        let entries = [...deepCache.entries()];
        if (entries.length > 2000) {
          entries.sort((a, b) => (b[1].t || 0) - (a[1].t || 0));
          entries = entries.slice(0, 2000);
          deepCache.clear();
          for (const [k, v] of entries) deepCache.set(k, v);
        }
        chrome.storage.local.set({ deepScanCache: Object.fromEntries(deepCache) });
      });
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
      if (exceptionIds.has(String(id))) continue;
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
      savedBases = new Set((res.villageBases || []).filter((b) => !exceptionBases.has(b)));
      savedPts = (res.villagePts || []).filter(
        (p) =>
          Array.isArray(p) &&
          typeof p[0] === "number" &&
          typeof p[1] === "number" &&
          !nearExceptionPt(p)
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
      if (!extAlive()) return;
      // Merge with storage rather than overwrite: tabs on both sites write
      // concurrently, and last-writer-wins was observed wiping villages that
      // other tabs had learned. User "not a village" corrections are removed
      // from both memory and the written union so they cannot resurrect.
      chrome.storage.local.get({ villageBases: [], villagePts: [] }, (res) => {
        for (const b of res.villageBases || []) {
          if (!exceptionBases.has(b)) savedBases.add(b);
        }
        for (const p of res.villagePts || []) {
          if (
            Array.isArray(p) &&
            typeof p[0] === "number" &&
            typeof p[1] === "number" &&
            !savedPtKeys.has(ptKey(p)) &&
            !nearExceptionPt(p)
          ) {
            savedPtKeys.add(ptKey(p));
            savedPts.push(p);
          }
        }
        chrome.storage.local.set({
          villageBases: [...savedBases].filter((b) => !exceptionBases.has(b)).slice(-800),
          villagePts: savedPts.filter((p) => !nearExceptionPt(p)).slice(-3000)
        });
      });
    }, 1000);
  }

  // ---------- user actions: personal hides, village marks, corrections ----------
  // 🚫 "not for me": hides one listing, teaches nothing. Stored per-site by
  // listing id, with coordinates kept ONLY so the other site can display 🚫
  // on the matching pin — never fed to clustering.
  // 💩 "retirement village": strong evidence, same as a deep-scan hit.
  // "not a retirement village": correction — un-flags the listing and
  // un-teaches its address/coordinates from the registry, permanently.

  const SITE = location.host.includes("realestate") ? "rea" : "domain";
  const personalHides = new Map(); // "<site>:<id>" -> {lat, lng, t}
  const userVillageIds = new Set(); // this site's user-marked village listing ids
  const exceptionIds = new Set();
  const exceptionBases = new Set();
  let exceptionPts = []; // [lat, lng] of corrected listings

  function nearExceptionPt(p) {
    if (!Array.isArray(p) || typeof p[0] !== "number") return false;
    for (const e of exceptionPts) {
      const cosLat = Math.cos((e[0] * Math.PI) / 180);
      const dx = (p[1] - e[1]) * 111320 * cosLat;
      const dy = (p[0] - e[0]) * 110574;
      if (dx * dx + dy * dy <= 50 * 50) return true;
    }
    return false;
  }

  function loadUserData(done) {
    if (!hasLocalStorageArea) {
      done();
      return;
    }
    chrome.storage.local.get(
      { personalHides: {}, userVillages: {}, exceptionIds: [], exceptionBases: [], exceptionPts: [] },
      (res) => {
        for (const [k, v] of Object.entries(res.personalHides || {})) {
          personalHides.set(k, v || {});
        }
        for (const k of Object.keys(res.userVillages || {})) {
          if (String(k).startsWith(SITE + ":")) {
            userVillageIds.add(String(k).slice(SITE.length + 1));
          }
        }
        for (const i of res.exceptionIds || []) exceptionIds.add(String(i));
        for (const b of res.exceptionBases || []) exceptionBases.add(b);
        exceptionPts = (res.exceptionPts || []).filter(
          (p) => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number"
        );
        done();
      }
    );
  }

  let userTimer = null;
  function persistUserData() {
    if (!hasLocalStorageArea) return;
    clearTimeout(userTimer);
    userTimer = setTimeout(() => {
      if (!extAlive()) return;
      chrome.storage.local.get(
        { personalHides: {}, userVillages: {}, exceptionIds: [], exceptionBases: [], exceptionPts: [] },
        (res) => {
          const ph = res.personalHides || {};
          for (const k of Object.keys(ph)) {
            if (k.startsWith(SITE + ":") && !personalHides.has(k)) delete ph[k];
          }
          for (const [k, v] of personalHides) ph[k] = v;
          const uv = res.userVillages || {};
          for (const k of Object.keys(uv)) {
            if (k.startsWith(SITE + ":") && !userVillageIds.has(k.slice(SITE.length + 1))) delete uv[k];
          }
          for (const id of userVillageIds) {
            uv[SITE + ":" + id] = uv[SITE + ":" + id] || { t: Date.now() };
          }
          const exI = new Set((res.exceptionIds || []).map(String));
          for (const i of exceptionIds) exI.add(i);
          const exB = new Set(res.exceptionBases || []);
          for (const b of exceptionBases) exB.add(b);
          const exP = (res.exceptionPts || []).filter(Array.isArray);
          const seenP = new Set(exP.map((p) => p[0].toFixed(5) + "," + p[1].toFixed(5)));
          for (const p of exceptionPts) {
            const k = p[0].toFixed(5) + "," + p[1].toFixed(5);
            if (!seenP.has(k)) {
              seenP.add(k);
              exP.push(p);
            }
          }
          chrome.storage.local.set({
            personalHides: ph,
            userVillages: uv,
            exceptionIds: [...exI].slice(-2000),
            exceptionBases: [...exB].slice(-500),
            exceptionPts: exP.slice(-500)
          });
        }
      );
    }, 500);
  }

  function broadcastPersonal() {
    const ids = [];
    const pts = [];
    for (const [key, v] of personalHides) {
      if (key.startsWith(SITE + ":")) ids.push(key.slice(SITE.length + 1));
      if (v && typeof v.lat === "number" && typeof v.lng === "number") {
        pts.push([v.lat, v.lng]);
      }
    }
    window.postMessage(
      { type: "wrh-personal", ids, pts },
      window.location.origin
    );
  }

  function refreshAfterUserAction() {
    persistUserData();
    recomputeDeepFlagged();
    recomputeClusters();
    unhideAll();
    hidePass(document.body);
    hideFlaggedIds();
    updatePill();
    broadcastRules();
    broadcastDeepIds();
    broadcastPersonal();
  }

  function handleUserAction(action, items) {
    for (const item of items) {
      if (!item || item.id == null) continue;
      const id = String(item.id);
      const key = SITE + ":" + id;
      const hasGeo = typeof item.lat === "number" && typeof item.lng === "number";
      if (action === "hide") {
        personalHides.set(key, { lat: item.lat, lng: item.lng, t: Date.now() });
      } else if (action === "restore") {
        personalHides.delete(key);
      } else if (action === "village") {
        userVillageIds.add(id);
        exceptionIds.delete(id);
        if (hasGeo) {
          const p = [item.lat, item.lng];
          exceptionPts = exceptionPts.filter(
            (e) => e[0].toFixed(5) + "," + e[1].toFixed(5) !== p[0].toFixed(5) + "," + p[1].toFixed(5)
          );
          if (!savedPtKeys.has(ptKey(p))) {
            savedPtKeys.add(ptKey(p));
            savedPts.push(p);
          }
        }
        const model = lastListingsMap[id] && lastListingsMap[id].listingModel;
        const info = model ? baseAddressKey(model) : null;
        if (info) {
          exceptionBases.delete(info.key);
          savedBases.add(info.key);
        }
        persistRegistry();
      } else if (action === "exception") {
        exceptionIds.add(id);
        userVillageIds.delete(id);
        const model = lastListingsMap[id] && lastListingsMap[id].listingModel;
        const info = model ? baseAddressKey(model) : null;
        if (info) {
          exceptionBases.add(info.key);
          savedBases.delete(info.key);
        }
        if (hasGeo) {
          exceptionPts.push([item.lat, item.lng]);
          savedPts = savedPts.filter((p) => {
            if (nearExceptionPt(p)) {
              savedPtKeys.delete(ptKey(p));
              return false;
            }
            return true;
          });
        }
        persistRegistry();
      }
    }
    refreshAfterUserAction();
  }

  function recomputeClusters() {
    clusterFlaggedIds = new Set();
    let registryChanged = false;
    // Strongly flagged listings feed the registry (never cluster-inherited
    // ones — that would let one mistake snowball). User 💩 marks count as
    // strong; "not a retirement village" corrections are excluded everywhere.
    for (const [id, entry] of Object.entries(lastListingsMap)) {
      if (exceptionIds.has(String(id))) continue;
      const strong =
        dataFlaggedIds.has(String(id)) ||
        deepFlaggedIds.has(String(id)) ||
        userVillageIds.has(String(id));
      if (!strong) continue;
      const model = entry?.listingModel;
      const info = baseAddressKey(model);
      if (info && !savedBases.has(info.key) && !exceptionBases.has(info.key)) {
        savedBases.add(info.key);
        registryChanged = true;
      }
      const addr = model?.address;
      if (addr && typeof addr.lat === "number" && typeof addr.lng === "number") {
        const p = [addr.lat, addr.lng];
        if (!savedPtKeys.has(ptKey(p)) && !nearExceptionPt(p)) {
          savedPtKeys.add(ptKey(p));
          savedPts.push(p);
          registryChanged = true;
        }
      }
    }
    if (registryChanged) persistRegistry();
    for (const [id, entry] of Object.entries(lastListingsMap)) {
      if (exceptionIds.has(String(id))) continue;
      if (
        dataFlaggedIds.has(String(id)) ||
        deepFlaggedIds.has(String(id)) ||
        userVillageIds.has(String(id))
      ) {
        continue;
      }
      const model = entry?.listingModel;
      const info = baseAddressKey(model);
      if (info && savedBases.has(info.key) && !exceptionBases.has(info.key)) {
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
        ids: [
          ...deepFlaggedIds,
          ...clusterFlaggedIds,
          ...reaFlaggedIds,
          ...userVillageIds
        ].filter((i) => !exceptionIds.has(String(i)))
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
      el.classList.remove("wrh-hidden-user");
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
      .wrh-card-btns {
        position: absolute; top: 8px; right: 8px; z-index: 10;
        display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s;
      }
      li[data-wrh-btns]:hover .wrh-card-btns { opacity: 1; }
      .wrh-card-btn {
        border: 1px solid rgba(0, 0, 0, 0.25); background: #fff;
        border-radius: 6px; font-size: 14px; line-height: 1.4;
        padding: 2px 7px; cursor: pointer;
      }
      .wrh-card-btn:hover { background: #eee; }
      .wrh-card-restore { display: none; font-size: 12px; }
      html.wrh-reveal .wrh-hidden-user .wrh-card-btns { opacity: 1; }
      html.wrh-reveal .wrh-hidden-user .wrh-card-btn { display: none; }
      html.wrh-reveal .wrh-hidden-user .wrh-card-restore { display: inline-block; }
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
    const byYou = document.querySelectorAll(".wrh-hidden-user").length;
    const label = `${count} listing${count === 1 ? "" : "s"} hidden${
      byYou ? ` (${byYou} by you)` : ""
    } — click to peek`;
    if (pill.textContent !== label) pill.textContent = label;
  }

  // ---------- per-card hide buttons (Domain list view) ----------

  function ensureCardButtons(root) {
    if (SITE !== "domain") return;
    const scope = root && root.querySelectorAll ? root : document.body;
    for (const li of scope.querySelectorAll(
      'li[data-testid^="listing-"]:not([data-wrh-btns])'
    )) {
      const id = (li.getAttribute("data-testid") || "").replace("listing-", "");
      if (!/^\d+$/.test(id)) continue;
      li.setAttribute("data-wrh-btns", "1");
      const wrap = document.createElement("div");
      wrap.className = "wrh-card-btns";
      const mk = (label, title, action, cls) => {
        const b = document.createElement("button");
        b.className = cls || "wrh-card-btn";
        b.textContent = label;
        b.title = title;
        b.addEventListener("click", (e) => {
          // Cards are wrapped in links — swallow the click.
          e.preventDefault();
          e.stopPropagation();
          const addr =
            (lastListingsMap[id] && lastListingsMap[id].listingModel?.address) || {};
          handleUserAction(action, [{ id, lat: addr.lat, lng: addr.lng }]);
        });
        return b;
      };
      wrap.appendChild(mk("\u{1F6AB}", "Not for me — hide this listing", "hide"));
      wrap.appendChild(
        mk("\u{1F4A9}", "Retirement village — hide this address everywhere", "village")
      );
      wrap.appendChild(
        mk("↩ restore", "Restore this listing", "restore", "wrh-card-btn wrh-card-restore")
      );
      const style = window.getComputedStyle(li);
      if (style.position === "static") li.style.position = "relative";
      li.appendChild(wrap);
    }
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
          pts: savedPts.slice(-500),
          // "Not a retirement village" corrections — agents must not flag these.
          exceptIds: [...exceptionIds].slice(-500)
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
      broadcastPersonal();
    } else if (
      event.data.type === "wrh-user-action" &&
      typeof event.data.action === "string" &&
      Array.isArray(event.data.items)
    ) {
      handleUserAction(event.data.action, event.data.items);
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
    ensureCardButtons(document.body);
    updatePill();
    broadcastRules();
    broadcastDeepIds();
    broadcastPersonal();
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
            ensureCardButtons(node);
          }
        }
      }
    }
    hideFlaggedIds();
    updatePill();
  });

  function start() {
    loadDeepCache(() => {
      loadUserData(() => {
        // Exceptions must load before the registry so its filters apply.
        loadRegistry(() => {
          applyAll();
          observer.observe(document.body, {
            childList: true,
            characterData: true,
            subtree: true
          });
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
              !savedPtKeys.has(ptKey(p)) &&
              !nearExceptionPt(p)
            ) {
              savedPtKeys.add(ptKey(p));
              savedPts.push(p);
              touched = true;
            }
          }
        }
        if (changes.villageBases) {
          for (const b of changes.villageBases.newValue || []) {
            if (!savedBases.has(b) && !exceptionBases.has(b)) {
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
