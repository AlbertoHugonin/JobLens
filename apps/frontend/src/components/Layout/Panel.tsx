import type { ReactNode } from 'react';

import Card from 'react-bootstrap/Card';
import Stack from 'react-bootstrap/Stack';

/**
 * Standard card panel: optional header (title + actions slot), body and footer.
 * Replaces the repeated `Card > Card.Header > Stack ...` boilerplate across pages.
 */
export function Panel({
  actions,
  bodyClassName,
  children,
  className,
  footer,
  title,
}: {
  actions?: ReactNode | undefined;
  bodyClassName?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
  footer?: ReactNode | undefined;
  title?: ReactNode | undefined;
}) {
  const hasHeader = title !== undefined || actions !== undefined;

  return (
    <Card className={className}>
      {hasHeader ? (
        <Card.Header>
          <Stack
            direction="horizontal"
            className="justify-content-between align-items-center gap-3"
          >
            {typeof title === 'string' ? <span className="fw-semibold">{title}</span> : title}
            {actions ? <div className="d-flex align-items-center gap-2">{actions}</div> : null}
          </Stack>
        </Card.Header>
      ) : null}
      <Card.Body className={bodyClassName}>{children}</Card.Body>
      {footer ? <Card.Footer>{footer}</Card.Footer> : null}
    </Card>
  );
}
