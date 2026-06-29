import type { CSSProperties } from 'react';

/** Signature heartbeat dot — pings while `live`, steady otherwise. */
export function PulseDot({
  live = false,
  variant = 'info',
}: {
  live?: boolean;
  variant?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={live ? 'pulse-dot is-live' : 'pulse-dot'}
      style={{ '--pulse': `var(--bs-${variant})` } as CSSProperties}
    />
  );
}
