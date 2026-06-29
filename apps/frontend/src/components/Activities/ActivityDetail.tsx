import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import Col from 'react-bootstrap/Col';
import ListGroup from 'react-bootstrap/ListGroup';
import ProgressBar from 'react-bootstrap/ProgressBar';
import Row from 'react-bootstrap/Row';
import Stack from 'react-bootstrap/Stack';

import { useDebugMode } from '../../contexts/DebugModeContext';
import {
  canCancelActivity,
  canRetryActivity,
  getActivityLogVariant,
  getActivityProgressPercent,
  isLinkedInActivity,
  type Activity,
  type ActivityLog,
  type LinkedInActivityDebug,
  type LinkedInRawPayloadDebug,
} from '../../models/activity';
import { EmptyState, ErrorState, LoadingState } from '../Utilities/SectionState';
import { ConfirmActionButton } from '../Utilities/ConfirmActionButton';
import { ActivityStatusBadge } from './ActivityStatusBadge';
import { formatClock, formatRelative, formatTimestamp } from './activityFormat';
import { PulseDot } from './PulseDot';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="form-eyebrow mb-2">{children}</div>;
}

function Vital({ label, value }: { label: string; value: string | number }) {
  return (
    <Col sm={6} xl={4}>
      <div className="small text-secondary">{label}</div>
      <div className="fw-medium font-mono text-break">{value}</div>
    </Col>
  );
}

interface ActivityArtifact {
  byteLength: number;
  content: string;
  contentType: string;
  fileName: string;
  kind: string;
  lineCount: number;
}

function readArtifact(payload: unknown): ActivityArtifact | null {
  if (!payload || typeof payload !== 'object' || !('artifact' in payload)) {
    return null;
  }

  const artifact = (payload as { artifact?: unknown }).artifact;
  if (!artifact || typeof artifact !== 'object') {
    return null;
  }

  const record = artifact as Record<string, unknown>;
  if (
    typeof record.content !== 'string' ||
    typeof record.contentType !== 'string' ||
    typeof record.fileName !== 'string' ||
    typeof record.kind !== 'string'
  ) {
    return null;
  }

  return {
    byteLength: typeof record.byteLength === 'number' ? record.byteLength : record.content.length,
    content: record.content,
    contentType: record.contentType,
    fileName: record.fileName,
    kind: record.kind,
    lineCount: typeof record.lineCount === 'number' ? record.lineCount : 0,
  };
}

function downloadArtifact(artifact: ActivityArtifact): void {
  const blob = new Blob([artifact.content], { type: artifact.contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function getHttpStatusVariant(status: number | null): 'danger' | 'secondary' | 'success' | 'warning' {
  if (status === null) {
    return 'secondary';
  }
  if (status >= 500) {
    return 'danger';
  }
  if (status >= 400) {
    return 'warning';
  }
  return 'success';
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function LinkedInRawPayloadItem({ item }: { item: LinkedInRawPayloadDebug }) {
  return (
    <ListGroup.Item className="px-0">
      <Stack className="gap-2">
        <Stack direction="horizontal" className="justify-content-between align-items-start gap-3">
          <div className="min-w-0">
            <div className="fw-medium font-mono small text-break">
              {item.requestUrl ?? 'URL richiesta non disponibile'}
            </div>
            <div className="small text-secondary font-mono">{formatTimestamp(item.createdAt)}</div>
          </div>
          <Stack direction="horizontal" className="gap-2 flex-wrap justify-content-end">
            <Badge bg={getHttpStatusVariant(item.responseStatus)}>
              HTTP {item.responseStatus ?? 'n/d'}
            </Badge>
            <Badge bg="secondary">{item.payloadKind}</Badge>
          </Stack>
        </Stack>

        <Row className="g-3">
          <Vital label="Content type" value={item.contentType ?? '-'} />
          <Vital label="Tempo" value={item.elapsedMs === null ? '-' : `${item.elapsedMs} ms`} />
        </Row>

        {item.error ? (
          <div>
            <div className="small text-secondary">Errore rilevato</div>
            <div className="fw-medium text-danger text-break">{item.error}</div>
          </div>
        ) : null}

        <div>
          <div className="small text-secondary mb-1">Parametri richiesta</div>
          <pre className="debug-snippet mb-0">{formatJson(item.requestParams)}</pre>
        </div>

        {item.snippet ? (
          <div>
            <div className="small text-secondary mb-1">Snippet risposta</div>
            <pre className="debug-snippet mb-0">{item.snippet}</pre>
          </div>
        ) : null}
      </Stack>
    </ListGroup.Item>
  );
}

function LinkedInDebugPanel({
  debug,
  error,
  loading,
}: {
  debug: LinkedInActivityDebug | null;
  error: string | null;
  loading: boolean;
}) {
  return (
    <section>
      <Stack direction="horizontal" className="justify-content-between mb-2 gap-3">
        <SectionLabel>Debug LinkedIn</SectionLabel>
        {debug ? (
          <Stack direction="horizontal" className="gap-2 flex-wrap justify-content-end">
            <Badge bg={debug.failed > 0 ? 'danger' : 'secondary'}>Errori {debug.failed}</Badge>
            <Badge bg="secondary">Raw {debug.total}</Badge>
          </Stack>
        ) : null}
      </Stack>
      {loading ? <LoadingState label="Caricamento debug LinkedIn" /> : null}
      {error ? <ErrorState message={error} /> : null}
      {!loading && !error && debug && debug.total === 0 ? (
        <EmptyState message="Nessun raw payload LinkedIn salvato per questa attivita" />
      ) : null}
      {!loading && !error && debug && debug.total > 0 ? (
        <Stack className="gap-3">
          <Stack direction="horizontal" className="gap-2 flex-wrap">
            <Badge bg={getHttpStatusVariant(debug.latestStatus)}>
              Ultimo HTTP {debug.latestStatus ?? 'n/d'}
            </Badge>
            {debug.statusCounts.map((item) => (
              <Badge key={item.status} bg="secondary">
                {item.status}: {item.count}
              </Badge>
            ))}
          </Stack>
          <ListGroup variant="flush">
            {debug.items.map((item) => (
              <LinkedInRawPayloadItem key={item.id} item={item} />
            ))}
          </ListGroup>
        </Stack>
      ) : null}
    </section>
  );
}

export function ActivityDetail({
  activity,
  linkedinDebug,
  linkedinDebugError,
  logs,
  logsError,
  loading,
  loadingLinkedInDebug,
  loadingLogs,
  mutating,
  onCancel,
  onRetry,
}: {
  activity: Activity | undefined;
  linkedinDebug: LinkedInActivityDebug | null;
  linkedinDebugError: string | null;
  logs: ActivityLog[];
  logsError: string | null;
  loading: boolean;
  loadingLinkedInDebug: boolean;
  loadingLogs: boolean;
  mutating: boolean;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const { debugMode } = useDebugMode();

  if (!activity) {
    return (
      <Card>
        <Card.Body>
          <EmptyState message="Seleziona un run dalla timeline per vederne i dettagli." />
        </Card.Body>
      </Card>
    );
  }

  const running = activity.status === 'running';
  const canCancel = canCancelActivity(activity);
  const canRetry = canRetryActivity(activity);
  const artifact = readArtifact(activity.payload);
  const subject = activity.subjectType
    ? `${activity.subjectType}${activity.subjectId ? ` · ${activity.subjectId}` : ''}`
    : '-';

  return (
    <Card className="activity-detail-card">
      <Card.Header>
        <Stack direction="horizontal" className="justify-content-between gap-3">
          <Stack direction="horizontal" className="min-w-0 gap-2 align-items-center">
            {running ? <PulseDot live variant="info" /> : null}
            <span className="font-mono fw-semibold text-truncate">{activity.activityType}</span>
            <ActivityStatusBadge status={activity.status} />
          </Stack>
          <Stack direction="horizontal" className="gap-2">
            {canCancel ? (
              <ConfirmActionButton
                confirmMessage="Il run verra annullato in modo cooperativo. Se e gia in esecuzione, il worker lo chiudera al prossimo punto di controllo."
                confirmTitle="Annullare il run?"
                disabled={mutating}
                onConfirm={() => onCancel(activity.id)}
                size="sm"
                variant="outline-danger"
              >
                Annulla
              </ConfirmActionButton>
            ) : null}
            {canRetry ? (
              <Button
                disabled={mutating}
                onClick={() => onRetry(activity.id)}
                size="sm"
                variant="outline-primary"
              >
                Riprova
              </Button>
            ) : null}
          </Stack>
        </Stack>
      </Card.Header>
      <Card.Body>
        <Stack className="gap-4">
          {loading ? <LoadingState label="Aggiornamento dettaglio" /> : null}

          <section>
            <Stack className="gap-2">
              <ProgressBar
                label={`${activity.progressCurrent}/${activity.progressTotal ?? '-'}`}
                now={getActivityProgressPercent(activity)}
                variant={activity.status === 'failed' ? 'danger' : running ? 'info' : 'primary'}
              />
              <div className="text-secondary">{activity.message ?? activity.phase ?? '-'}</div>
              {activity.error ? <ErrorState message={activity.error} /> : null}
            </Stack>
          </section>

          <section>
            <SectionLabel>Vitali del run</SectionLabel>
            <Row className="g-3">
              <Vital label="ID" value={activity.id} />
              <Vital label="Origine" value={activity.source} />
              <Vital label="Tentativo" value={`${activity.attempt}/${activity.maxAttempts}`} />
              <Vital label="Soggetto" value={subject} />
              <Vital label="Creato" value={formatTimestamp(activity.createdAt)} />
              <Vital label="Avviato" value={formatTimestamp(activity.startedAt)} />
              <Vital label="Concluso" value={formatTimestamp(activity.finishedAt)} />
              <Vital label="Heartbeat" value={formatRelative(activity.heartbeatAt)} />
              <Vital label="Lease" value={activity.leaseOwner ?? '-'} />
            </Row>
          </section>

          {artifact ? (
            <section>
              <Stack direction="horizontal" className="justify-content-between mb-2 gap-3">
                <SectionLabel>Artefatto</SectionLabel>
                <Badge bg="secondary">{artifact.kind}</Badge>
              </Stack>
              <Row className="g-3 align-items-end">
                <Vital label="File" value={artifact.fileName} />
                <Vital label="Righe" value={artifact.lineCount} />
                <Vital label="Byte" value={artifact.byteLength} />
                <Col sm={6} xl={4}>
                  <Button
                    onClick={() => downloadArtifact(artifact)}
                    size="sm"
                    variant="outline-primary"
                  >
                    Scarica
                  </Button>
                </Col>
              </Row>
            </section>
          ) : null}

          {debugMode && isLinkedInActivity(activity) ? (
            <LinkedInDebugPanel
              debug={linkedinDebug}
              error={linkedinDebugError}
              loading={loadingLinkedInDebug}
            />
          ) : null}

          <section>
            <Stack direction="horizontal" className="justify-content-between mb-2 gap-3">
              <SectionLabel>Console</SectionLabel>
              {loadingLogs ? <Badge bg="secondary">Aggiornamento</Badge> : null}
            </Stack>
            {logsError ? <ErrorState message={logsError} /> : null}
            {!logsError && logs.length === 0 && !loadingLogs ? (
              <EmptyState message="Nessun log per questo run." />
            ) : null}
            {logs.length > 0 ? (
              <div>
                {logs.map((log) => (
                  <div className="console-row" key={log.id}>
                    <Stack direction="horizontal" className="align-items-start gap-3">
                      <span className="console-time">{formatClock(log.createdAt)}</span>
                      <Badge
                        bg={getActivityLogVariant(log.level)}
                        className="font-mono text-uppercase"
                      >
                        {log.level}
                      </Badge>
                      <div className="flex-grow-1 activity-log-message">{log.message}</div>
                    </Stack>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        </Stack>
      </Card.Body>
    </Card>
  );
}
