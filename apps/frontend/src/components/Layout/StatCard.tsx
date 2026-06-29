import type { ReactNode } from 'react';

import Card from 'react-bootstrap/Card';
import Stack from 'react-bootstrap/Stack';

type StatVariant = 'primary' | 'success' | 'warning' | 'info' | 'secondary' | 'danger';

/**
 * Compact metric card: uppercase label, large value, optional hint and an icon
 * chip tinted with a Bootstrap subtle/emphasis pair. Pure Bootstrap utilities.
 */
export function StatCard({
  hint,
  icon,
  label,
  value,
  variant = 'secondary',
}: {
  hint?: ReactNode | undefined;
  icon?: ReactNode | undefined;
  label: string;
  value: ReactNode;
  variant?: StatVariant | undefined;
}) {
  return (
    <Card className="h-100">
      <Card.Body>
        <Stack direction="horizontal" className="justify-content-between align-items-start gap-3">
          <div className="min-w-0">
            <div className="text-secondary text-uppercase small fw-semibold font-mono">{label}</div>
            <div className="display-6 fw-bold lh-1 mt-2">{value}</div>
            {hint ? <div className="small text-secondary mt-2">{hint}</div> : null}
          </div>
          {icon ? (
            <span
              className={`d-inline-flex align-items-center justify-content-center rounded-3 p-2 bg-${variant}-subtle text-${variant}-emphasis`}
            >
              {icon}
            </span>
          ) : null}
        </Stack>
      </Card.Body>
    </Card>
  );
}
