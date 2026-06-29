import Button from 'react-bootstrap/Button';
import Badge from 'react-bootstrap/Badge';
import Dropdown from 'react-bootstrap/Dropdown';
import Form from 'react-bootstrap/Form';
import ProgressBar from 'react-bootstrap/ProgressBar';
import Spinner from 'react-bootstrap/Spinner';
import Stack from 'react-bootstrap/Stack';

import { useDebugMode } from '../../contexts/DebugModeContext';
import {
  activityStatusOptions,
  activityTypeOptions,
  getActivityProgressPercent,
  isActiveActivity,
  type ActivityDashboardSummary,
  type ActivityFilters,
} from '../../models/activity';
import { ConfirmActionButton } from '../Utilities/ConfirmActionButton';
import { formatRelative } from './activityFormat';
import { PulseDot } from './PulseDot';

const liveModeConfig = {
  connecting: { label: 'Connessione', live: false, variant: 'secondary' },
  polling: { label: 'Polling', live: false, variant: 'warning' },
  sse: { label: 'Live', live: true, variant: 'success' },
} as const;

function LiveModePill({ mode }: { mode: 'connecting' | 'polling' | 'sse' }) {
  const config = liveModeConfig[mode];
  return (
    <span className="d-inline-flex align-items-center gap-2" title={`Aggiornamenti: ${config.label}`}>
      <PulseDot live={config.live} variant={config.variant} />
      <span className="form-eyebrow">{config.label}</span>
    </span>
  );
}

function statusCount(summary: ActivityDashboardSummary | null, key: string): number {
  return summary?.byStatus.find((item) => item.key === key)?.count ?? 0;
}

function activeFilterCount(filters: ActivityFilters): number {
  return [filters.status, filters.type, filters.source.trim()].filter(Boolean).length;
}

export function LiveQueueBanner({
  cancellingQueue,
  creating,
  filters,
  lastUpdatedAt,
  liveMode,
  loading,
  onCancelQueue,
  onChange,
  onCreateDummy,
  onRefresh,
  summary,
}: {
  cancellingQueue: boolean;
  creating: boolean;
  filters: ActivityFilters;
  lastUpdatedAt: Date | null;
  liveMode: 'connecting' | 'polling' | 'sse';
  loading: boolean;
  onCancelQueue: () => void;
  onChange: (filters: ActivityFilters) => void;
  onCreateDummy: () => void;
  onRefresh: () => void;
  summary: ActivityDashboardSummary | null;
}) {
  const { debugMode } = useDebugMode();
  const running = statusCount(summary, 'running');
  const queued = statusCount(summary, 'queued');
  const isLive = running + queued > 0;
  const hasActiveQueue = summary === null || isLive;

  const activeItems = (summary?.active ?? []).filter((item) => isActiveActivity(item.status));
  const avgProgress =
    activeItems.length > 0
      ? activeItems.reduce((total, item) => total + getActivityProgressPercent(item), 0) /
        activeItems.length
      : 0;

  const typeLabel = filters.type ? ` di tipo ${filters.type}` : '';
  const sourceLabel = filters.source.trim() ? ` con origine ${filters.source.trim()}` : '';
  const filterCount = activeFilterCount(filters);

  return (
    <div className={`live-banner live-banner-compact ${isLive ? 'is-live' : 'is-idle'}`}>
      <Stack direction="horizontal" className="live-banner-row flex-wrap gap-2">
        <div className="d-flex min-w-0 flex-grow-1 align-items-center gap-3">
          <PulseDot live={isLive} variant={isLive ? 'info' : 'secondary'} />
          <div className="min-w-0">
            <Stack direction="horizontal" className="align-items-center flex-wrap gap-2">
              <span className="form-eyebrow">{isLive ? 'Coda al lavoro' : 'Coda ferma'}</span>
              <LiveModePill mode={liveMode} />
              {lastUpdatedAt ? (
                <span className="small text-secondary">
                  aggiornato {formatRelative(lastUpdatedAt)}
                </span>
              ) : null}
            </Stack>
            <Stack direction="horizontal" className="live-banner-counts flex-wrap gap-2">
              <span>
                <span className="font-mono fw-semibold">{running}</span> in corso
              </span>
              <span className="text-secondary">·</span>
              <span>
                <span className="font-mono fw-semibold">{queued}</span> in coda
              </span>
              <span className="text-secondary">·</span>
              <span className="text-secondary">
                <span className="font-mono">{summary?.total ?? 0}</span> totali
              </span>
            </Stack>
          </div>
        </div>

        <Stack direction="horizontal" className="live-banner-actions flex-wrap justify-content-end gap-2">
          <Button disabled={loading} onClick={onRefresh} size="sm" variant="outline-secondary">
            Aggiorna
          </Button>
          {debugMode ? (
            <Button disabled={creating} onClick={onCreateDummy} size="sm" variant="outline-primary">
              {creating ? <Spinner animation="border" className="me-2" size="sm" /> : null}
              Crea prova
            </Button>
          ) : null}
          <ConfirmActionButton
            confirmLabel="Annulla coda"
            confirmMessage={`Le attivita in coda verranno annullate e quelle in corso riceveranno una richiesta di annullamento${typeLabel}${sourceLabel}.`}
            confirmTitle="Annullare la coda?"
            disabled={cancellingQueue || !hasActiveQueue}
            onConfirm={onCancelQueue}
            size="sm"
            variant="outline-danger"
          >
            {cancellingQueue ? <Spinner animation="border" className="me-2" size="sm" /> : null}
            Annulla coda
          </ConfirmActionButton>
          <Dropdown align="end" autoClose="outside">
            <Dropdown.Toggle size="sm" variant={filterCount > 0 ? 'primary' : 'outline-secondary'}>
              Filtri
              {filterCount > 0 ? (
                <Badge bg="light" className="ms-2" text="dark">
                  {filterCount}
                </Badge>
              ) : null}
            </Dropdown.Toggle>
            <Dropdown.Menu className="activity-filter-menu shadow-sm" renderOnMount>
              <Stack className="gap-3 p-3">
                <Form.Group controlId="activity-status-filter">
                  <Form.Label className="form-eyebrow mb-1">Stato</Form.Label>
                  <Form.Select
                    aria-label="Stato attivita"
                    onChange={(event) =>
                      onChange({
                        ...filters,
                        status: event.currentTarget.value as ActivityFilters['status'],
                      })
                    }
                    size="sm"
                    value={filters.status}
                  >
                    <option value="">Tutti gli stati</option>
                    {activityStatusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
                <Form.Group controlId="activity-type-filter">
                  <Form.Label className="form-eyebrow mb-1">Tipo</Form.Label>
                  <Form.Select
                    aria-label="Tipo attivita"
                    onChange={(event) => onChange({ ...filters, type: event.currentTarget.value })}
                    size="sm"
                    value={filters.type}
                  >
                    <option value="">Tutti i tipi</option>
                    {activityTypeOptions.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
                <Form.Group controlId="activity-source-filter">
                  <Form.Label className="form-eyebrow mb-1">Origine</Form.Label>
                  <Form.Control
                    aria-label="Origine coda"
                    onChange={(event) => onChange({ ...filters, source: event.currentTarget.value })}
                    placeholder="api, scheduler"
                    size="sm"
                    value={filters.source}
                  />
                </Form.Group>
              </Stack>
            </Dropdown.Menu>
          </Dropdown>
        </Stack>
      </Stack>

      {isLive ? (
        <div className="live-banner-progress" title={`Avanzamento globale ${Math.round(avgProgress)}%`}>
          <ProgressBar
            animated
            now={Math.max(avgProgress, 6)}
            striped
            variant="info"
          />
        </div>
      ) : null}
    </div>
  );
}
