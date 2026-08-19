# Onboarding a new horoscope client

Everything below is done through the CRM as a superadmin. No code change and no
deploy is needed to add a client.

**Nothing is inherited.** Every client starts with empty branding and empty
prompts. Report generation refuses with a `422` naming the missing field until
the prompts are filled in — that is deliberate, so a new client can never ship a
report carrying another client's persona, signature or disclaimers.

---

## 1. Create the client — Clients page → New

| Tab | What to set |
|---|---|
| **Identity** | `id` (short, lowercase — becomes the order prefix and webhook path), name, type |
| **WhatsApp** | `phone_number_id`, WhatsApp token (or tick *use my system token*), `webhook_verify_token` |
| **AI** | **The client's own Gemini API key**, and **their own freeastroapi key**. Only tick *use my system key* for clients we deliberately host — otherwise their usage bills us. |
| **Branding** | Brand display name, colour, logo URL, contact number |
| **Reports** | Signature, footer template, cover invocation, divider, font, cover logo, PDF metadata — see below |
| **Access** | Set the CRM login password |

### The Reports tab

Blank means omitted, so a client who wants a plain cover simply leaves the
invocation and divider empty.

- **Footer template** — use `{brand}` for the brand name, e.g. `{brand} | Page: `.
  Keep the trailing space; the page number is appended directly after it.
- **Font** — only bundled typefaces are offered. An unbundled font would be
  silently substituted by LibreOffice during PDF conversion and render Sinhala as
  broken glyphs behind a successful-looking response, so the list is enforced.
  To add a font: drop the Regular and Bold `.ttf` into
  `backend/src/assets/fonts/` and add the family name to `FONT_ALLOWLIST` in
  `backend/src/services/branding.js`.
- **Cover logo** — upload on the Media page, paste the returned URL. PNG or JPEG,
  under 2 MB. A logo that fails to load is skipped with a warning rather than
  breaking generation.
- **PDF metadata** — blank falls back to the client's own brand name.

## 2. Enable features — Addons page

At minimum `horoscope_reading`. Add `match_making` for the compatibility report,
`income_summary` for the revenue tile on Orders, `tarot_reading`, and any others
they have paid for. Every one is enforced server-side, so hiding a tab in the UI
is not the only thing stopping access.

## 3. Configure the reports — Plugins page → Horoscope Reading

This is the longest step and the one that decides report quality.

- **System prompt** — the astrologer persona. Required; generation refuses without it.
- **Sections** and **Section guides** — the client's own table of contents and the
  brief for each section. Required.
- **Fixed writing instructions** — tone, structure, what not to repeat.
- **Remedies section label** — must match one of the section labels *exactly*.
  It marks where the remedies half of the document begins; a mismatch silently
  puts every section in one run.
- **Special questions heading** — use `{year}` rather than typing a year, so it
  does not go stale each January.
- Report titles for the quantum, marriage, match and porondam reports.
- Marriage and match-making each have their own persona, sections, special note
  and fixed instructions.

Then **Plugins → Tarot Reading** for the tarot prompt, page headings and page bodies.

> If the client wants a starting point, copy from an existing client and rewrite
> it. Do not leave another client's persona or credibility claims in place — the
> previous default asserted the reading was computed from NASA Horizons ephemeris
> data, which is not a claim to make on someone else's behalf.

## 4. Point Meta at the webhook

Manual, on Meta's side: set the WABA phone number's callback URL to
`https://<host>/webhook/<client_id>` with the client's `webhook_verify_token`.

## 5. Billing — Packages page

Assign a package, bonus messages and overage limit.

## 6. Smoke test

1. Create an order for the new client.
2. Generate a horoscope. If it 422s, the message names the field still missing.
3. Download the PDF and confirm: their footer, their signature, their logo, and
   **no other client's text anywhere in the document**.
4. Confirm the Gemini and freeastroapi usage appears in *their* dashboards, not ours.
5. Log in as another client and try to download this order by ID — it must 404.

---

## Restoring an existing client after the white-label refactor

Already done for `pj` — its branding, report labels, match-making config and
tarot headings were seeded straight into the database on 2026-08-19, verified
byte-identical to the pre-refactor values. Nothing needs retyping.

To do the same for another client, put their values in a JSON file and run:

```
node backend/scripts/seed-client-config.js <clientId> <values.json>          # dry run
node backend/scripts/seed-client-config.js <clientId> <values.json> --apply
```

The script is non-destructive: a field that already has a value is reported as
`kept` and never overwritten, so re-running is safe. It also adds the branding
columns if the deploy has not yet migrated the schema, copies a legacy
freeastroapi key out of `plugin_configs`, and records an explicit system-key
opt-in for a client that has no key of their own — without that the resolver
fails closed and would take them offline.

The values file is never committed: a client's personas and disclaimers are
their content, which is the whole point of this migration.

`remedies_section_label` is special. Set it to the literal
`"__FROM_CLIENT_SECTIONS__"` and the script resolves it from that client's own
stored `horoscope_sections`, because the label drives the document's page split
and a single mistyped character would silently mis-render the report.
