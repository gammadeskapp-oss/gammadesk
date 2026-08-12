/**
 * A trend line small enough to sit in a table row.
 *
 * Plain inline SVG rather than a charting library: there is one of these per
 * sector, they are static, and pulling in lightweight-charts for a 60px line
 * would cost more than the whole page.
 */
export function Sparkline({
  values,
  rising,
  label,
  width = 72,
  height = 22,
}: {
  values: number[];
  /** Drives the colour, so it matches the delta it sits beside. */
  rising: boolean;
  /** Screen-reader description; the shape alone says nothing without it. */
  label: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) {
    return (
      <span className="inline-block text-2xs text-term-faint" style={{ width }}>
        —
      </span>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const pad = 2;

  /*
   * A flat series has no range to scale into, so it is drawn down the middle
   * rather than dividing by zero and collapsing to the top edge.
   */
  const y = (v: number) =>
    span === 0
      ? height / 2
      : pad + (1 - (v - min) / span) * (height - pad * 2);

  const step = (width - pad * 2) / (values.length - 1);
  const points = values.map((v, i) => `${pad + i * step},${y(v).toFixed(2)}`);

  const stroke = rising ? '#3ddc84' : '#ff5c7a';
  const last = points[points.length - 1].split(',');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      className="shrink-0 overflow-visible"
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r="1.9" fill={stroke} />
    </svg>
  );
}
