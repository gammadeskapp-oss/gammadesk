/**
 * How a page is switched on, for the pages that are off by default.
 *
 * ## One reader, so the rule cannot drift
 *
 * `/lab` and `/previousscanner` are both private, both unlisted, and both
 * 404 unless an environment variable says otherwise. That is one rule, and it
 * gets one implementation — a second hand-written copy would eventually accept
 * a spelling the first one rejects, and a gate that is open on one page and
 * shut on another is worse than no gate.
 *
 * ## `1` or `true`, and nothing else
 *
 * Anything else — unset, empty, `0`, `false`, `yes`, whitespace — is off. A
 * permissive reader is how a gate ends up open because a deploy tool wrote
 * `false` and something truthy-tested the string.
 *
 * ## Default-off everywhere, not default-off-in-production
 *
 * `NODE_ENV` is `production` in a local `next start`, on every preview
 * deployment, and in whatever a future build step does. A gate reading it
 * would open these pages on preview URLs, which are public to anyone holding
 * one. An explicit flag is a decision somebody made, and there is nowhere it
 * can be true by accident.
 *
 * ## These are switches, not authentication
 *
 * They keep an experiment from shipping with whatever deploy happens to
 * contain it. They do not identify anybody. The endpoints behind them that
 * spend upstream requests carry the cron auth every other manual endpoint
 * here carries, separately and underneath this.
 */
function pageFlagEnabled(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

/**
 * `/lab` — the private ranking testbed. `GAMMADESK_LAB=1`.
 *
 * An unvalidated blend of six readings over five hundred tickers, which is
 * exactly the sort of thing that should not be reachable by anyone who guesses
 * a URL.
 */
export function labEnabled(): boolean {
  return pageFlagEnabled('GAMMADESK_LAB');
}

/**
 * `/previousscanner` — the legacy build, kept for reference.
 * `GAMMADESK_LEGACY_SCANNER=1`.
 *
 * ## Its own flag, not `GAMMADESK_LAB`
 *
 * They are unrelated pages. One switch covering both would mean turning on
 * the ranking testbed also republished a superseded scanner, which is a
 * coupling nobody asked for and the kind that is only ever noticed by
 * accident. Two variables, set independently.
 *
 * ## Why this page in particular wants a gate
 *
 * Two reasons beyond being unlisted. It is a restoration of a rule set that
 * did not work — its own banner says so — and a shortlist of tickers from a
 * superseded build is a worse thing to leave openly reachable than most. And
 * unlike every other page here, a *page view* triggers its scan: the gate now
 * sits in front of that, so a stray production request cannot start a run that
 * spends bar series and writes a document.
 */
export function legacyScannerEnabled(): boolean {
  return pageFlagEnabled('GAMMADESK_LEGACY_SCANNER');
}

/**
 * The overnight & macro translator card. `GAMMADESK_MACRO=1`.
 *
 * Off by default so the feature can ship dark: the card can land in the tree,
 * be reviewed, and be turned on later without a second deploy. Two reasons this
 * one in particular wants a gate. It reads a new hand-maintained file and a new
 * set of overnight tickers, and shipping it dark means the wording and the
 * numbers can be checked on a preview before anyone reads them as fact. And the
 * FMP cross-check underneath it is held behind its own separate switch until a
 * display-licensing question is settled — see `lib/macro/consensus.ts` — so
 * while this card is on, it is still local-only.
 */
export function macroTranslatorEnabled(): boolean {
  return pageFlagEnabled('GAMMADESK_MACRO');
}
