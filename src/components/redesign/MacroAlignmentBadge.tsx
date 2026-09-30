import type { MacroAlignment } from '@/lib/redesign/mock';

/**
 * The "Macro alignment" chip used in the scanner column and the Home scanner
 * shortlist — a single shared definition so the same alignment never renders
 * two ways. Aligned reads with macro (green), conflicted against it (red),
 * event-risk is the amber caveat tone; the classification tags are neutral.
 */
const CONFIG: Record<MacroAlignment, { label: string; tone: string }> = {
  aligned: { label: 'Aligned', tone: 'border-bull/50 text-bull' },
  conflicted: { label: 'Conflicted', tone: 'border-bear/50 text-bear' },
  'event-risk': { label: 'Event <24h', tone: 'border-flip/50 text-flip' },
  'rate-sensitive': { label: 'Rate-sensitive', tone: 'border-term-edge text-term-dim' },
  defensive: { label: 'Defensive', tone: 'border-term-edge text-term-dim' },
  cyclical: { label: 'Cyclical', tone: 'border-term-edge text-term-dim' },
};

export function MacroAlignmentBadge({ alignment }: { alignment: MacroAlignment }) {
  const { label, tone } = CONFIG[alignment];
  return (
    <span
      className={`inline-flex items-center border px-1.5 py-0.5 text-2xs uppercase tracking-[0.1em] ${tone}`}
    >
      {label}
    </span>
  );
}

export const MACRO_ALIGNMENT_FILTERS: { key: MacroAlignment; label: string }[] = [
  { key: 'aligned', label: 'Aligned' },
  { key: 'conflicted', label: 'Conflicted' },
  { key: 'event-risk', label: 'Event risk <24h' },
  { key: 'rate-sensitive', label: 'Rate-sensitive' },
  { key: 'defensive', label: 'Defensive' },
  { key: 'cyclical', label: 'Cyclical' },
];
