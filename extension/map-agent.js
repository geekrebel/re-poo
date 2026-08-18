// RE-Poo — map agent.
// Runs in the page's MAIN world on domain.com.au so it can read the React
// fiber data attached to map markers (listing id, property type, and Domain's
// isRetirement flag). Colours flagged pins red and reports flagged listing
// ids to content.js (isolated world) via postMessage.
(function () {
  let rules = null;
  let lastSent = "";
  let deepIds = new Set(); // deep-scan-flagged listing ids from content.js
  let exceptSet = new Set(); // "not a retirement village" corrections
  let personalIds = new Set(); // user's 🚫 hides (this site)
  let personalPts = []; // 🚫 coordinates from either site (display-only)
  const sentListingIds = new Set(); // listing data already streamed to content.js

  function ensureStyles() {
    if (document.getElementById("wrh-map-styles")) return;
    const style = document.createElement("style");
    style.id = "wrh-map-styles";
    style.textContent = `
      svg.listing-marker.wrh-marker-flagged rect,
      svg.listing-marker.wrh-marker-flagged path {
        fill: #a10000 !important;
      }
      svg.listing-marker.wrh-marker-poop,
      svg.listing-marker.wrh-marker-user {
        overflow: visible;
      }
      svg.listing-marker.wrh-marker-poop rect,
      svg.listing-marker.wrh-marker-poop path,
      svg.listing-marker.wrh-marker-user rect,
      svg.listing-marker.wrh-marker-user path {
        display: none;
      }
      #wrh-pin-menu {
        position: fixed; z-index: 2147483647; background: #fff;
        border: 1px solid rgba(0, 0, 0, 0.2); border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2); padding: 4px;
        font: 13px/1.5 system-ui, sans-serif; min-width: 180px;
      }
      #wrh-pin-menu button {
        display: block; width: 100%; text-align: left; border: none;
        background: none; font: inherit; padding: 6px 10px;
        border-radius: 5px; cursor: pointer; color: #222;
      }
      #wrh-pin-menu button:hover { background: #f0f0f0; }
      #wrh-pin-menu .wrh-menu-title {
        font-size: 11px; color: #888; padding: 4px 10px 2px;
      }
    `;
    document.head.appendChild(style);
  }

  // Emoji rendered as an SVG <text> child. React may wipe it on re-render
  // (hover state etc.); the periodic scan re-applies it. Village (💩/red)
  // outranks personal (🚫).
  function emojiText(svg, char) {
    let t = svg.querySelector("text.wrh-poop");
    if (!t) {
      t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("class", "wrh-poop");
      t.setAttribute("x", "8");
      t.setAttribute("y", "16");
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("font-size", "20");
      // The marker svg root has fill="none", which <text> inherits and
      // which suppresses the glyph entirely — an explicit fill restores it.
      t.setAttribute("fill", "#000");
      svg.appendChild(t);
    }
    if (t.textContent !== char) t.textContent = char;
  }

  function setMarkerStyle(svg, flagged, personal) {
    const poopMode = rules.pinStyle === "poop";
    const village = flagged;
    const user = !flagged && personal;
    svg.classList.toggle("wrh-marker-flagged", village && !poopMode);
    svg.classList.toggle("wrh-marker-poop", village && poopMode);
    svg.classList.toggle("wrh-marker-user", user);
    if (village && poopMode) {
      emojiText(svg, "💩");
    } else if (user) {
      emojiText(svg, "🚫");
    } else {
      const t = svg.querySelector("text.wrh-poop");
      if (t) t.remove();
    }
  }

  function markerListings(svg) {
    const key = Object.keys(svg).find((k) => k.startsWith("__reactFiber$"));
    if (!key) return null;
    let fiber = svg[key];
    for (let i = 0; i < 12 && fiber; i++) {
      const p = fiber.memoizedProps;
      if (p && typeof p === "object" && Array.isArray(p.listingData)) {
        return p.listingData;
      }
      fiber = fiber.return;
    }
    return null;
  }

  function listingFlagged(listing) {
    if (listing && listing.id != null && exceptSet.has(String(listing.id))) return false;
    const model = (listing && listing.listingModel) || {};
    const features = model.features || {};
    if (rules.hideRetirement) {
      if (features.isRetirement === true) return true;
      if (
        /retirement/i.test(
          String(features.propertyTypeFormatted || features.propertyType || "")
        )
      ) {
        return true;
      }
    }
    if (rules.keywords && rules.keywords.length) {
      const hay = JSON.stringify(model).toLowerCase();
      for (const k of rules.keywords) {
        if (k && hay.includes(String(k).toLowerCase())) return true;
      }
    }
    return false;
  }

  function scan() {
    if (!rules) return;
    ensureStyles();
    const flaggedIds = [];
    // Listings that arrive from map panning never appear in the page's
    // __NEXT_DATA__, so their data is streamed to content.js from the
    // markers themselves for deep-scanning and clustering.
    const newListings = [];
    for (const svg of document.querySelectorAll("svg.listing-marker")) {
      const listings = markerListings(svg);
      if (!listings) continue;
      for (const l of listings) {
        if (l && l.id != null && l.listingModel && !sentListingIds.has(String(l.id))) {
          sentListingIds.add(String(l.id));
          newListings.push({ id: String(l.id), listingModel: l.listingModel });
        }
      }
      const bad = listings.filter(listingFlagged);
      const deepHit = listings.some((l) => l && l.id != null && deepIds.has(String(l.id)));
      const personal = listings.some((l) => {
        if (!l || l.id == null) return false;
        if (personalIds.has(String(l.id))) return true;
        const a = l.listingModel && l.listingModel.address;
        return a && nearPersonalPt(a.lat, a.lng);
      });
      // Colouring is a separate toggle, but flagged ids are always reported
      // so the list can hide the matching cards.
      setMarkerStyle(svg, !!rules.colorMapPins && (bad.length > 0 || deepHit), personal);
      for (const b of bad) {
        if (b && b.id != null) flaggedIds.push(String(b.id));
      }
    }
    flaggedIds.sort();
    const key = flaggedIds.join(",");
    if (key !== lastSent) {
      lastSent = key;
      if (flaggedIds.length) {
        window.postMessage(
          { type: "wrh-flagged-ids", ids: flaggedIds },
          window.location.origin
        );
      }
    }
    if (newListings.length) {
      window.postMessage(
        { type: "wrh-marker-listings", listings: newListings },
        window.location.origin
      );
    }
  }

  // Markers mount/unmount constantly while panning; React hover re-renders can
  // also wipe our class off a marker. A debounced observer plus a slow
  // interval keeps pins correct without measurable cost (~50 small SVGs).
  // Display-only cross-site match: a 🚫 made on the other portal shows here
  // when a pin sits at (near-)identical coordinates. Tight radius, no learning.
  function nearPersonalPt(lat, lng) {
    if (typeof lat !== "number" || typeof lng !== "number") return false;
    const cosLat = Math.cos((lat * Math.PI) / 180);
    for (const p of personalPts) {
      const dx = (p[1] - lng) * 111320 * cosLat;
      const dy = (p[0] - lat) * 110574;
      if (dx * dx + dy * dy <= 25 * 25) return true;
    }
    return false;
  }

  // ---------- right-click menu on pins ----------

  function closeMenu() {
    const m = document.getElementById("wrh-pin-menu");
    if (m) m.remove();
  }

  function sendAction(action, items) {
    window.postMessage(
      { type: "wrh-user-action", action, items },
      window.location.origin
    );
  }

  function openMenu(x, y, svg, listings) {
    closeMenu();
    const ids = listings.filter((l) => l && l.id != null);
    if (!ids.length) return;
    const payload = ids.map((l) => {
      const a = (l.listingModel && l.listingModel.address) || {};
      return { id: String(l.id), lat: a.lat, lng: a.lng };
    });
    const isVillage =
      svg.classList.contains("wrh-marker-flagged") ||
      svg.classList.contains("wrh-marker-poop");
    const isPersonal = svg.classList.contains("wrh-marker-user");
    const items = [];
    if (isVillage) {
      items.push(["Not a retirement village — restore", "exception"]);
    } else if (isPersonal) {
      items.push(["↩ Restore listing", "restore"]);
    } else if (payload.length > 1) {
      items.push(["💩 Retirement village (" + payload.length + " here)", "village"]);
      items.push(["🚫 Hide all " + payload.length, "hide"]);
    } else {
      items.push(["🚫 Not for me", "hide"]);
      items.push(["💩 Retirement village", "village"]);
    }
    const menu = document.createElement("div");
    menu.id = "wrh-pin-menu";
    const title = document.createElement("div");
    title.className = "wrh-menu-title";
    title.textContent = "RE-Poo";
    menu.appendChild(title);
    for (const [label, action] of items) {
      const b = document.createElement("button");
      b.textContent = label;
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        sendAction(action, payload);
        closeMenu();
      });
      menu.appendChild(b);
    }
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
    menu.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
  }

  document.addEventListener(
    "contextmenu",
    (e) => {
      if (!rules) return;
      const svg = e.target && e.target.closest
        ? e.target.closest("svg.listing-marker")
        : null;
      if (!svg) return;
      const listings = markerListings(svg);
      if (!listings || !listings.length) return;
      e.preventDefault();
      e.stopPropagation();
      openMenu(e.clientX, e.clientY, svg, listings);
    },
    true
  );
  document.addEventListener("mousedown", (e) => {
    const m = document.getElementById("wrh-pin-menu");
    if (m && !m.contains(e.target)) closeMenu();
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  }, true);
  window.addEventListener("scroll", closeMenu, true);

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
      exceptSet = new Set((rules.exceptIds || []).map(String));
      lastSent = "";
      // content.js rebuilds its listing map on settings changes — re-stream
      // everything so panned-in listings aren't lost.
      sentListingIds.clear();
      scan();
    } else if (event.data.type === "wrh-deep-ids" && Array.isArray(event.data.ids)) {
      deepIds = new Set(event.data.ids.map(String));
      scan();
    } else if (event.data.type === "wrh-personal") {
      personalIds = new Set((event.data.ids || []).map(String));
      personalPts = (event.data.pts || []).filter(
        (p) => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number"
      );
      scan();
    }
  });

  // content.js may have loaded first — ask it for the current rules.
  window.postMessage({ type: "wrh-get-rules" }, window.location.origin);
})();
