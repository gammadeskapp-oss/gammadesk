/**
 * `/lab`'s switch, re-exported from the shared reader.
 *
 * The implementation moved to `lib/pageFlag.ts` when `/previousscanner`
 * gained the same kind of gate — one rule, one reader, so the two cannot
 * come to disagree about what counts as "on". This file stays because every
 * caller already imports `labEnabled` from here, and a re-export is cheaper
 * than touching them to say the same thing.
 */
export { labEnabled } from '../pageFlag';
