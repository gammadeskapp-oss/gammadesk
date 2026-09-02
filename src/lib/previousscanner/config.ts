import 'server-only';

import { config } from '../config';
import type { ScanTimeframe, VwapAnchor } from './types';

/**
 * The legacy scanner's tuning.
 *
 * ## Why this file exists at all
 *
 * Everything here except `vwapAnchor` is read straight from the live
 * `config.scanner`, because these two scanners genuinely do share those
 * numbers and duplicating them would let the reference page quietly drift onto
 * a different relative-strength floor than the one it originally ran at.
 *
 * `vwapAnchor` is the exception, and it is the reason for the indirection. The
 * VWAP filter was deleted from the live scanner and its setting went with it,
 * so there is nothing left to read. Adding it back to the shared config would
 * put a setting for a filter the current scanner does not have into the object
 * the current scanner reads — which is exactly the coupling this page is meant
 * not to create. It lives here instead, with the original defaults and the
 * original environment variables, so the two can be changed independently and
 * neither can break the other.
 */

/**
 * Which VWAP anchor each timeframe uses.
 *
 * A session anchor on a daily bar series is meaningless — every bar is its own
 * session, so VWAP would equal the typical price and the filter would be a
 * coin toss. The week anchor gives 4H and daily something to actually measure
 * against. Stated in the UI, not just here.
 */
const vwapAnchor: Record<ScanTimeframe, VwapAnchor> = {
  '1h': (process.env.GAMMADESK_SCAN_VWAP_1H ?? 'session') as VwapAnchor,
  '4h': (process.env.GAMMADESK_SCAN_VWAP_4H ?? 'week') as VwapAnchor,
  '1D': (process.env.GAMMADESK_SCAN_VWAP_1D ?? 'week') as VwapAnchor,
};

/**
 * Delegating getters rather than a spread.
 *
 * Every field on `config` is itself a getter that reads `process.env` when
 * asked, so spreading the object would freeze all of them at import time and
 * quietly stop honouring the environment. Each one is forwarded lazily here
 * for the same reason.
 */
export const legacyConfig = {
  get scanner() {
    return { ...config.scanner, vwapAnchor };
  },
  get tradeability() {
    return config.tradeability;
  },
  get cacheSeconds() {
    return config.cacheSeconds;
  },
  get riskFreeRate() {
    return config.riskFreeRate;
  },
  get dividendYield() {
    return config.dividendYield;
  },
  get expirationCount() {
    return config.expirationCount;
  },
  get strikesEachSide() {
    return config.strikesEachSide;
  },
};
