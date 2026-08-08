export type RiskLabel = 'CALM' | 'CAUTIOUS' | 'DEFENSIVE';

/**
 * Turn the simulation's downside tail into a plain-English posture.
 *
 * The thresholds are judgement, not calibration. They sit where the simulated
 * odds of an 8% drawdown stop looking like ordinary noise and start looking
 * like a market with a fat left tail.
 */
export function riskLabel(crashPct: number): RiskLabel {
  if (crashPct >= 10) return 'DEFENSIVE';
  if (crashPct >= 4) return 'CAUTIOUS';
  return 'CALM';
}
