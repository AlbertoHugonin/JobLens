import { Plus } from 'lucide-react';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import ListGroup from 'react-bootstrap/ListGroup';
import Stack from 'react-bootstrap/Stack';

import {
  getLinkedInDistanceLabel,
  getLinkedInExperienceLabel,
  getLinkedInWorkplaceLabel,
  type Search,
} from '../../models/search';
import { EmptyState, ErrorState, LoadingState } from '../Utilities/SectionState';
import { ConfirmActionButton } from '../Utilities/ConfirmActionButton';

function formatTimestamp(value: Date): string {
  return value.toLocaleString('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export function SearchList({
  error,
  loading,
  onCreate,
  onDelete,
  onSelect,
  searches,
  selectedId,
  total,
}: {
  error: string | null;
  loading: boolean;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
  searches: Search[];
  selectedId: string | null;
  total: number;
}) {
  return (
    <Card className="search-list-card scroll-card h-100">
      <Card.Header>
        <Stack direction="horizontal" className="justify-content-between align-items-center gap-2">
          <span className="fw-semibold">Ricerche</span>
          <Stack direction="horizontal" className="align-items-center gap-2">
            <Badge bg="secondary" className="font-mono">
              {total}
            </Badge>
            <Button
              aria-label="Nuova ricerca"
              className="d-inline-flex align-items-center justify-content-center p-1"
              onClick={onCreate}
              size="sm"
              title="Nuova ricerca"
              variant="primary"
            >
              <Plus aria-hidden="true" size={16} />
            </Button>
          </Stack>
        </Stack>
      </Card.Header>
      {error ? (
        <Card.Body>
          <ErrorState message={error} />
        </Card.Body>
      ) : null}
      {!error && loading && searches.length === 0 ? (
        <Card.Body>
          <LoadingState label="Caricamento ricerche" />
        </Card.Body>
      ) : null}
      {!error && !loading && searches.length === 0 ? (
        <Card.Body>
          <EmptyState message="Nessuna ricerca salvata. Creane una con Nuova ricerca." />
        </Card.Body>
      ) : null}
      {searches.length > 0 ? (
        <ListGroup variant="flush">
          {searches.map((search) => (
            <ListGroup.Item
              key={search.id}
              action
              active={search.id === selectedId}
              onClick={() => onSelect(search.id)}
            >
              <Stack className="gap-2">
                <Stack direction="horizontal" className="justify-content-between gap-3">
                  <span className="fw-semibold text-truncate">{search.name}</span>
                  <Badge bg={search.enabled ? 'success' : 'secondary'}>
                    {search.enabled ? 'attiva' : 'pausa'}
                  </Badge>
                </Stack>
                <div className="small text-truncate">
                  {search.query.keywords} · {search.query.location}
                </div>
                <Stack direction="horizontal" className="flex-wrap gap-1">
                  <Badge bg="light" text="dark">
                    {getLinkedInDistanceLabel(search.query.distance)}
                  </Badge>
                  {search.query.experienceLevels.map((level) => (
                    <Badge key={level} bg="info-subtle" text="dark">
                      {getLinkedInExperienceLabel(level)}
                    </Badge>
                  ))}
                  {search.query.workplaceTypes.map((type) => (
                    <Badge key={type} bg="info-subtle" text="dark">
                      {getLinkedInWorkplaceLabel(type)}
                    </Badge>
                  ))}
                </Stack>
                <Stack direction="horizontal" className="justify-content-between align-items-center gap-2">
                  <span className="small text-secondary font-mono">
                    {formatTimestamp(search.updatedAt)}
                  </span>
                  <ConfirmActionButton
                    confirmMessage={
                      <>
                        La ricerca <strong>{search.name}</strong> verra eliminata. Le offerte gia
                        raccolte resteranno nel database.
                      </>
                    }
                    confirmTitle="Eliminare ricerca?"
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                    onConfirm={() => onDelete(search.id)}
                    size="sm"
                    title="Elimina ricerca"
                    variant="outline-danger"
                  >
                    Elimina
                  </ConfirmActionButton>
                </Stack>
              </Stack>
            </ListGroup.Item>
          ))}
        </ListGroup>
      ) : null}
    </Card>
  );
}
