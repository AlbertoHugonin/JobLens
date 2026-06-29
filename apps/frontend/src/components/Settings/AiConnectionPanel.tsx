import { useEffect, useRef, useState } from 'react';

import { Plus, Trash2 } from 'lucide-react';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import Form from 'react-bootstrap/Form';
import ListGroup from 'react-bootstrap/ListGroup';
import Modal from 'react-bootstrap/Modal';
import Spinner from 'react-bootstrap/Spinner';
import Stack from 'react-bootstrap/Stack';

import { EmptyState, ErrorState, LoadingState } from '../Utilities/SectionState';
import { useAiSettings } from '../../contexts/AiSettingsContext';
import { probeAiEndpointUrl } from '../../API/ai';
import type { AiEndpoint, AiEndpointHealth } from '../../models/ai';
import { validateAiEndpointDraft } from '../../services/aiService';

function EndpointHealthBadge({
  checking,
  health,
}: {
  checking: boolean;
  health: AiEndpointHealth | undefined;
}) {
  if (checking) {
    return (
      <Badge bg="secondary" className="d-inline-flex align-items-center gap-1">
        <Spinner animation="border" size="sm" />
        Verifico
      </Badge>
    );
  }

  if (!health) {
    return null;
  }

  if (health.reachable) {
    return (
      <Badge bg="success" title={health.version ? `Ollama ${health.version}` : undefined}>
        Online
        {health.latencyMs !== null ? (
          <>
            {' · '}
            <span className="font-mono">{health.latencyMs} ms</span>
          </>
        ) : null}
      </Badge>
    );
  }

  return (
    <Badge bg="danger" title={health.message ?? undefined}>
      Offline
    </Badge>
  );
}

function EndpointRow({
  endpoint,
  onRequestDelete,
}: {
  endpoint: AiEndpoint;
  onRequestDelete: (endpoint: AiEndpoint) => void;
}) {
  const {
    activateEndpoint,
    checkEndpointHealth,
    deletingEndpointId,
    endpointHealth,
    healthCheckingIds,
    mutatingEndpointId,
    updateEndpoint,
  } = useAiSettings();
  const mutating = mutatingEndpointId === endpoint.id;
  const checking = healthCheckingIds.includes(endpoint.id);
  const deleting = deletingEndpointId === endpoint.id;
  const health = endpointHealth[endpoint.id];
  const [useError, setUseError] = useState<string | null>(null);

  const handleUse = async () => {
    if (endpoint.isActive) {
      return;
    }

    // Check reachability on the spot: only put a server "in use" if it responds,
    // otherwise leave the previously active one untouched.
    setUseError(null);
    const probed = await checkEndpointHealth(endpoint.id);
    if (!probed || !probed.reachable) {
      setUseError('Server non raggiungibile: non messo in uso.');
      return;
    }

    // Activation requires the endpoint to be enabled; enable it on the fly so the
    // user only ever picks "which server to use".
    if (!endpoint.enabled) {
      const updated = await updateEndpoint(endpoint.id, { enabled: true });
      if (!updated) {
        return;
      }
    }

    await activateEndpoint(endpoint.id);
  };

  return (
    <ListGroup.Item active={endpoint.isActive}>
      <Stack className="gap-1">
        <Stack direction="horizontal" className="gap-3 align-items-center">
          <Form.Check
            checked={endpoint.isActive}
            className="ai-endpoint-radio min-w-0 flex-grow-1 mb-0"
            disabled={mutating || checking}
            id={`ai-endpoint-radio-${endpoint.id}`}
            label={
              <span className="d-block">
                <span className="d-flex align-items-center gap-2">
                  <span className="fw-semibold text-truncate">{endpoint.name}</span>
                  {endpoint.isActive ? <Badge bg="success">In uso</Badge> : null}
                </span>
                <span className="small text-secondary font-mono d-block text-truncate">
                  {endpoint.baseUrl}
                </span>
              </span>
            }
            name="ai-active-endpoint"
            onChange={() => void handleUse()}
            type="radio"
          />
          <EndpointHealthBadge checking={checking} health={health} />
          <Button
            disabled={checking}
            onClick={() => void checkEndpointHealth(endpoint.id)}
            size="sm"
            variant="outline-secondary"
          >
            Verifica
          </Button>
          <Button
            aria-label="Elimina server"
            disabled={deleting}
            onClick={() => onRequestDelete(endpoint)}
            size="sm"
            variant="outline-danger"
          >
            {deleting ? <Spinner animation="border" size="sm" /> : <Trash2 size={15} />}
          </Button>
          {mutating ? <Spinner animation="border" size="sm" /> : null}
        </Stack>
        {useError && !endpoint.isActive ? (
          <div className="small text-danger ps-4 ms-1">{useError}</div>
        ) : null}
      </Stack>
    </ListGroup.Item>
  );
}

export function AiConnectionPanel() {
  const {
    checkEndpointHealth,
    createEndpoint,
    creatingEndpoint,
    deletingEndpointId,
    endpointError,
    endpoints,
    loadingEndpoints,
    removeEndpoint,
  } = useAiSettings();
  const [showAdd, setShowAdd] = useState(false);
  const [endpointName, setEndpointName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AiEndpoint | null>(null);
  const probedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const endpoint of endpoints) {
      if (!probedRef.current.has(endpoint.id)) {
        probedRef.current.add(endpoint.id);
        void checkEndpointHealth(endpoint.id);
      }
    }
  }, [checkEndpointHealth, endpoints]);

  const openAdd = () => {
    setEndpointName('');
    setBaseUrl('');
    setAddError(null);
    setShowAdd(true);
  };

  const handleAdd = async () => {
    const validation = validateAiEndpointDraft({ baseUrl, name: endpointName });
    if (validation) {
      setAddError(validation);
      return;
    }

    setProbing(true);
    setAddError(null);
    try {
      // Add the server only if it answers the health probe right now.
      const response = await probeAiEndpointUrl(baseUrl.trim());
      if (!response.data.reachable) {
        setAddError(`${response.data.message ?? 'Server non raggiungibile'}. Non aggiunto.`);
        return;
      }

      const endpoint = await createEndpoint({
        baseUrl: baseUrl.trim(),
        enabled: true,
        name: endpointName.trim(),
      });
      if (endpoint) {
        setShowAdd(false);
      }
    } catch (caught: unknown) {
      setAddError(caught instanceof Error ? caught.message : 'Controllo non riuscito');
    } finally {
      setProbing(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) {
      return;
    }

    const removed = await removeEndpoint(confirmDelete.id);
    if (removed) {
      setConfirmDelete(null);
    }
  };

  const busy = probing || creatingEndpoint;
  const deleting = deletingEndpointId !== null;

  return (
    <Card className="h-100">
      <Card.Header>
        <Stack direction="horizontal" className="justify-content-between gap-3">
          <span className="fw-semibold">Server configurati</span>
          <Stack direction="horizontal" className="gap-2 align-items-center">
            {loadingEndpoints ? <Spinner animation="border" size="sm" /> : null}
            <Button onClick={openAdd} size="sm" variant="outline-primary">
              <Plus className="me-1" size={16} />
              Aggiungi
            </Button>
          </Stack>
        </Stack>
      </Card.Header>
      {endpointError ? (
        <Card.Body className="pb-0">
          <ErrorState message={endpointError} />
        </Card.Body>
      ) : null}
      <ListGroup variant="flush">
        {loadingEndpoints && endpoints.length === 0 ? (
          <ListGroup.Item>
            <LoadingState label="Caricamento server" />
          </ListGroup.Item>
        ) : null}
        {!loadingEndpoints && endpoints.length === 0 ? (
          <ListGroup.Item>
            <EmptyState message="Nessun server configurato. Aggiungine uno con il pulsante in alto." />
          </ListGroup.Item>
        ) : null}
        {endpoints.map((endpoint) => (
          <EndpointRow endpoint={endpoint} key={endpoint.id} onRequestDelete={setConfirmDelete} />
        ))}
      </ListGroup>

      <Modal centered onHide={() => (busy ? undefined : setShowAdd(false))} show={showAdd}>
        <Modal.Header closeButton>
          <Modal.Title className="h5 mb-0">Aggiungi server AI</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Stack className="gap-3">
            {addError ? <ErrorState message={addError} /> : null}
            <Form.Group controlId="ai-add-name">
              <Form.Label>Nome</Form.Label>
              <Form.Control
                onChange={(event) => setEndpointName(event.target.value)}
                placeholder="Ollama locale"
                type="text"
                value={endpointName}
              />
            </Form.Group>
            <Form.Group controlId="ai-add-url">
              <Form.Label>Base URL</Form.Label>
              <Form.Control
                className="font-mono"
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="http://localhost:11434"
                type="url"
                value={baseUrl}
              />
              <Form.Text className="text-secondary">
                Verrà aggiunto solo se risponde al controllo.
              </Form.Text>
            </Form.Group>
          </Stack>
        </Modal.Body>
        <Modal.Footer>
          <Button disabled={busy} onClick={() => setShowAdd(false)} variant="outline-secondary">
            Annulla
          </Button>
          <Button disabled={busy} onClick={() => void handleAdd()}>
            {busy ? <Spinner animation="border" className="me-2" size="sm" /> : null}
            Controlla e aggiungi
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        centered
        onHide={() => (deleting ? undefined : setConfirmDelete(null))}
        show={confirmDelete !== null}
      >
        <Modal.Header closeButton>
          <Modal.Title className="h5 mb-0">Elimina server</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {endpointError ? <ErrorState message={endpointError} /> : null}
          {confirmDelete ? (
            <p className="mb-0">
              Vuoi eliminare <span className="fw-semibold">{confirmDelete.name}</span>? I modelli
              associati a questo server verranno rimossi dall'elenco.
            </p>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button
            disabled={deleting}
            onClick={() => setConfirmDelete(null)}
            variant="outline-secondary"
          >
            Annulla
          </Button>
          <Button disabled={deleting} onClick={() => void handleConfirmDelete()} variant="danger">
            {deleting ? <Spinner animation="border" className="me-2" size="sm" /> : null}
            Elimina
          </Button>
        </Modal.Footer>
      </Modal>
    </Card>
  );
}
