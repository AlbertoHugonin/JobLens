import { useState, type ChangeEvent } from 'react';

import { Check, Plus, Trash2, X } from 'lucide-react';
import Alert from 'react-bootstrap/Alert';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import ButtonGroup from 'react-bootstrap/ButtonGroup';
import Card from 'react-bootstrap/Card';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';
import Spinner from 'react-bootstrap/Spinner';
import Stack from 'react-bootstrap/Stack';

import type {
  CredentialField,
  LinkedInHarDebug,
  ProviderSession,
  SessionVerification,
} from '../../models/search';
import { useProviders } from '../../contexts/ProvidersContext';
import { ConfirmActionButton } from '../Utilities/ConfirmActionButton';
import { ErrorState } from '../Utilities/SectionState';

function formatTimestamp(value: Date | null): string {
  if (!value) {
    return '—';
  }

  return value.toLocaleString('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function statusVariant(status: ProviderSession['status']): string {
  switch (status) {
    case 'active':
      return 'success';
    case 'expired':
      return 'warning';
    case 'invalid':
      return 'danger';
    default:
      return 'secondary';
  }
}

function statusLabel(status: ProviderSession['status']): string {
  switch (status) {
    case 'active':
      return 'attiva';
    case 'expired':
      return 'scaduta';
    case 'invalid':
      return 'non valida';
    default:
      return 'disattivata';
  }
}

function KeyHealth({ label, present }: { label: string; present: boolean }) {
  return (
    <span
      className={`d-inline-flex align-items-center gap-1 ${present ? 'text-success' : 'text-danger'}`}
    >
      {present ? <Check aria-hidden="true" size={13} /> : <X aria-hidden="true" size={13} />}
      <span className="font-mono">{label}</span>
    </span>
  );
}

function SessionRow({
  onRemove,
  onVerify,
  removing,
  session,
  supportsVerify,
  verification,
  verifying,
}: {
  onRemove: () => void;
  onVerify: () => void;
  removing: boolean;
  session: ProviderSession;
  supportsVerify: boolean;
  verification: SessionVerification | undefined;
  verifying: boolean;
}) {
  const variant = statusVariant(session.status);

  return (
    <div className="session-row">
      <Stack className="gap-2">
        <Stack direction="horizontal" className="gap-2 align-items-center flex-wrap">
          <span className={`session-dot session-dot--${variant}`} />
          <span className="text-secondary">{statusLabel(session.status)}</span>
          <span className="text-secondary">·</span>
          <Badge bg="light" className="border text-dark fw-normal">
            {session.providerName}
          </Badge>
          <span className="fw-semibold text-truncate">{session.label}</span>
        </Stack>

        <div className="small text-secondary d-flex flex-wrap gap-2 align-items-center">
          <KeyHealth label="li_at" present={session.summary.hasLiAt} />
          <KeyHealth label="JSESSIONID" present={session.summary.hasJsessionid} />
          <span aria-hidden="true">·</span>
          <span>
            {session.summary.source === 'manual' ? 'Inserita a mano' : 'Importata da HAR'}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">
            {formatTimestamp(session.summary.importedAt ?? session.createdAt)}
          </span>
          {session.summary.jobCardRequestCount > 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{session.summary.jobCardRequestCount} job card</span>
            </>
          ) : null}
        </div>

        <Stack direction="horizontal" className="gap-2 align-items-center flex-wrap">
          {supportsVerify ? (
            <>
              <Button
                disabled={verifying || removing}
                onClick={onVerify}
                size="sm"
                variant="outline-secondary"
              >
                {verifying ? <Spinner animation="border" className="me-2" size="sm" /> : null}
                Verifica
              </Button>
              {verification ? (
                <span
                  className={`small fw-semibold ${verification.alive ? 'text-success' : 'text-danger'}`}
                >
                  {verification.alive
                    ? 'Sessione valida'
                    : `Non valida${verification.status ? ` (HTTP ${verification.status})` : ''}`}
                </span>
              ) : (
                <span className="small text-secondary">
                  Ultima verifica: {formatTimestamp(session.lastVerifiedAt)}
                </span>
              )}
            </>
          ) : (
            <span className="small text-secondary">
              Ultima verifica: {formatTimestamp(session.lastVerifiedAt)}
            </span>
          )}

          <div className="ms-auto">
            <ConfirmActionButton
              confirmLabel="Rimuovi"
              confirmMessage={`La sessione "${session.label}" verrà rimossa. Le ricerche che la usavano non potranno raccogliere finché non resta almeno una sessione attiva.`}
              confirmTitle="Rimuovere la sessione?"
              disabled={removing || verifying}
              onConfirm={onRemove}
              size="sm"
              variant="outline-danger"
            >
              {removing ? (
                <Spinner animation="border" className="me-1" size="sm" />
              ) : (
                <Trash2 aria-hidden="true" className="me-1" size={14} />
              )}
              Rimuovi
            </ConfirmActionButton>
          </div>
        </Stack>
      </Stack>
    </div>
  );
}

function HarDebugSummary({ debug }: { debug: LinkedInHarDebug }) {
  const request = debug.selectedRequest;

  return (
    <Alert className="mb-0" variant={debug.jobCardRequestCount > 0 ? 'success' : 'warning'}>
      <Stack className="gap-2">
        <div>
          Richieste job card trovate: <strong>{debug.jobCardRequestCount}</strong>
        </div>
        {request ? (
          <>
            <div className="small font-mono">
              {request.method} {request.host}
              {request.path}
            </div>
            <Stack direction="horizontal" className="gap-2 flex-wrap">
              <Badge bg={request.hasCookie ? 'success' : 'danger'}>cookie presente</Badge>
              <Badge bg={request.hasCsrfToken ? 'success' : 'danger'}>csrf presente</Badge>
            </Stack>
          </>
        ) : null}
      </Stack>
    </Alert>
  );
}

function CredentialInput({
  field,
  onChange,
  value,
}: {
  field: CredentialField;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <Form.Group controlId={`credential-${field.name}`}>
      <Form.Label className="small fw-semibold">
        {field.label}
        {field.required ? <span className="text-danger"> *</span> : null}
      </Form.Label>
      <Form.Control
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder ?? ''}
        type={field.secret ? 'password' : 'text'}
        value={value}
      />
      {field.help ? <Form.Text className="text-secondary">{field.help}</Form.Text> : null}
    </Form.Group>
  );
}

type AddMode = 'credentials' | 'har';

function AddSessionModal({ onHide, show }: { onHide: () => void; show: boolean }) {
  const { debugHar, descriptor, saveCredentials, uploadHar } = useProviders();
  const fields = descriptor?.credentialFields ?? [];
  const supportsHar = descriptor?.supportsHarImport ?? false;

  const [mode, setMode] = useState<AddMode>('credentials');
  const [values, setValues] = useState<Record<string, string>>({});
  const [label, setLabel] = useState('');
  const [harText, setHarText] = useState('');
  const [harLabel, setHarLabel] = useState('');
  const [debug, setDebug] = useState<LinkedInHarDebug | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const reset = () => {
    setMode('credentials');
    setValues({});
    setLabel('');
    setHarText('');
    setHarLabel('');
    setDebug(null);
    setFormError(null);
  };

  const close = () => {
    reset();
    onHide();
  };

  const handleSaveCredentials = async () => {
    const missing = fields.find((field) => field.required && !values[field.name]?.trim());
    if (missing) {
      setFormError(`Il campo ${missing.label} è obbligatorio`);
      return;
    }

    const credentials: Record<string, string> = {};
    for (const field of fields) {
      const value = values[field.name]?.trim();
      if (value) {
        credentials[field.name] = value;
      }
    }

    setFormError(null);
    setWorking(true);
    const session = await saveCredentials(credentials, label.trim() || undefined);
    setWorking(false);
    if (session) {
      close();
    }
  };

  const handleHarFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setHarLabel(file.name);
    setHarText(await file.text());
    setDebug(null);
  };

  const handleDebug = async () => {
    if (!harText.trim()) {
      return;
    }

    setWorking(true);
    setDebug(await debugHar(harText));
    setWorking(false);
  };

  const handleUploadHar = async () => {
    if (!harText.trim()) {
      setFormError('Seleziona prima un file HAR');
      return;
    }

    setFormError(null);
    setWorking(true);
    const session = await uploadHar(harText, harLabel || undefined);
    setWorking(false);
    if (session) {
      close();
    }
  };

  return (
    <Modal centered onHide={close} show={show} size="lg">
      <Modal.Header closeButton>
        <Modal.Title className="h5">Aggiungi sessione</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Stack className="gap-3">
          <div>
            <div className="form-eyebrow mb-1">Provider</div>
            <div className="fw-semibold">{descriptor?.name ?? '—'}</div>
          </div>

          {formError ? (
            <Alert className="mb-0" variant="danger">
              {formError}
            </Alert>
          ) : null}

          {supportsHar ? (
            <ButtonGroup className="align-self-start">
              <Button
                active={mode === 'credentials'}
                onClick={() => setMode('credentials')}
                size="sm"
                variant={mode === 'credentials' ? 'primary' : 'outline-secondary'}
              >
                Credenziali
              </Button>
              <Button
                active={mode === 'har'}
                onClick={() => setMode('har')}
                size="sm"
                variant={mode === 'har' ? 'primary' : 'outline-secondary'}
              >
                Importa da HAR
              </Button>
            </ButtonGroup>
          ) : null}

          {mode === 'credentials' ? (
            <>
              {fields.map((field) => (
                <CredentialInput
                  field={field}
                  key={field.name}
                  onChange={(value) =>
                    setValues((current) => ({ ...current, [field.name]: value }))
                  }
                  value={values[field.name] ?? ''}
                />
              ))}
              <Form.Group controlId="session-label">
                <Form.Label className="small fw-semibold">Etichetta sessione</Form.Label>
                <Form.Control
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder={`${descriptor?.name ?? 'Sessione'} principale`}
                  type="text"
                  value={label}
                />
              </Form.Group>
            </>
          ) : (
            <Stack className="gap-3">
              <Form.Group controlId="provider-har-file">
                <Form.Label className="small fw-semibold">File HAR</Form.Label>
                <Form.Control accept=".har,.json" onChange={handleHarFileChange} type="file" />
                <Form.Text className="text-secondary">
                  Dal HAR vengono estratti solo li_at e JSESSIONID, il resto viene scartato.
                </Form.Text>
              </Form.Group>
              {debug ? <HarDebugSummary debug={debug} /> : null}
            </Stack>
          )}
        </Stack>
      </Modal.Body>
      <Modal.Footer>
        <Button onClick={close} variant="outline-secondary">
          Annulla
        </Button>
        {mode === 'credentials' ? (
          <Button
            disabled={working || fields.length === 0}
            onClick={() => void handleSaveCredentials()}
            variant="primary"
          >
            {working ? <Spinner animation="border" className="me-2" size="sm" /> : null}
            Salva sessione
          </Button>
        ) : (
          <>
            <Button
              disabled={!harText || working}
              onClick={() => void handleDebug()}
              variant="outline-secondary"
            >
              Debug HAR
            </Button>
            <Button
              disabled={!harText || working}
              onClick={() => void handleUploadHar()}
              variant="primary"
            >
              {working ? <Spinner animation="border" className="me-2" size="sm" /> : null}
              Importa sessione
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
}

export function ProviderSessionPanel() {
  const { deleteSession, descriptor, loadingSessions, sessionError, sessions, verifySession } =
    useProviders();

  const [showAdd, setShowAdd] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [verifications, setVerifications] = useState<Record<string, SessionVerification>>({});

  const handleVerify = async (sessionId: string) => {
    setVerifyingId(sessionId);
    const verification = await verifySession(sessionId);
    if (verification) {
      setVerifications((current) => ({ ...current, [sessionId]: verification }));
    }
    setVerifyingId(null);
  };

  const handleRemove = async (sessionId: string) => {
    setRemovingId(sessionId);
    await deleteSession(sessionId);
    setRemovingId(null);
  };

  return (
    <Card className="h-100">
      <Card.Header>
        <Stack direction="horizontal" className="justify-content-between align-items-center gap-3">
          <Stack direction="horizontal" className="gap-2 align-items-center">
            <span className="fw-semibold">Sessioni</span>
            {loadingSessions ? <Spinner animation="border" size="sm" /> : null}
          </Stack>
          <Button onClick={() => setShowAdd(true)} variant="primary">
            <Plus aria-hidden="true" className="me-1" size={16} />
            Aggiungi sessione
          </Button>
        </Stack>
      </Card.Header>
      <Card.Body>
        <Stack className="gap-3">
          {sessionError ? <ErrorState message={sessionError} /> : null}

          {sessions.length === 0 ? (
            <div className="session-empty">
              <p className="fw-semibold mb-1">Nessuna sessione configurata</p>
              <p className="text-secondary mb-3">
                Aggiungi una sessione {descriptor?.name ?? 'del provider'} per iniziare a
                raccogliere le offerte.
              </p>
              <Button onClick={() => setShowAdd(true)} variant="primary">
                <Plus aria-hidden="true" className="me-1" size={16} />
                Aggiungi sessione
              </Button>
            </div>
          ) : (
            <div className="session-list">
              {sessions.map((session) => (
                <SessionRow
                  key={session.id}
                  onRemove={() => void handleRemove(session.id)}
                  onVerify={() => void handleVerify(session.id)}
                  removing={removingId === session.id}
                  session={session}
                  supportsVerify={descriptor?.supportsVerify ?? false}
                  verification={verifications[session.id]}
                  verifying={verifyingId === session.id}
                />
              ))}
            </div>
          )}
        </Stack>
      </Card.Body>

      <AddSessionModal onHide={() => setShowAdd(false)} show={showAdd} />
    </Card>
  );
}
