import type { ReactNode } from 'react';

import Stack from 'react-bootstrap/Stack';

/**
 * Page chrome under the navbar. The page name + description were redundant with
 * the active nav item, so they are no longer rendered — only the optional actions
 * remain (right-aligned). With no actions the header renders nothing.
 */
export function PageHeader({
  actions,
  title,
}: {
  actions?: ReactNode | undefined;
  description?: string | undefined;
  title: string;
}) {
  if (!actions) {
    return null;
  }

  return (
    <Stack
      className="page-header mb-4"
      direction="horizontal"
      gap={3}
      role="group"
      aria-label={title}
    >
      <div className="ms-auto flex-shrink-0">{actions}</div>
    </Stack>
  );
}
