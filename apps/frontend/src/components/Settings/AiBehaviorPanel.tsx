import { useEffect, useRef, useState } from 'react';

import { Plus, Trash2 } from 'lucide-react';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import Col from 'react-bootstrap/Col';
import Form from 'react-bootstrap/Form';
import ListGroup from 'react-bootstrap/ListGroup';
import Modal from 'react-bootstrap/Modal';
import Row from 'react-bootstrap/Row';
import Spinner from 'react-bootstrap/Spinner';
import Stack from 'react-bootstrap/Stack';

import { useAiSettings } from '../../contexts/AiSettingsContext';
import {
  aiPauseDayOptions,
  getAiPauseDayLabel,
  type AiPauseWindow,
  type AiRuntimeSettings,
} from '../../models/ai';
import { EmptyState, ErrorState, LoadingState } from '../Utilities/SectionState';

function readNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function AiBehaviorPanel() {
  const { error, loadingSettings, saveSettings, savingSettings, settings } = useAiSettings();
  const [enabled, setEnabled] = useState(false);
  const [runtime, setRuntime] = useState<AiRuntimeSettings | null>(null);
  const [pauses, setPauses] = useState<AiPauseWindow[]>([]);
  const [showPause, setShowPause] = useState(false);
  const [pauseDay, setPauseDay] = useState(1);
  const [pauseStart, setPauseStart] = useState('18:00');
  const [pauseEnd, setPauseEnd] = useState('23:00');
  const [pauseEnabled, setPauseEnabled] = useState(true);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const seededRef = useRef(false);

  // Seed the draft once; everything (toggle, params, pauses) is saved together by
  // the single button at the bottom, so re-seeding would discard unsaved edits.
  useEffect(() => {
    if (!settings || seededRef.current) {
      return;
    }

    seededRef.current = true;
    setEnabled(settings.enabled);
    setRuntime(settings.runtime);
    setPauses(settings.pauses);
  }, [settings]);

  const updateRuntime = <K extends keyof AiRuntimeSettings>(
    field: K,
    value: AiRuntimeSettings[K],
  ) => {
    setRuntime((current) => (current ? { ...current, [field]: value } : current));
  };

  const openPause = () => {
    setPauseDay(1);
    setPauseStart('18:00');
    setPauseEnd('23:00');
    setPauseEnabled(true);
    setPauseError(null);
    setShowPause(true);
  };

  const handleAddPause = () => {
    if (pauseStart >= pauseEnd) {
      setPauseError("La fine pausa deve essere successiva all'inizio");
      return;
    }

    setPauses((items) => [
      ...items,
      { dayOfWeek: pauseDay, enabled: pauseEnabled, endTime: pauseEnd, startTime: pauseStart },
    ]);
    setPauseError(null);
    setShowPause(false);
  };

  const handleRemovePause = (index: number) => {
    setPauses((items) => items.filter((_, itemIndex) => itemIndex !== index));
  };

  const handleSave = async () => {
    if (!runtime) {
      return;
    }

    await saveSettings({ enabled, pauses, runtime });
  };

  if (!runtime) {
    return (
      <Card className="h-100">
        <Card.Header>
          <span className="fw-semibold">Comportamento</span>
        </Card.Header>
        <Card.Body>
          {loadingSettings ? (
            <LoadingState label="Caricamento comportamento AI" />
          ) : (
            <EmptyState message="Impostazioni non caricate" />
          )}
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card className="h-100">
      <Card.Header>
        <Stack direction="horizontal" className="justify-content-between gap-3">
          <span className="fw-semibold">Comportamento</span>
          {settings?.enabled ? (
            <Badge bg="success">Valutazioni attive</Badge>
          ) : (
            <Badge bg="secondary">Valutazioni ferme</Badge>
          )}
        </Stack>
      </Card.Header>
      <Card.Body>
        <Stack className="gap-3">
          {error ? <ErrorState message={error} /> : null}
          <div className="rounded border bg-light p-3">
            <Form.Check
              checked={enabled}
              id="ai-enabled"
              label={
                <span className="d-block">
                  <span className="fw-semibold">Valuta le offerte con l'AI</span>
                  <span className="d-block small text-secondary">
                    Quando è spento, nessuna nuova offerta viene valutata.
                  </span>
                </span>
              }
              onChange={(event) => setEnabled(event.currentTarget.checked)}
              type="switch"
            />
          </div>
          <div className="form-eyebrow">Parametri di esecuzione</div>
          <Row className="g-3 runtime-params">
            <Col sm={6} md={4}>
              <Form.Group controlId="ai-runtime-timeout">
                <Form.Label>Timeout sec</Form.Label>
                <Form.Control
                  min={5}
                  onChange={(event) =>
                    updateRuntime('timeoutSeconds', readNumber(event.target.value, 120))
                  }
                  type="number"
                  value={runtime.timeoutSeconds}
                />
              </Form.Group>
            </Col>
            <Col sm={6} md={4}>
              <Form.Group controlId="ai-runtime-num-ctx">
                <Form.Label>num_ctx</Form.Label>
                <Form.Control
                  min={512}
                  onChange={(event) => updateRuntime('numCtx', readNumber(event.target.value, 8192))}
                  type="number"
                  value={runtime.numCtx}
                />
              </Form.Group>
            </Col>
            <Col sm={6} md={4}>
              <Form.Group controlId="ai-runtime-num-predict">
                <Form.Label>num_predict</Form.Label>
                <Form.Control
                  min={128}
                  onChange={(event) =>
                    updateRuntime('numPredict', readNumber(event.target.value, 1024))
                  }
                  type="number"
                  value={runtime.numPredict}
                />
              </Form.Group>
            </Col>
            <Col sm={6} md={4}>
              <Form.Group controlId="ai-runtime-temperature">
                <Form.Label>temperature</Form.Label>
                <Form.Control
                  max={2}
                  min={0}
                  onChange={(event) =>
                    updateRuntime('temperature', readNumber(event.target.value, 0.2))
                  }
                  step={0.1}
                  type="number"
                  value={runtime.temperature}
                />
              </Form.Group>
            </Col>
            <Col sm={6} md={4}>
              <Form.Group controlId="ai-runtime-keep-alive">
                <Form.Label>keep_alive</Form.Label>
                <Form.Control
                  onChange={(event) => updateRuntime('keepAlive', event.target.value)}
                  placeholder="10m"
                  type="text"
                  value={runtime.keepAlive}
                />
              </Form.Group>
            </Col>
            <Col sm={6} md={4}>
              <Form.Group controlId="ai-runtime-retry-attempts">
                <Form.Label>Retry</Form.Label>
                <Form.Control
                  min={0}
                  onChange={(event) =>
                    updateRuntime('retryAttempts', readNumber(event.target.value, 1))
                  }
                  type="number"
                  value={runtime.retryAttempts}
                />
              </Form.Group>
            </Col>
            <Col sm={6} md={4}>
              <Form.Group controlId="ai-runtime-retry-delay">
                <Form.Label>Ritardo retry sec</Form.Label>
                <Form.Control
                  min={0}
                  onChange={(event) =>
                    updateRuntime('retryDelaySeconds', readNumber(event.target.value, 30))
                  }
                  type="number"
                  value={runtime.retryDelaySeconds}
                />
              </Form.Group>
            </Col>
            <Col sm={6} md={4}>
              <Form.Check
                checked={runtime.think}
                className="mt-4"
                id="ai-runtime-think"
                label="think"
                onChange={(event) => updateRuntime('think', event.currentTarget.checked)}
                type="switch"
              />
            </Col>
          </Row>
        </Stack>
      </Card.Body>
      <Card.Body className="border-top">
        <Stack className="gap-3">
          <Stack direction="horizontal" className="justify-content-between align-items-center gap-2">
            <span className="form-eyebrow">Pause programmate</span>
            <Stack direction="horizontal" className="gap-2 align-items-center">
              <Badge bg="secondary" className="font-mono">
                {pauses.length}
              </Badge>
              <Button onClick={openPause} size="sm" variant="outline-primary">
                <Plus className="me-1" size={16} />
                Aggiungi pausa
              </Button>
            </Stack>
          </Stack>
          {pauses.length === 0 ? (
            <EmptyState message="Nessuna pausa configurata" />
          ) : (
            <ListGroup>
              {pauses.map((pause, index) => (
                <ListGroup.Item
                  key={`${pause.dayOfWeek}-${pause.startTime}-${pause.endTime}-${index}`}
                >
                  <Stack direction="horizontal" className="justify-content-between gap-3">
                    <span className="small">
                      {getAiPauseDayLabel(pause.dayOfWeek)}{' '}
                      <span className="font-mono">
                        {pause.startTime}-{pause.endTime}
                      </span>
                    </span>
                    <Stack direction="horizontal" className="gap-2 align-items-center">
                      <Badge bg={pause.enabled ? 'warning' : 'secondary'}>
                        {pause.enabled ? 'Attiva' : 'Off'}
                      </Badge>
                      <Button
                        aria-label="Rimuovi pausa"
                        onClick={() => handleRemovePause(index)}
                        size="sm"
                        variant="outline-danger"
                      >
                        <Trash2 size={15} />
                      </Button>
                    </Stack>
                  </Stack>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
        </Stack>
      </Card.Body>
      <Card.Footer>
        <Stack direction="horizontal" className="justify-content-between gap-3">
          <span className="small text-secondary">
            Salva toggle, parametri e pause programmate.
          </span>
          <Button disabled={savingSettings} onClick={() => void handleSave()} variant="primary">
            {savingSettings ? <Spinner animation="border" className="me-2" size="sm" /> : null}
            Salva comportamento
          </Button>
        </Stack>
      </Card.Footer>

      <Modal centered onHide={() => setShowPause(false)} show={showPause}>
        <Modal.Header closeButton>
          <Modal.Title className="h5 mb-0">Aggiungi pausa</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Stack className="gap-3">
            {pauseError ? <ErrorState message={pauseError} /> : null}
            <Form.Group controlId="ai-pause-day">
              <Form.Label>Giorno</Form.Label>
              <Form.Select
                onChange={(event) => setPauseDay(readNumber(event.target.value, 1))}
                value={pauseDay}
              >
                {aiPauseDayOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Row className="g-2">
              <Col xs={6}>
                <Form.Group controlId="ai-pause-start">
                  <Form.Label>Inizio</Form.Label>
                  <Form.Control
                    onChange={(event) => setPauseStart(event.target.value)}
                    type="time"
                    value={pauseStart}
                  />
                </Form.Group>
              </Col>
              <Col xs={6}>
                <Form.Group controlId="ai-pause-end">
                  <Form.Label>Fine</Form.Label>
                  <Form.Control
                    onChange={(event) => setPauseEnd(event.target.value)}
                    type="time"
                    value={pauseEnd}
                  />
                </Form.Group>
              </Col>
            </Row>
            <Form.Check
              checked={pauseEnabled}
              id="ai-pause-enabled"
              label="Pausa abilitata"
              onChange={(event) => setPauseEnabled(event.currentTarget.checked)}
              type="switch"
            />
          </Stack>
        </Modal.Body>
        <Modal.Footer>
          <Button onClick={() => setShowPause(false)} variant="outline-secondary">
            Annulla
          </Button>
          <Button onClick={handleAddPause}>Aggiungi pausa</Button>
        </Modal.Footer>
      </Modal>
    </Card>
  );
}
