import { useEffect, useMemo, useRef, useState } from 'react';

import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import Col from 'react-bootstrap/Col';
import Form from 'react-bootstrap/Form';
import ListGroup from 'react-bootstrap/ListGroup';
import Modal from 'react-bootstrap/Modal';
import ProgressBar from 'react-bootstrap/ProgressBar';
import Row from 'react-bootstrap/Row';
import Spinner from 'react-bootstrap/Spinner';
import Stack from 'react-bootstrap/Stack';

import { ActivityStatusBadge } from '../Activities/ActivityStatusBadge';
import { EmptyState, ErrorState, LoadingState } from '../Utilities/SectionState';
import { useAiSettings } from '../../contexts/AiSettingsContext';
import { getActivityProgressPercent } from '../../models/activity';
import type { AiModel } from '../../models/ai';
import { validateAiModelName } from '../../services/aiService';

/** Installed-model options, keeping the saved value selectable even if it is no
 * longer installed so the configuration is never silently lost. */
function modelOptions(installed: string[], value: string): string[] {
  return value && !installed.includes(value) ? [value, ...installed] : installed;
}

export function AiModelPanel() {
  const {
    deletingModelId,
    endpoints,
    installActivity,
    installModel,
    installingModel,
    loadModels,
    loadingModels,
    modelError,
    models,
    removeModel,
    saveSettings,
    savingSettings,
    settings,
  } = useAiSettings();

  const [evalModel, setEvalModel] = useState('');
  const [priorityModel, setPriorityModel] = useState('');
  const [showInstall, setShowInstall] = useState(false);
  const [installName, setInstallName] = useState('');
  const [modelFormError, setModelFormError] = useState<string | null>(null);
  const [confirmModel, setConfirmModel] = useState<AiModel | null>(null);
  const syncedEndpointRef = useRef<string | null>(null);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setEvalModel(settings.runtime.modelName);
    setPriorityModel(settings.runtime.priorityModelName);
  }, [settings]);

  const installedModels = useMemo(
    () =>
      Array.from(
        new Set(models.filter((model) => model.installed).map((model) => model.name)),
      ).sort(),
    [models],
  );

  // Installation always targets the server currently in use in the Connessione section.
  const activeEndpoint = useMemo(() => endpoints.find((endpoint) => endpoint.isActive), [endpoints]);
  const refreshModelsTitle = activeEndpoint
    ? `Aggiorna modelli da ${activeEndpoint.name}`
    : 'Seleziona un server AI nella sezione Connessione';

  useEffect(() => {
    if (!activeEndpoint) {
      syncedEndpointRef.current = null;
      return;
    }

    if (syncedEndpointRef.current === activeEndpoint.id) {
      return;
    }

    syncedEndpointRef.current = activeEndpoint.id;
    void loadModels({ endpointId: activeEndpoint.id, sync: true });
  }, [activeEndpoint, loadModels]);

  const handleSaveModel = async () => {
    await saveSettings({
      runtime: { modelName: evalModel, priorityModelName: priorityModel },
    });
  };

  const openInstall = () => {
    setInstallName('');
    setModelFormError(null);
    setShowInstall(true);
  };

  const handleInstall = async () => {
    const validation = validateAiModelName(installName);
    if (validation) {
      setModelFormError(validation);
      return;
    }

    // No endpointId → the API installs onto the active ("in use") server.
    const result = await installModel({ modelName: installName.trim() });
    if (result) {
      setInstallName('');
      setModelFormError(null);
      setShowInstall(false);
    }
  };

  const handleConfirmRemove = async () => {
    if (!confirmModel) {
      return;
    }

    const removed = await removeModel(confirmModel.id);
    if (removed) {
      setConfirmModel(null);
    }
  };

  const handleRefreshModels = () => {
    if (!activeEndpoint) {
      return;
    }

    void loadModels({ endpointId: activeEndpoint.id, sync: true });
  };

  const deleting = deletingModelId !== null;

  return (
    <Card className="h-100">
      <Card.Header>
        <span className="fw-semibold">Modello valutazioni</span>
      </Card.Header>
      <Card.Body>
        <Stack className="gap-3">
          {modelError ? <ErrorState message={modelError} /> : null}
          <Stack direction="horizontal" className="justify-content-between align-items-center">
            <span className="form-eyebrow">Modello per le valutazioni</span>
            <Button
              aria-label="Aggiorna modelli"
              className="d-inline-flex align-items-center justify-content-center p-0"
              disabled={loadingModels || !activeEndpoint}
              onClick={handleRefreshModels}
              size="sm"
              style={{ height: '2rem', width: '2rem' }}
              title={refreshModelsTitle}
              variant="outline-secondary"
            >
              {loadingModels ? <Spinner animation="border" size="sm" /> : <RefreshCw size={16} />}
            </Button>
          </Stack>
          <Row className="g-3 runtime-params">
            <Col md={6}>
              <Form.Group controlId="ai-model-eval">
                <Form.Label>Modello valutazioni</Form.Label>
                <Form.Select onChange={(event) => setEvalModel(event.target.value)} value={evalModel}>
                  <option value="">Seleziona un modello installato</option>
                  {modelOptions(installedModels, evalModel).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Form.Select>
                {installedModels.length === 0 ? (
                  <Form.Text className="text-secondary">
                    Nessun modello installato su Ollama. Installalo con il pulsante qui sotto.
                  </Form.Text>
                ) : null}
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group controlId="ai-model-priority">
                <Form.Label>Modello prioritario</Form.Label>
                <Form.Select
                  onChange={(event) => setPriorityModel(event.target.value)}
                  value={priorityModel}
                >
                  <option value="">Come modello valutazioni</option>
                  {modelOptions(installedModels, priorityModel).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Form.Select>
                <Form.Text className="text-secondary">
                  Usato per le offerte messe in cima alla coda.
                </Form.Text>
              </Form.Group>
            </Col>
          </Row>
          <div>
            <Button disabled={savingSettings} onClick={() => void handleSaveModel()} variant="primary">
              {savingSettings ? <Spinner animation="border" className="me-2" size="sm" /> : null}
              Salva modello
            </Button>
          </div>
        </Stack>
      </Card.Body>
      <Card.Body className="border-top">
        <Stack className="gap-3">
          <Stack direction="horizontal" className="justify-content-between align-items-center gap-2">
            <span className="form-eyebrow">Catalogo modelli</span>
            <Button onClick={openInstall} size="sm" variant="outline-primary">
              <Plus className="me-1" size={16} />
              Installa modello
            </Button>
          </Stack>
          {installActivity ? (
            <Stack className="gap-2">
              <Stack direction="horizontal" className="justify-content-between gap-3">
                <span className="small text-secondary text-truncate">
                  {installActivity.message ?? installActivity.activityType}
                </span>
                <ActivityStatusBadge status={installActivity.status} />
              </Stack>
              <ProgressBar
                now={getActivityProgressPercent(installActivity)}
                variant={installActivity.status === 'failed' ? 'danger' : 'primary'}
              />
            </Stack>
          ) : null}
        </Stack>
      </Card.Body>
      <ListGroup variant="flush">
        {loadingModels && models.length === 0 ? (
          <ListGroup.Item>
            <LoadingState label="Caricamento modelli" />
          </ListGroup.Item>
        ) : null}
        {!loadingModels && models.length === 0 ? (
          <ListGroup.Item>
            <EmptyState message="Nessun modello nel catalogo" />
          </ListGroup.Item>
        ) : null}
        {models.map((model) => (
          <ListGroup.Item key={model.id}>
            <Stack direction="horizontal" className="justify-content-between gap-3">
              <div className="min-w-0">
                <div className="fw-semibold text-truncate font-mono">{model.name}</div>
                <div className="small text-secondary text-truncate">{model.endpointName}</div>
              </div>
              <Stack direction="horizontal" className="gap-2 align-items-center">
                <Badge bg={model.installed ? 'success' : 'secondary'}>
                  {model.installed ? 'Installato' : 'Non installato'}
                </Badge>
                <Button
                  aria-label="Rimuovi modello"
                  disabled={deletingModelId === model.id}
                  onClick={() => setConfirmModel(model)}
                  size="sm"
                  variant="outline-danger"
                >
                  {deletingModelId === model.id ? (
                    <Spinner animation="border" size="sm" />
                  ) : (
                    <Trash2 size={15} />
                  )}
                </Button>
              </Stack>
            </Stack>
          </ListGroup.Item>
        ))}
      </ListGroup>

      <Modal
        centered
        onHide={() => (installingModel ? undefined : setShowInstall(false))}
        show={showInstall}
      >
        <Modal.Header closeButton>
          <Modal.Title className="h5 mb-0">Installa un modello</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Stack className="gap-3">
            {modelFormError ? <ErrorState message={modelFormError} /> : null}
            {activeEndpoint ? (
              <div className="small text-secondary">
                Verrà installato sul server in uso:{' '}
                <span className="fw-semibold text-body">{activeEndpoint.name}</span>{' '}
                <span className="font-mono">{activeEndpoint.baseUrl}</span>
              </div>
            ) : (
              <ErrorState message="Nessun server in uso. Selezionane uno nella sezione Connessione." />
            )}
            <Form.Group controlId="ai-install-name">
              <Form.Label>Nome modello</Form.Label>
              <Form.Control
                className="font-mono"
                onChange={(event) => setInstallName(event.target.value)}
                placeholder="llama3.2"
                type="text"
                value={installName}
              />
            </Form.Group>
          </Stack>
        </Modal.Body>
        <Modal.Footer>
          <Button
            disabled={installingModel}
            onClick={() => setShowInstall(false)}
            variant="outline-secondary"
          >
            Annulla
          </Button>
          <Button
            disabled={installingModel || !activeEndpoint}
            onClick={() => void handleInstall()}
            variant="primary"
          >
            {installingModel ? <Spinner animation="border" className="me-2" size="sm" /> : null}
            Installa
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        centered
        onHide={() => (deleting ? undefined : setConfirmModel(null))}
        show={confirmModel !== null}
      >
        <Modal.Header closeButton>
          <Modal.Title className="h5 mb-0">Rimuovi modello</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {modelError ? <ErrorState message={modelError} /> : null}
          {confirmModel ? (
            <p className="mb-0">
              {confirmModel.installed ? (
                <>
                  Il modello <span className="fw-semibold font-mono">{confirmModel.name}</span> verrà
                  disinstallato dal server{' '}
                  <span className="fw-semibold">{confirmModel.endpointName}</span>. Il server deve
                  essere raggiungibile.
                </>
              ) : (
                <>
                  Il modello <span className="fw-semibold font-mono">{confirmModel.name}</span> verrà
                  rimosso dall'elenco.
                </>
              )}
            </p>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button
            disabled={deleting}
            onClick={() => setConfirmModel(null)}
            variant="outline-secondary"
          >
            Annulla
          </Button>
          <Button disabled={deleting} onClick={() => void handleConfirmRemove()} variant="danger">
            {deleting ? <Spinner animation="border" className="me-2" size="sm" /> : null}
            Rimuovi
          </Button>
        </Modal.Footer>
      </Modal>
    </Card>
  );
}
