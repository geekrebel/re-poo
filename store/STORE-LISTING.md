# Chrome Web Store submission — RE-Poo

Everything below is copy-paste ready for the Developer Dashboard
(https://chrome.google.com/webstore/devconsole).

---

## Package

Upload: `re-poo-v2.1.0.zip` (in this folder).

---

## Store listing tab

**Name:** RE-Poo — Real Estate Search Helper

**Summary (short description):**
Catches retirement villages & land-lease parks disguised as Houses on Domain and realestate.com.au — hides them and 💩s their pins.

**Detailed description:**

Half the "houses" in some Australian property searches aren't houses.

They're retirement villages, over-55s communities and land-lease parks —
listed as "House" or "Villa" with nothing on the card to warn you. RE-Poo
finds them, hides them, and marks their map pins with the emoji they
deserve. 💩

Born from a Central Coast house hunt where 20 of 44 "House" results under
$800k turned out to be villages you can't buy into unless you're over 50.

HOW IT CATCHES THEM
Layered detection, because these listings keep getting sneakier:
• Reads the portals' own listing data, including flags that never appear on
  the card
• Scans listing descriptions for tells like "over-55s", "land lease" and
  "lifestyle village" — slowly, politely, and cached so each listing is only
  ever checked once
• Remembers village addresses and locations: once one listing in a park
  slips up, every future listing at that address is caught automatically,
  on both sites. A village only has to slip up once, ever.

WHAT YOU SEE
• Village listings vanish from domain.com.au search results
• Their map pins turn blood red or 💩 (your choice) on domain.com.au AND
  realestate.com.au — bundled pins keep their count, so 💩33 means a
  33-listing park at one address
• A green counter shows how many listings were hidden — click it to peek at
  them, dimmed and outlined, so nothing genuine is ever silently lost
• Add your own exclusion keywords for anything else you never want to see
• Bonus: weekly rents get a monthly equivalent — "$900 per week (≈ $3,900/mo)"

PRIVATE BY DESIGN
Everything runs locally in your browser. No accounts, no analytics, no data
collection — the only network requests go to the real-estate site you're
already browsing.

OPEN SOURCE
MIT-licensed at github.com/geekrebel/re-poo. Found a village that slipped
through? Open a "Village report" issue on GitHub — that's how the detection
gets smarter.

GOOD TO KNOW
• Detection is deepest on domain.com.au; on realestate.com.au the map view
  is the fully supported surface, and a brand-new area may need one pan or
  zoom before pins mark
• Heuristics can occasionally flag a genuine gated estate — the peek counter
  lets you audit everything that was hidden

**Category:** Shopping (alternative: Productivity → Tools)

**Language:** English

**Screenshots (required, at least 1):** 1280×800 or 640×400 PNG/JPEG.
Take one on a Domain search showing red pins + the green "N listings hidden"
pill. See instructions at the bottom of this file.

**Small promo tile (optional):** `promo-tile-440x280.png` (in this folder).

---

## Privacy tab

**Single purpose description:**
Filters and annotates search results on Australian real-estate websites:
hides retirement/land-lease listings the user has excluded and displays
monthly equivalents next to weekly rental prices.

**Permission justifications:**

- `storage` — Saves the user's settings (which filters are enabled, custom
  exclusion keywords, pin style) and a local cache of already-analysed
  listing pages so each listing is only fetched once.

- Host permission `https://www.domain.com.au/*` — The extension's content
  script runs on Domain search pages to hide excluded listing cards, mark
  map pins, and annotate rental prices. It also fetches individual listing
  pages from domain.com.au (the site the user is already browsing) to read
  listing descriptions for retirement/land-lease detection. Content is
  processed locally and never transmitted.

- Host permission `https://www.realestate.com.au/*` — Same content script
  provides keyword-based listing hiding and weekly→monthly rent annotation
  on realestate.com.au search pages.

**Remote code:** No, I am not using remote code. (All JavaScript is packaged
in the extension; nothing is loaded or evaluated from the network.)

**Data usage:** Tick "Does not collect or use user data" — the extension
does not collect, transmit, or sell any user data. All processing and
storage is local to the browser (chrome.storage).

**Privacy policy URL:** https://github.com/geekrebel/re-poo/blob/main/store/PRIVACY.md Not strictly required when no
data is collected, but it removes reviewer friction.

---

## Account & submission steps

1. Go to https://chrome.google.com/webstore/devconsole and sign in with the
   Google account you want to own the extension.
2. Pay the one-time US$5 developer registration fee.
3. "New item" → upload `re-poo-v2.1.0.zip`.
4. Fill the Store Listing tab (copy from above), upload icon/screenshots.
   The 128px icon inside the package is used automatically.
5. Fill the Privacy tab (copy from above).
6. Distribution: choose visibility —
   - **Public**: anyone can find and install it.
   - **Unlisted**: only people with the link can install — recommended to
     start; you can flip to Public later without re-review.
7. Submit for review. First reviews typically take 1–3 business days
   (extensions with host permissions occasionally take longer).

## After approval

- Updates: bump `"version"` in manifest.json, re-zip, upload, submit again.
- The extension auto-updates for users within hours of an approved release.

## Screenshot instructions

1. In your Chrome (with the extension loaded), open a Domain search that
   shows red pins and the hidden-listings pill, e.g. the Erina map search.
2. macOS: Cmd+Shift+5 → "Capture Selected Window" on the browser window,
   or capture a region. Any size is fine.
3. Give me the file — I'll crop/scale/pad it to exactly 1280×800 for the
   dashboard.

## Review-risk notes (worth knowing, not blockers)

- The name/description mention Domain and realestate.com.au only as the
  sites the extension works on (nominative use) — no logos are used. Keep it
  that way.
- The description openly states that the extension modifies search pages and
  fetches listing pages locally; transparency here is what reviewers look
  for on host-permission extensions.
- realestate.com.au support is currently untested. If you'd rather ship
  Domain-only for v1 (one fewer host permission = smoother review), remove
  the realestate.com.au entries from `content_scripts.matches` and from the
  listing text, and I'll re-zip.
