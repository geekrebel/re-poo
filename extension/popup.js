const DEFAULTS = {
  hideRetirement: true,
  extraKeywords: [],
  showMonthly: true,
  colorMapPins: true,
  pinStyle: "red",
  deepScan: true
};

const els = {
  hideRetirement: document.getElementById("hideRetirement"),
  colorMapPins: document.getElementById("colorMapPins"),
  pinStyle: document.getElementById("pinStyle"),
  deepScan: document.getElementById("deepScan"),
  showMonthly: document.getElementById("showMonthly"),
  extraKeywords: document.getElementById("extraKeywords")
};

chrome.storage.sync.get(DEFAULTS, (s) => {
  els.hideRetirement.checked = !!s.hideRetirement;
  els.colorMapPins.checked = !!s.colorMapPins;
  els.pinStyle.value = s.pinStyle === "poop" ? "poop" : "red";
  els.deepScan.checked = !!s.deepScan;
  els.showMonthly.checked = !!s.showMonthly;
  els.extraKeywords.value = (s.extraKeywords || []).join("\n");
});

els.pinStyle.addEventListener("change", () => {
  chrome.storage.sync.set({ pinStyle: els.pinStyle.value });
});

els.deepScan.addEventListener("change", () => {
  chrome.storage.sync.set({ deepScan: els.deepScan.checked });
});

els.hideRetirement.addEventListener("change", () => {
  chrome.storage.sync.set({ hideRetirement: els.hideRetirement.checked });
});

els.colorMapPins.addEventListener("change", () => {
  chrome.storage.sync.set({ colorMapPins: els.colorMapPins.checked });
});

els.showMonthly.addEventListener("change", () => {
  chrome.storage.sync.set({ showMonthly: els.showMonthly.checked });
});

// Copies the learned registry as JSON shaped for a villages.json PR/issue.
const exportBtn = document.getElementById("exportVillages");
exportBtn.addEventListener("click", () => {
  chrome.storage.local.get({ villageBases: [], villagePts: [] }, (res) => {
    const out = JSON.stringify(
      {
        note: "Learned by my RE-Poo install — bases are 'street|suburb' keys, points are [lat, lng]. Paste into a GitHub issue or shape into villages.json entries.",
        bases: res.villageBases || [],
        points: res.villagePts || []
      },
      null,
      2
    );
    navigator.clipboard.writeText(out).then(
      () => {
        exportBtn.textContent = "Copied to clipboard";
        setTimeout(() => {
          exportBtn.textContent = "Export learned villages (for a GitHub contribution)";
        }, 2000);
      },
      () => {
        exportBtn.textContent = "Copy failed — see console";
      }
    );
  });
});

// Debounced so typing doesn't hit storage.sync write quotas.
let keywordTimer;
els.extraKeywords.addEventListener("input", () => {
  clearTimeout(keywordTimer);
  keywordTimer = setTimeout(() => {
    const list = els.extraKeywords.value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    chrome.storage.sync.set({ extraKeywords: list });
  }, 400);
});
