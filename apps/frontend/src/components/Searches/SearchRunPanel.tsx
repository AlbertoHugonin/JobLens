import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import ListGroup from 'react-bootstrap/ListGroup';
import ProgressBar from 'react-bootstrap/ProgressBar';
import Alert from 'react-bootstrap/Alert';
import Spinner from 'react-bootstrap/Spinner';
import Stack from 'react-bootstrap/Stack';

import {
  getActivityProgressPercent,
  getActivityStatusLabel,
  getActivityStatusVariant,
  isActiveActivity,
  type Activity,
} from '../../models/activity';
import type { Search } from '../../models/search';
import { EmptyState } from '../Utilities/SectionState';

interface LinkedInRunStats {
  jobsCreated: number;
  jobsSeen: number;
  jobsUpdated: number;
  pagesFetched: number;
  rawPayloads: number;
  totalResults: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readRunStats(activity: Activity): LinkedInRunStats | null {
  if (!isRecord(activity.payload) || !isRecord(activity.payload.stats)) {
    return null;
  }

  const stats = activity.payload.stats;
  const totalResults =
    typeof stats.totalResults === 'number' && Number.isFinite(stats.totalResults)
      ? stats.totalResults
      : null;

  return {
    jobsCreated: readNumber(stats.jobsCreated),
    jobsSeen: readNumber(stats.jobsSeen),
    jobsUpdated: readNumber(stats.jobsUpdated),
    pagesFetched: readNumber(stats.pagesFetched),
    rawPayloads: readNumber(stats.rawPayloads),
    totalResults,
  };
}

function formatTimestamp(value: Date): string {
  return value.toLocaleString('it-IT', {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
}

export function SearchRunPanel({
  canRunAll,
  notice,
  onRunAll,
  onRun,
  runningAll,
  running,
  runs,
  search,
}: {
  canRunAll: boolean;
  notice: string | null;
  onRunAll: () => void;
  onRun: (id: string) => void;
  runningAll: boolean;
  running: boolean;
  runs: Activity[];
  search: Search | undefined;
}) {
  const latestRun = runs[0];
  const hasActiveRun = runs.some((activity) => isActiveActivity(activity.status));
  const stats = latestRun ? readRunStats(latestRun) : null;

  return (
    <Card>
      <Card.Header>
        <Stack direction="horizontal" className="justify-content-between gap-3">
          <span className="fw-semibold">Raccolta LinkedIn</span>
          {latestRun ? (
            <Badge bg={getActivityStatusVariant(latestRun.status)}>
              {getActivityStatusLabel(latestRun.status)}
            </Badge>
          ) : null}
        </Stack>
      </Card.Header>
      <Card.Body>
        <Stack className="gap-3">
          {notice ? (
            <Alert className="mb-0 py-2" variant="success">
              {notice}
            </Alert>
          ) : null}
          <Stack direction="horizontal" className="gap-2 flex-wrap">
            <Button
              disabled={!search || running || hasActiveRun}
              onClick={() => search && onRun(search.id)}
              variant="primary"
            >
              {running ? <Spinner animation="border" className="me-2" size="sm" /> : null}
              Avvia raccolta
            </Button>
            <Button
              disabled={!canRunAll || runningAll}
              onClick={onRunAll}
              variant="outline-primary"
            >
              {runningAll ? <Spinner animation="border" className="me-2" size="sm" /> : null}
              Avvia tutte
            </Button>
          </Stack>
          {!search ? <EmptyState message="Seleziona una ricerca salvata" /> : null}
          {search && !latestRun ? (
            <EmptyState message="Nessun run recente per questa ricerca" />
          ) : null}
          {latestRun ? (
            <Stack className="gap-2">
              <ProgressBar
                now={getActivityProgressPercent(latestRun)}
                variant={latestRun.status === 'failed' ? 'danger' : 'primary'}
              />
              <div className="small text-secondary">
                {latestRun.message ?? 'Run raccolta'} · {formatTimestamp(latestRun.updatedAt)}
              </div>
              {stats ? (
                <Stack direction="horizontal" className="gap-2 flex-wrap">
                  <Badge bg="secondary">
                    visti <span className="font-mono">{stats.jobsSeen}</span>
                  </Badge>
                  <Badge bg="secondary">
                    creati <span className="font-mono">{stats.jobsCreated}</span>
                  </Badge>
                  <Badge bg="secondary">
                    aggiornati <span className="font-mono">{stats.jobsUpdated}</span>
                  </Badge>
                  <Badge bg="secondary">
                    pagine <span className="font-mono">{stats.pagesFetched}</span>
                  </Badge>
                </Stack>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      </Card.Body>
      {runs.length > 1 ? (
        <ListGroup variant="flush">
          {runs.slice(1).map((activity) => (
            <ListGroup.Item key={activity.id}>
              <Stack direction="horizontal" className="justify-content-between gap-3">
                <span className="small text-truncate">
                  {activity.message ?? activity.activityType}
                </span>
                <Badge bg={getActivityStatusVariant(activity.status)}>
                  {getActivityStatusLabel(activity.status)}
                </Badge>
              </Stack>
            </ListGroup.Item>
          ))}
        </ListGroup>
      ) : null}
    </Card>
  );
}
