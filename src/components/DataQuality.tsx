import type { DataMeta } from '@/lib/types';

interface DataQualityProps {
  meta: DataMeta;
  contracts: number;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-term-faint">{label} </span>
      <span className="text-term-dim">{value}</span>
    </span>
  );
}

/**
 * Provenance strip. Anyone reading numbers off this dashboard should be able to
 * see at a glance how many contracts went in and how many of their implied
 * vols were real versus modelled.
 */
export function DataQuality({ meta, contracts }: DataQualityProps) {
  const { ivSources } = meta;
  const totalIv = ivSources.quoted + ivSources.solved + ivSources.model;
  const modelledPct = totalIv > 0 ? Math.round((ivSources.model / totalIv) * 100) : 0;

  return (
    <div className="panel px-3 py-2 text-2xs">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <Stat label="source" value={meta.sourceLabel} />
        <Stat label="quote date" value={meta.quoteDateLabel} />
        <Stat label="contracts" value={String(contracts)} />
        <Stat
          label="IV"
          value={`${ivSources.quoted} quoted / ${ivSources.solved} solved / ${ivSources.model} modelled`}
        />
        <Stat label="api calls" value={String(meta.upstreamRequests)} />
        <Stat label="rate" value={`r ${(meta.riskFreeRate * 100).toFixed(1)}%`} />
        <Stat label="div" value={`q ${(meta.dividendYield * 100).toFixed(1)}%`} />
      </div>

      {modelledPct >= 25 && meta.source !== 'sample' && (
        <p className="mt-2 border-t border-term-line pt-2 text-flip/80">
          {modelledPct}% of strikes had no usable quoted implied volatility and fall
          back to a modelled volatility surface. Treat the exposure magnitudes as
          approximate.
        </p>
      )}

      {meta.notes.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-term-line pt-2 text-flip/80">
          {meta.notes.map((note) => (
            <li key={note}>! {note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
