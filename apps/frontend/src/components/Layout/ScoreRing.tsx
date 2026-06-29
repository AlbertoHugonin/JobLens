import type { CSSProperties } from 'react';

type RingVariant = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'secondary';

/**
 * Signature element: a focus ring (the JobLens "lens") that renders an AI score
 * 0–100 as a conic gauge with the value in mono at its centre.
 */
export function ScoreRing({
  label,
  score,
  size = 56,
  variant = 'secondary',
}: {
  label?: string | undefined;
  score: number | null;
  size?: number | undefined;
  variant?: RingVariant | undefined;
}) {
  const pct = Math.max(0, Math.min(100, score ?? 0));
  const style = {
    '--score-val': pct,
    '--score-ring': `var(--bs-${variant})`,
    fontSize: `${Math.round(size * 0.3)}px`,
    height: size,
    width: size,
  } as CSSProperties;

  return (
    <div
      aria-label={label ?? `Score ${score ?? 'non disponibile'}`}
      className="score-ring"
      role="img"
      style={style}
    >
      <span className="font-mono fw-semibold">{score ?? '–'}</span>
    </div>
  );
}
