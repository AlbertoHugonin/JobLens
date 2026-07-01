import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import ListGroup from 'react-bootstrap/ListGroup';
import Stack from 'react-bootstrap/Stack';

import {
  getJobLocalStatusLabel,
  getJobLocalStatusVariant,
  type JobSummary,
} from '../../models/job';
import { EmptyState, ErrorState, LoadingState } from '../Utilities/SectionState';

function formatWorkplaceType(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (['remote', 'remoto', 'da remoto'].includes(normalized)) {
    return 'Remoto';
  }

  if (['hybrid', 'ibrido'].includes(normalized)) {
    return 'Ibrido';
  }

  if (['onsite', 'on-site', 'in sede', 'presenza', 'in presenza'].includes(normalized)) {
    return 'In sede';
  }

  return value.trim();
}

function formatLocationText(value: string | null, workplaceLabel: string | null): string {
  const fallback = 'Localita non indicata';
  if (!value) {
    return fallback;
  }

  const trimmed = value.trim();
  if (!workplaceLabel) {
    return trimmed || fallback;
  }

  const withoutWorkplaceSuffix = trimmed
    .replace(
      /\s*\((remote|remoto|da remoto|hybrid|ibrido|onsite|on-site|in sede|presenza|in presenza)\)\s*$/i,
      '',
    )
    .trim();

  return withoutWorkplaceSuffix || fallback;
}

function railClass(job: JobSummary): string {
  switch (job.latestReview?.decision) {
    case 'apply':
      return 'rail-apply';
    case 'maybe':
      return 'rail-maybe';
    case 'reject':
      return 'rail-reject';
    default:
      return 'rail-none';
  }
}

export function JobList({
  error,
  jobs,
  limit,
  loading,
  offset,
  onPageChange,
  onSelect,
  selectedId,
  total,
}: {
  error: string | null;
  jobs: JobSummary[];
  limit: number;
  loading: boolean;
  offset: number;
  onPageChange: (offset: number) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  total: number;
}) {
  const hasPrevious = offset > 0;
  const hasNext = offset + limit < total;

  return (
    <Card className="job-list-card scroll-card h-100">
      <Card.Header>
        <Stack direction="horizontal" className="justify-content-between gap-3">
          <span className="fw-semibold">Offerte</span>
          <Badge bg="secondary" className="font-mono">
            {total}
          </Badge>
        </Stack>
      </Card.Header>
      {error ? (
        <Card.Body>
          <ErrorState message={error} />
        </Card.Body>
      ) : null}
      {!error && loading && jobs.length === 0 ? (
        <Card.Body>
          <LoadingState label="Caricamento offerte" />
        </Card.Body>
      ) : null}
      {!error && !loading && jobs.length === 0 ? (
        <Card.Body>
          <EmptyState message="Nessuna offerta con i filtri correnti" />
        </Card.Body>
      ) : null}
      {jobs.length > 0 ? (
        <ListGroup className="job-list" variant="flush">
          {jobs.map((job) => {
            const statusLabel = getJobLocalStatusLabel(job.localStatus);
            const workplaceLabel = formatWorkplaceType(job.workplaceType);
            const locationLabel = formatLocationText(job.locationText, workplaceLabel);
            return (
              <ListGroup.Item
                key={job.id}
                action
                active={job.id === selectedId}
                className={railClass(job)}
                onClick={() => onSelect(job.id)}
              >
                <div className="job-list-row">
                  <div className="min-w-0 flex-grow-1">
                    <div className="job-list-title fw-semibold" title={job.title}>
                      {job.title}
                    </div>
                    <div className="job-list-meta small text-secondary">
                      <span className="job-list-company text-truncate" title={job.companyName}>
                        {job.companyName}
                      </span>
                      <span className="job-list-place">
                        <span className="job-list-location text-truncate" title={locationLabel}>
                          {locationLabel}
                        </span>
                        {workplaceLabel ? (
                          <Badge
                            bg="light"
                            className="job-list-workplace-badge"
                            text="dark"
                            title={`Modalita: ${workplaceLabel}`}
                          >
                            {workplaceLabel}
                          </Badge>
                        ) : null}
                      </span>
                    </div>
                  </div>
                  <span
                    aria-label={`Stato: ${statusLabel}`}
                    className={`job-local-status-dot bg-${getJobLocalStatusVariant(job.localStatus)}`}
                    title={statusLabel}
                  />
                </div>
              </ListGroup.Item>
            );
          })}
        </ListGroup>
      ) : null}
      <Card.Footer className="mt-auto">
        <Stack direction="horizontal" className="justify-content-between gap-2">
          <Button
            disabled={!hasPrevious || loading}
            onClick={() => onPageChange(Math.max(0, offset - limit))}
            size="sm"
            variant="outline-secondary"
          >
            Precedenti
          </Button>
          <span className="small text-secondary">
            {total === 0 ? '0-0' : `${offset + 1}-${Math.min(offset + limit, total)}`} di {total}
          </span>
          <Button
            disabled={!hasNext || loading}
            onClick={() => onPageChange(offset + limit)}
            size="sm"
            variant="outline-secondary"
          >
            Successive
          </Button>
        </Stack>
      </Card.Footer>
    </Card>
  );
}
