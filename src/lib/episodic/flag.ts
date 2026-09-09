/**
 * The episodic-pivot page's switch.
 *
 * ## It shares `/lab`'s flag rather than getting its own
 *
 * `/lab/episodic` is a module *of* /lab, added alongside the swing engine, and
 * the brief asks for "the same rules as the rest of /lab". So it rides
 * `GAMMADESK_LAB` rather than introducing a third page flag: turning on the lab
 * turns on its episodic scanner too, and there is no state where one is
 * reachable and the other 404s under the same section.
 *
 * This is a judgment call. If the scanner ever needs to ship or hide
 * independently of the ranking testbed, the clean move is a `GAMMADESK_EPISODIC`
 * of its own in `lib/pageFlag.ts`, exactly as the macro card got one — and this
 * re-export is the single line that would change.
 */
export { labEnabled as episodicEnabled } from '../pageFlag';
