import { useState, type ChangeEvent } from 'react';

import Alert from 'react-bootstrap/Alert';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import Collapse from 'react-bootstrap/Collapse';
import Form from 'react-bootstrap/Form';
import ListGroup from 'react-bootstrap/ListGroup';
import Spinner from 'react-bootstrap/Spinner';
import Stack from 'react-bootstrap/Stack';

import type {
  CredentialField,
  LinkedInHarDebug,
  ProviderSession,
  SessionVerification,
} from '../../models/search';
import { useProviders } from '../../contexts/ProvidersContext';
import { ErrorState } from '../Utilities/SectionState';

function formatTimestamp(value: Date | null): string {
  if (!value) {
    return '-';
  }

  return value.toLocaleString('it-IT', {
    dateStyle: 'short',
    timeStyle: 'medium',
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

function SessionItem({
  onVerify,
  session,
  supportsVerify,
  verification,
  verifying,
}: {
  onVerify: () => void;
  session: ProviderSession;
  supportsVerify: boolean;
  verification: SessionVerification | undefined;
  verifying: boolean;
}) {
  return (
    <ListGroup.Item>
      <Stack className="gap-2">
        <Stack direction="horizontal" className="justify-content-between gap-3">
          <span className="fw-semibold text-truncate">{session.label}</span>
          <Badge bg={statusVariant(session.status)}>{session.status}</Badge>
        </Stack>
        <div className="small text-secondary">
          {session.summary.source === 'manual' ? 'Inserita a mano' : 'Importata da HAR'} ·{' '}
          <span className="font-mono">
            {formatTimestamp(session.summary.importedAt ?? session.createdAt)}
          </span>
        </div>
        <Stack direction="horizontal" className="gap-2 flex-wrap">
          <Badge bg={session.summary.hasLiAt ? 'success' : 'danger'}>li_at</Badge>
          <Badge bg={session.summary.hasJsessionid ? 'success' : 'danger'}>JSESSIONID</Badge>
          {session.summary.jobCardRequestCount > 0 ? (
            <Badge bg="secondary" className="font-mono">
              {session.summary.jobCardRequestCount} job cards
            </Badge>
          ) : null}
        </Stack>
        {supportsVerify ? (
          <Stack direction="horizontal" className="gap-2 align-items-center">
            <Button disabled={verifying} onClick={onVerify} size="sm" variant="outline-secondary">
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
          </Stack>
        ) : null}
      </Stack>
    </ListGroup.Item>
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

export function ProviderSessionPanel() {
  const {
    debugHar,
    descriptor,
    loadingSessions,
    saveCredentials,
    sessionError,
    sessions,
    uploadHar,
    verifySession,
  } = useProviders();
  const [values, setValues] = useState<Record<string, string>>({});
  const [label, setLabel] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const [showHar, setShowHar] = useState(false);
  const [harText, setHarText] = useState('');
  const [harLabel, setHarLabel] = useState('');
  const [debug, setDebug] = useState<LinkedInHarDebug | null>(null);

  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verifications, setVerifications] = useState<Record<string, SessionVerification>>({});

  const fields = descriptor?.credentialFields ?? [];

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
      setValues({});
      setLabel('');
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
      return;
    }

    setWorking(true);
    const session = await uploadHar(harText, harLabel || undefined);
    setWorking(false);
    if (session) {
      setHarText('');
      setDebug(null);
    }
  };

  const handleVerify = async (sessionId: string) => {
    setVerifyingId(sessionId);
    const verification = await verifySession(sessionId);
    if (verification) {
      setVerifications((current) => ({ ...current, [sessionId]: verification }));
    }
    setVerifyingId(null);
  };

  return (
    <Card className="h-100">
      <Card.Header>
        <Stack direction="horizontal" className="justify-content-between align-items-center gap-3">
          <span className="fw-semibold">Sessione {descriptor?.name ?? 'LinkedIn'}</span>
          {loadingSessions ? <Spinner animation="border" size="sm" /> : null}
        </Stack>
      </Card.Header>
      <Card.Body>
        <Stack className="gap-3">
          {sessionError ? <ErrorState message={sessionError} /> : null}
          {formError ? (
            <Alert className="mb-0" variant="danger">
              {formError}
            </Alert>
          ) : null}

          <div className="form-eyebrow">Credenziali</div>
          {fields.map((field) => (
            <CredentialInput
              field={field}
              key={field.name}
              onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))}
              value={values[field.name] ?? ''}
            />
          ))}

          <Form.Group controlId="session-label">
            <Form.Label className="small fw-semibold">Etichetta sessione</Form.Label>
            <Form.Control
              onChange={(event) => setLabel(event.target.value)}
              placeholder="LinkedIn principale"
              type="text"
              value={label}
            />
          </Form.Group>

          <Button
            disabled={working || fields.length === 0}
            onClick={() => void handleSaveCredentials()}
            variant="primary"
          >
            {working ? <Spinner animation="border" className="me-2" size="sm" /> : null}
            Salva credenziali
          </Button>

          {descriptor?.supportsHarImport ? (
            <>
              <Button
                aria-expanded={showHar}
                className="p-0 text-decoration-none align-self-start"
                onClick={() => setShowHar((current) => !current)}
                variant="link"
              >
                {showHar ? 'Nascondi import da HAR' : 'In alternativa: importa da HAR'}
              </Button>
              <Collapse in={showHar}>
                <div>
                  <Stack className="gap-3">
                    <Form.Group controlId="linkedin-har-file">
                      <Form.Label className="small fw-semibold">File HAR</Form.Label>
                      <Form.Control accept=".har,.json" onChange={handleHarFileChange} type="file" />
                      <Form.Text className="text-secondary">
                        Dal HAR vengono estratti solo li_at e JSESSIONID, il resto viene scartato.
                      </Form.Text>
                    </Form.Group>
                    <Stack direction="horizontal" className="gap-2">
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
                        variant="outline-primary"
                      >
                        Importa da HAR
                      </Button>
                    </Stack>
                    {debug ? <HarDebugSummary debug={debug} /> : null}
                  </Stack>
                </div>
              </Collapse>
            </>
          ) : null}
        </Stack>
      </Card.Body>
      <Card.Footer className="bg-white">
        <div className="form-eyebrow mb-2">Sessioni salvate</div>
        {sessions.length === 0 ? (
          <span className="small text-secondary">Nessuna sessione configurata</span>
        ) : (
          <ListGroup variant="flush">
            {sessions.slice(0, 3).map((session) => (
              <SessionItem
                key={session.id}
                onVerify={() => void handleVerify(session.id)}
                session={session}
                supportsVerify={descriptor?.supportsVerify ?? false}
                verification={verifications[session.id]}
                verifying={verifyingId === session.id}
              />
            ))}
          </ListGroup>
        )}
      </Card.Footer>
    </Card>
  );
}
