/**
 * Failure text written for a reader rather than an operator.
 *
 * ## Why this is a pure function in its own file
 *
 * The adapters throw precise technical messages — provider name, HTTP status,
 * sometimes the CDN — and those are exactly right for a log. They are exactly
 * wrong for a page: they tell a visitor about internals they cannot act on,
 * and they disclose a little of how the deployment is wired. The first version
 * of the error card printed environment variable names and advice about which
 * provider plan includes which endpoint, to people who had come to look at a
 * chart.
 *
 * So the two are split, and the mapping lives here — one place to check that
 * nothing internal escapes, and a place `verify:errors` can walk without
 * pulling in the chain machinery.
 *
 * Keyed on the status code rather than on the message text, deliberately. A
 * mapping that pattern-matched the technical string would leak the moment
 * somebody reworded an adapter; a status is a small closed set that cannot
 * carry a provider name in it.
 */

/**
 * @param status HTTP status, or 0 for a request that never completed.
 */
export function publicChainMessage(status: number): string {
  /*
   * Never completed, or the provider itself is unwell. Neither says anything
   * about the ticker that was asked for, so the wording must not imply the
   * symbol was the problem — a reader who retypes a perfectly good ticker
   * because the page hinted at it has been actively misled.
   */
  if (status === 0 || status >= 500) {
    return "Live market data isn't available right now.";
  }

  // The provider has no chain published under this symbol. This one *is* about
  // the ticker, and saying so is the useful thing.
  if (status === 403 || status === 404) {
    return 'No options data is published for this ticker.';
  }

  // Anything else arrived and was unusable. The reader does not need to know
  // which of the several ways that can happen actually happened.
  return "Today's data isn't available yet.";
}
