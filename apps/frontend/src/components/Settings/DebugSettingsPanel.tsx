import { useState } from 'react';

import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';
import Spinner from 'react-bootstrap/Spinner';
import Stack from 'react-bootstrap/Stack';

import {
  clearOperationalData,
  resetApplicationData,
  type ApplicationResetDto,
  type OperationalClearDto,
} from '../../API/maintenance';
import { useDebugMode } from '../../contexts/DebugModeContext';

const RESET_CONFIRMATION = 'RESET';
const CLEAR_CONFIRMATION = 'CLEAR';

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Errore imprevisto';
}

export function DebugSettingsPanel() {
  const { debugMode, setDebugMode } = useDebugMode();
  const [showReset, setShowReset] = useState(false);
  const [resetInput, setResetInput] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<ApplicationResetDto | null>(null);
  const [showClear, setShowClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [clearResult, setClearResult] = useState<OperationalClearDto | null>(null);

  const closeClear = () => {
    if (clearing) {
      return;
    }

    setShowClear(false);
    setClearError(null);
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      const response = await clearOperationalData({ confirmation: CLEAR_CONFIRMATION });
      setClearResult(response.data);
      setClearError(null);
      setShowClear(false);
      setTimeout(() => window.location.reload(), 900);
    } catch (error: unknown) {
      setClearError(readErrorMessage(error));
    } finally {
      setClearing(false);
    }
  };

  const closeReset = () => {
    if (resetting) {
      return;
    }

    setShowReset(false);
    setResetInput('');
    setResetError(null);
  };

  const handleReset = async () => {
    if (resetInput.trim() !== RESET_CONFIRMATION) {
      setResetError(`Scrivi ${RESET_CONFIRMATION} per confermare il reset.`);
      return;
    }

    setResetting(true);
    try {
      const response = await resetApplicationData({ confirmation: RESET_CONFIRMATION });
      setResetResult(response.data);
      setResetError(null);
      setDebugMode(false);
      setShowReset(false);
      setTimeout(() => window.location.reload(), 900);
    } catch (error: unknown) {
      setResetError(readErrorMessage(error));
    } finally {
      setResetting(false);
    }
  };

  return (
    <Card>
      <Card.Body>
        <Stack className="gap-3">
          <Form.Check
            checked={debugMode}
            id="debug-mode-toggle"
            label="Mostra strumenti di debug"
            onChange={(event) => setDebugMode(event.target.checked)}
            type="switch"
          />
          <p className="text-secondary small mb-0">
            Mostra le azioni e i pannelli di diagnostica nelle pagine operative — ad esempio
            &quot;Crea prova&quot; nella coda Attivita, il pannello Debug LinkedIn nel dettaglio
            attivita e i dettagli tecnici JSON delle valutazioni. Tienilo disattivato per
            un&apos;interfaccia pulita, adatta alla produzione.
          </p>
          {resetResult ? (
            <Alert className="mb-0" variant="success">
              Reset completato. Dati eliminati:{' '}
              {Object.values(resetResult.deleted).reduce((total, count) => total + count, 0)}.
              Ricarico l&apos;applicazione...
            </Alert>
          ) : null}
          {clearResult ? (
            <Alert className="mb-0" variant="success">
              Dati operativi svuotati:{' '}
              {Object.values(clearResult.deleted).reduce((total, count) => total + count, 0)}{' '}
              record. Ricarico l&apos;applicazione...
            </Alert>
          ) : null}
          <div className="border-top pt-3">
            <div className="fw-semibold">Svuota attivita e offerte</div>
            <p className="text-secondary small mb-3">
              Elimina tutte le offerte e le attivita (con log, descrizioni, review e raw payload),
              mantenendo impostazioni, ricerche, sessioni provider ed endpoint AI. Utile per
              ripartire con le raccolte da zero senza riconfigurare nulla.
            </p>
            <Button
              disabled={!debugMode || clearing}
              onClick={() => setShowClear(true)}
              variant="outline-warning"
            >
              {clearing ? (
                <>
                  <Spinner animation="border" className="me-2" size="sm" />
                  Svuotamento in corso
                </>
              ) : (
                'Svuota attivita e offerte'
              )}
            </Button>
            {!debugMode ? (
              <div className="small text-secondary mt-2">
                Attiva gli strumenti di debug per usare questa azione.
              </div>
            ) : null}
          </div>
          <div className="border-top pt-3">
            <div className="fw-semibold text-danger">Reset applicazione</div>
            <p className="text-secondary small mb-3">
              Elimina offerte, ricerche, sessioni provider, endpoint AI, modelli, review, attivita,
              log, raw payload e impostazioni personalizzate. Restano schema database e seed minimi
              iniziali.
            </p>
            <Button
              disabled={!debugMode || resetting}
              onClick={() => setShowReset(true)}
              variant="outline-danger"
            >
              {resetting ? (
                <>
                  <Spinner animation="border" className="me-2" size="sm" />
                  Reset in corso
                </>
              ) : (
                'Resetta applicazione'
              )}
            </Button>
            {!debugMode ? (
              <div className="small text-secondary mt-2">
                Attiva gli strumenti di debug per usare questa azione.
              </div>
            ) : null}
          </div>
        </Stack>
      </Card.Body>
      <Modal centered onHide={closeClear} show={showClear}>
        <Modal.Header closeButton={!clearing}>
          <Modal.Title className="h5">Svuota attivita e offerte</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Stack className="gap-3">
            <Alert className="mb-0" variant="warning">
              Verranno eliminate tutte le offerte e le attivita (con i dati collegati).
              Impostazioni, ricerche, sessioni ed endpoint AI restano. L&apos;operazione non puo
              essere annullata.
            </Alert>
            {clearError ? (
              <Alert className="mb-0" variant="danger">
                {clearError}
              </Alert>
            ) : null}
          </Stack>
        </Modal.Body>
        <Modal.Footer>
          <Button disabled={clearing} onClick={closeClear} variant="outline-secondary">
            Annulla
          </Button>
          <Button disabled={clearing} onClick={() => void handleClear()} variant="warning">
            {clearing ? 'Svuotamento in corso' : 'Svuota'}
          </Button>
        </Modal.Footer>
      </Modal>
      <Modal centered onHide={closeReset} show={showReset}>
        <Modal.Header closeButton={!resetting}>
          <Modal.Title className="h5">Reset applicazione</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Stack className="gap-3">
            <Alert className="mb-0" variant="danger">
              Questa operazione elimina tutti i dati applicativi salvati e non puo essere annullata.
            </Alert>
            <p className="mb-0">
              Per confermare, scrivi <span className="font-mono">{RESET_CONFIRMATION}</span>.
            </p>
            <Form.Control
              autoFocus
              className="font-mono"
              disabled={resetting}
              onChange={(event) => setResetInput(event.target.value)}
              placeholder={RESET_CONFIRMATION}
              value={resetInput}
            />
            {resetError ? (
              <Alert className="mb-0" variant="danger">
                {resetError}
              </Alert>
            ) : null}
          </Stack>
        </Modal.Body>
        <Modal.Footer>
          <Button disabled={resetting} onClick={closeReset} variant="outline-secondary">
            Annulla
          </Button>
          <Button
            disabled={resetting || resetInput.trim() !== RESET_CONFIRMATION}
            onClick={() => void handleReset()}
            variant="danger"
          >
            {resetting ? 'Reset in corso' : 'Resetta tutto'}
          </Button>
        </Modal.Footer>
      </Modal>
    </Card>
  );
}
