# RE-Poo 💩

**Real Estate Search Helper** — a Chrome extension that fixes Australian
property-search results by catching retirement villages, over-55s communities
and land-lease parks disguised as ordinary houses.

Born from a Central Coast house hunt where nearly half the "House" results
under $800k turned out to be villages you can't actually buy into unless
you're over 50.

## What it does

- **Hides retirement/land-lease listings** on domain.com.au search results —
  including ones typed as "House" with nothing on the card to warn you.
- **Marks their map pins** blood red, or with a 💩 emoji (configurable).
- **Shows a counter** of hidden listings; click it to peek at what was
  filtered, dimmed and outlined, so nothing genuine is lost.
- **Custom exclusion keywords** for anything else you never want to see.
- **Weekly → monthly rent conversion**: "$900 per week (≈ $3,900/mo)".

## How it catches them

Layered detection, because the listings keep getting sneakier:

1. **Domain's own hidden flag** — search data carries
   `features.isRetirement`, set even when the shown type says "House".
2. **Deep scan** — listing descriptions are fetched (once, then cached,
   politely rate-limited) and matched against phrases like "land lease",
   "over-55s", "lifestyle village", "gated community", "site fees".
3. **Address clustering** — one flagged listing at "61 Karalta Road" burns
   the base address for every unit there.
4. **Street clustering** — parks with named internal streets
   ("1 Thomas Gilbert Place") burn the whole street.
5. **Geo clustering** — anything within 175 m of two flagged listings is
   inside the park, whatever its street is called.
6. **Persistent village registry** — flagged addresses and coordinates are
   remembered across sessions. Each village only has to slip up once, ever.

Everything runs locally. No accounts, no analytics, no data leaves the
browser. See [store/PRIVACY.md](store/PRIVACY.md).

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select the [`extension/`](extension/) folder
3. Browse a [domain.com.au](https://www.domain.com.au) search and watch the
   pill count climb

## Repo layout

- [`extension/`](extension/) — the extension itself (load this folder)
- [`store/`](store/) — Chrome Web Store submission kit: listing copy,
  privacy policy, promo tile, upload ZIP

## Caveats

- Tuned for domain.com.au; realestate.com.au has basic keyword/rent support
  only. Domain markup changes may break the structured-data layers — the
  visible-text matching remains as a fallback.
- Detection heuristics can false-positive (e.g. a genuine gated estate);
  the peek pill exists so you can audit what was hidden.
