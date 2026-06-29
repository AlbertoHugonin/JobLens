import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';

import {
  getServiceStatusLabel,
  getServiceStatusVariant,
  type ServiceHealth,
} from '../../models/health';
import { Panel } from '../Layout/Panel';
import { AsyncSection } from '../Utilities/AsyncSection';

interface ServiceHealthPanelProps {
  error: string | null;
  health: ServiceHealth | undefined;
  loading: boolean;
  onRefresh: () => void;
}

export function ServiceHealthPanel({ error, health, loading, onRefresh }: ServiceHealthPanelProps) {
  return (
    <Panel
      title="API"
      actions={
        health ? (
          <Badge bg={getServiceStatusVariant(health.status)}>
            {getServiceStatusLabel(health.status)}
          </Badge>
        ) : undefined
      }
    >
      <p className="text-secondary">Stato del servizio Fastify</p>

      <AsyncSection
        emptyMessage="Stato non caricato"
        error={error}
        isEmpty={!health}
        loading={loading && !health}
        loadingLabel="Verifica API"
      >
        {health ? (
          <dl className="row mb-0">
            <dt className="col-sm-4 text-secondary fw-normal">Versione</dt>
            <dd className="col-sm-8">{health.version}</dd>
            <dt className="col-sm-4 text-secondary fw-normal">Uptime</dt>
            <dd className="col-sm-8">{health.uptimeSeconds}s</dd>
            <dt className="col-sm-4 text-secondary fw-normal">Controllato</dt>
            <dd className="col-sm-8">{health.checkedAt.toLocaleString()}</dd>
          </dl>
        ) : null}
      </AsyncSection>

      <Button
        className="mt-3"
        disabled={loading}
        onClick={onRefresh}
        size="sm"
        variant="outline-primary"
      >
        Aggiorna
      </Button>
    </Panel>
  );
}
