import { useState } from 'react';

import { Copy, ExternalLink, Pencil } from 'lucide-react';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Stack from 'react-bootstrap/Stack';

import {
  getLinkedInDistanceLabel,
  getLinkedInExperienceLabel,
  getLinkedInWorkplaceLabel,
  type Search,
} from '../../models/search';
import { Panel } from '../Layout/Panel';

function MetaRow({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="d-flex flex-wrap gap-2 align-items-baseline">
      <span className="text-secondary small" style={{ minWidth: '6rem' }}>
        {label}
      </span>
      <span className="d-flex flex-wrap gap-2 align-items-center">{children}</span>
    </div>
  );
}

export function SearchSummaryCard({
  onDuplicate,
  onEdit,
  search,
}: {
  onDuplicate: () => void;
  onEdit: () => void;
  search: Search;
}) {
  const { query } = search;
  const [copied, setCopied] = useState(false);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(query.publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard non disponibile */
    }
  };

  return (
    <Panel
      title={search.name}
      actions={
        <>
          <Badge bg={search.enabled ? 'success' : 'secondary'}>
            {search.enabled ? 'attiva' : 'in pausa'}
          </Badge>
          <Button
            className="d-inline-flex align-items-center gap-2"
            onClick={onDuplicate}
            size="sm"
            variant="outline-secondary"
          >
            <Copy aria-hidden="true" size={14} />
            Duplica
          </Button>
          <Button
            className="d-inline-flex align-items-center gap-2"
            onClick={onEdit}
            size="sm"
            variant="outline-secondary"
          >
            <Pencil aria-hidden="true" size={14} />
            Modifica
          </Button>
        </>
      }
    >
      <Stack className="gap-3">
        <MetaRow label="Keyword">
          <span className="fw-medium">{query.keywords || '-'}</span>
          {query.exactMatch ? (
            <Badge bg="secondary-subtle" text="dark">
              exact match
            </Badge>
          ) : null}
        </MetaRow>
        <MetaRow label="Localita">
          <span className="fw-medium">{query.location || '-'}</span>
          {query.geoId ? (
            <Badge bg="secondary" className="font-mono">
              {query.geoId}
            </Badge>
          ) : null}
          <Badge bg="light" text="dark">
            {getLinkedInDistanceLabel(query.distance)}
          </Badge>
        </MetaRow>
        <MetaRow label="Esperienza">
          {query.experienceLevels.length === 0 ? (
            <span className="text-secondary small">Tutte</span>
          ) : (
            query.experienceLevels.map((level) => (
              <Badge key={level} bg="info-subtle" text="dark">
                {getLinkedInExperienceLabel(level)}
              </Badge>
            ))
          )}
        </MetaRow>
        <MetaRow label="Modalita">
          {query.workplaceTypes.length === 0 ? (
            <span className="text-secondary small">Tutte</span>
          ) : (
            query.workplaceTypes.map((type) => (
              <Badge key={type} bg="info-subtle" text="dark">
                {getLinkedInWorkplaceLabel(type)}
              </Badge>
            ))
          )}
        </MetaRow>

        <div>
          <div className="d-flex justify-content-between align-items-center mb-1">
            <span className="text-secondary small">URL ricerca</span>
            {query.publicUrl ? (
              <Button
                className="p-0 small text-decoration-none"
                onClick={() => void copyUrl()}
                variant="link"
              >
                {copied ? 'Copiato' : 'Copia'}
              </Button>
            ) : null}
          </div>
          <code
            className="d-block font-mono small rounded border bg-light p-2 text-break"
            style={{ wordBreak: 'break-all' }}
          >
            {query.publicUrl || '-'}
          </code>
        </div>

        {query.publicUrl ? (
          <div>
            <Button
              as="a"
              className="d-inline-flex align-items-center gap-2"
              href={query.publicUrl}
              rel="noreferrer"
              size="sm"
              target="_blank"
              variant="outline-primary"
            >
              <ExternalLink aria-hidden="true" size={14} />
              Apri su LinkedIn
            </Button>
          </div>
        ) : null}
      </Stack>
    </Panel>
  );
}
