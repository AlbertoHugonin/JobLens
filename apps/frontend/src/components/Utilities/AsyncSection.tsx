import type { ReactNode } from 'react';

import { EmptyState, ErrorState, LoadingState } from './SectionState';

/**
 * Renders the standard loading / error / empty fallbacks, otherwise the children.
 * Collapses the repeated ternaries (`loading ? ... : error ? ...`) into one place.
 *
 * The caller decides when each flag is true (e.g. show loading only while there is
 * no cached data yet), keeping full control over the data-fetching semantics.
 */
export function AsyncSection({
  children,
  emptyMessage = 'Nessun dato disponibile',
  error,
  isEmpty,
  loading,
  loadingLabel,
}: {
  children: ReactNode;
  emptyMessage?: string | undefined;
  error?: string | null | undefined;
  isEmpty?: boolean | undefined;
  loading?: boolean | undefined;
  loadingLabel?: string | undefined;
}) {
  if (loading) {
    return <LoadingState label={loadingLabel} />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  if (isEmpty) {
    return <EmptyState message={emptyMessage} />;
  }

  return <>{children}</>;
}
