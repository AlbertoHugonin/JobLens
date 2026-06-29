import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import ListGroup from 'react-bootstrap/ListGroup';
import ProgressBar from 'react-bootstrap/ProgressBar';
import Stack from 'react-bootstrap/Stack';

import { getActivityProgressPercent, type Activity } from '../../models/activity';
import { EmptyState, ErrorState, LoadingState } from '../Utilities/SectionState';
import { ActivityStatusBadge } from './ActivityStatusBadge';
import { activityRailClass, formatRelative } from './activityFormat';
import { PulseDot } from './PulseDot';

export function ActivityList({
  activities,
  error,
  limit,
  loading,
  offset,
  onPageChange,
  onSelect,
  selectedId,
  total,
}: {
  activities: Activity[];
  error: string | null;
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
    <Card className="activity-list-card scroll-card h-100">
      <Card.Header>
        <Stack direction="horizontal" className="justify-content-between gap-3">
          <span className="fw-semibold">Timeline run</span>
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
      {!error && loading && activities.length === 0 ? (
        <Card.Body>
          <LoadingState label="Caricamento attivita" />
        </Card.Body>
      ) : null}
      {!error && !loading && activities.length === 0 ? (
        <Card.Body>
          <EmptyState message="Nessuna attivita registrata" />
        </Card.Body>
      ) : null}
      {activities.length > 0 ? (
        <ListGroup className="activity-list" variant="flush">
          {activities.map((activity) => {
            const running = activity.status === 'running';
            return (
              <ListGroup.Item
                key={activity.id}
                action
                active={activity.id === selectedId}
                className={activityRailClass(activity.status)}
                onClick={() => onSelect(activity.id)}
              >
                <Stack className="gap-2">
                  <Stack direction="horizontal" className="justify-content-between gap-3">
                    <Stack direction="horizontal" className="min-w-0 gap-2 align-items-center">
                      {running ? <PulseDot live variant="info" /> : null}
                      <span className="font-mono fw-semibold text-truncate">
                        {activity.activityType}
                      </span>
                    </Stack>
                    <ActivityStatusBadge status={activity.status} />
                  </Stack>
                  <ProgressBar
                    now={getActivityProgressPercent(activity)}
                    style={{ height: '0.35rem' }}
                    variant={
                      activity.status === 'failed'
                        ? 'danger'
                        : running
                          ? 'info'
                          : 'primary'
                    }
                  />
                  <div className="small text-truncate">
                    {activity.message ?? activity.phase ?? 'In attesa'}
                  </div>
                  <div className="small text-secondary font-mono">
                    {formatRelative(activity.updatedAt)}
                  </div>
                </Stack>
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
          <span className="small text-secondary font-mono">
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
