# Contributing to RE-Poo 💩

Thanks for helping catch disguised village listings. The maintainer has
limited time, so this project is set up to run on autopilot: CI is the first
reviewer, and issues that include the requested evidence get handled far
faster than ones that don't.

## The easiest contribution: add a village to the index

[`extension/villages.json`](extension/villages.json) is a community index of
retirement / land-lease villages that pollute general property searches —
name, suburb, shared base addresses, internal street names, coordinates.
Bundled with the extension, it catches these parks even when no currently
listed unit gives the game away. Adding a village is a one-entry PR; the
schema is documented at the top of the file. Don't know all the fields?
Open a **Village report** issue instead with the listing URL and whatever
you know — or use the popup's "Export learned villages" button to dump what
your own install has discovered. These reports are how every detection
layer in this extension got built.

## Dev setup

1. Clone the repo.
2. `chrome://extensions` → Developer mode → **Load unpacked** → select
   [`extension/`](extension/).
3. After edits, press ↻ on the extension card. (Never remove and re-add the
   extension — that wipes its storage, including the village registry.)

No build step, no dependencies. Plain JS, Manifest V3.

## Architecture in one minute

- **`content.js`** (isolated world, both sites): settings, listing-card
  hiding, weekly→monthly rent annotation, the deep scan (Domain only), the
  village registry (address bases + coordinates in `chrome.storage.local`),
  and clustering (unit-address, street, geo).
- **`map-agent.js`** (MAIN world, Domain): reads React fiber data off map
  markers, styles pins, streams marker listing data to content.js.
- **`rea-agent.js`** (MAIN world, REA): parses marker DOM ids
  (`BuyMapIndividual_<lat>_<lng>_<id>`), styles pins from the registry,
  harvests listing records from lexa GraphQL responses (read-only observers).
- Worlds talk via `window.postMessage` (`wrh-rules`, `wrh-deep-ids`,
  `wrh-flagged-ids`, `wrh-marker-listings`, `wrh-rea-listings`).

## Hard rules (learned by being blocked, twice)

1. **Never increase request rates.** The deep scan is one fetch per ~3–4.5s
   globally (Web Locks across tabs), visible-tab only, with backoff. Both
   Domain (Akamai) and REA (Kasada) block entire browsing sessions when
   pushed. PRs that fetch faster or add new fetch sources will be declined.
2. **Registry writes must stay monotonic** — always merge with storage,
   never overwrite (multi-tab races genuinely wiped it once).
3. **Marking may be loose; hiding must be strict.** A wrongly-💩'd pin is
   harmless; a wrongly-hidden listing might be someone's house. Geo hiding
   requires 2 votes; pin marking allows 1.
4. **Fail open.** Every parser of site internals (fibers, `__NEXT_DATA__`,
   GraphQL shapes) must degrade to a no-op when the site changes, leaving
   text-matching as the fallback.

## Pull requests

- Keep them small and single-purpose; describe the listing/behaviour that
  motivated the change (URLs welcome).
- CI must be green: it syntax-checks all scripts, validates the manifest,
  and attaches an installable ZIP of your branch to the PR run — reviewers
  test from that artifact.
- Manual testing notes required: which site(s), which surface (list/map),
  what you saw before/after.
- Squash-merged; your PR title becomes the commit message.

Response times are best-effort. A green-CI PR with a clear description and
test notes is the fastest path to a merge.

## Releases (maintainer)

Bump `"version"` in `extension/manifest.json`, push, then:
`cd extension && zip -r ../re-poo-vX.Y.Z.zip . -x "*.DS_Store"` and
`gh release create vX.Y.Z ../re-poo-vX.Y.Z.zip`. The Chrome Web Store gets
the same ZIP via the developer dashboard.
