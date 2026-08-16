// RE-Poo — map agent.
// Runs in the page's MAIN world on domain.com.au so it can read the React
// fiber data attached to map markers (listing id, property type, and Domain's
// isRetirement flag). Colours flagged pins red and reports flagged listing
// ids to content.js (isolated world) via postMessage.
(function () {
  let rules = null;
  let lastSent = "";
  let deepIds = new Set(); // deep-scan-flagged listing ids from content.js

  function ensureStyles() {
    if (document.getElementById("wrh-map-styles")) return;
    const style = document.createElement("style");
    style.id = "wrh-map-styles";
    style.textContent = `
      svg.listing-marker.wrh-marker-flagged rect,
      svg.listing-marker.wrh-marker-flagged path {
        fill: #a10000 !important;
      }
      svg.listing-marker.wrh-marker-poop {
        overflow: visible;
      }
      svg.listing-marker.wrh-marker-poop rect,
      svg.listing-marker.wrh-marker-poop path {
        display: none;
      }
    `;
    document.head.appendChild(style);
  }

  // Emoji rendered as an SVG <text> child. React may wipe it on re-render
  // (hover state etc.); the periodic scan re-applies it.
  function setMarkerStyle(svg, flagged) {
    const poopMode = rules.pinStyle === "poop";
    svg.classList.toggle("wrh-marker-flagged", flagged && !poopMode);
    svg.classList.toggle("wrh-marker-poop", flagged && poopMode);
    const existing = svg.querySelector("text.wrh-poop");
    if (flagged && poopMode) {
      if (!existing) {
        const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("class", "wrh-poop");
        t.setAttribute("x", "8");
        t.setAttribute("y", "16");
        t.setAttribute("text-anchor", "middle");
        t.setAttribute("font-size", "20");
        // The marker svg root has fill="none", which <text> inherits and
        // which suppresses the glyph entirely — an explicit fill restores it.
        t.setAttribute("fill", "#000");
        t.textContent = "💩";
        svg.appendChild(t);
      }
    } else if (existing) {
      existing.remove();
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
    for (const svg of document.querySelectorAll("svg.listing-marker")) {
      const listings = markerListings(svg);
      if (!listings) continue;
      const bad = listings.filter(listingFlagged);
      const deepHit = listings.some((l) => l && l.id != null && deepIds.has(String(l.id)));
      // Colouring is a separate toggle, but flagged ids are always reported
      // so the list can hide the matching cards.
      setMarkerStyle(svg, !!rules.colorMapPins && (bad.length > 0 || deepHit));
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
  }

  // Markers mount/unmount constantly while panning; React hover re-renders can
  // also wipe our class off a marker. A debounced observer plus a slow
  // interval keeps pins correct without measurable cost (~50 small SVGs).
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
      lastSent = "";
      scan();
    } else if (event.data.type === "wrh-deep-ids" && Array.isArray(event.data.ids)) {
      deepIds = new Set(event.data.ids.map(String));
      scan();
    }
  });

  // content.js may have loaded first — ask it for the current rules.
  window.postMessage({ type: "wrh-get-rules" }, window.location.origin);
})();
