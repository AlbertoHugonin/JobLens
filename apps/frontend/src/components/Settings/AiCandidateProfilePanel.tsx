import { useEffect, useMemo, useState } from 'react';

import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import Form from 'react-bootstrap/Form';
import Spinner from 'react-bootstrap/Spinner';
import Stack from 'react-bootstrap/Stack';

import { useAiSettings } from '../../contexts/AiSettingsContext';
import { downloadJson, readJsonFile } from '../../utils/transfer';
import { EmptyState, ErrorState, LoadingState } from '../Utilities/SectionState';
import { ImportExportButtons } from './ImportExportButtons';

const CANDIDATE_KIND = 'joblens.candidate-profile';

const PROFILE_HINTS = [
  'Ruolo e livello che cerchi',
  'Competenze e tecnologie chiave',
  'Lingue parlate',
  'Sede e modalità (in sede, ibrido, remoto)',
  'Vincoli e deal-breaker',
];

function parseCandidateImport(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('File non valido');
  }

  const data = raw as Record<string, unknown>;
  if (typeof data.kind === 'string' && data.kind !== CANDIDATE_KIND) {
    throw new Error('Questo file non è un profilo candidato');
  }

  if (typeof data.candidateProfile !== 'string' || !data.candidateProfile.trim()) {
    throw new Error('Il file non contiene un profilo candidato valido');
  }

  return data.candidateProfile;
}

export function AiCandidateProfilePanel() {
  const { error, loadingSettings, saveSettings, savingSettings, settings } = useAiSettings();
  const [candidateProfile, setCandidateProfile] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setCandidateProfile(settings.candidateProfile);
  }, [settings]);

  const isDirty = settings ? candidateProfile !== settings.candidateProfile : false;
  const charCount = useMemo(() => candidateProfile.trim().length, [candidateProfile]);

  const handleSave = async () => {
    if (!candidateProfile.trim()) {
      setFormError('Il profilo candidato è obbligatorio');
      return;
    }

    const result = await saveSettings({ candidateProfile });
    if (result) {
      setCandidateProfile(result.candidateProfile);
      setFormError(null);
      setNotice(null);
    }
  };

  const handleExport = () => {
    downloadJson('joblens-profilo-candidato.json', {
      candidateProfile,
      kind: CANDIDATE_KIND,
      version: 1,
    });
  };

  const handleImport = async (file: File) => {
    try {
      const candidate = parseCandidateImport(await readJsonFile(file));
      setCandidateProfile(candidate);
      setFormError(null);
      setNotice('Profilo importato. Controlla il testo e premi Salva per applicarlo.');
    } catch (caught: unknown) {
      setNotice(null);
      setFormError(caught instanceof Error ? caught.message : 'Import non riuscito');
    }
  };

  if (!settings) {
    return (
      <Card className="h-100">
        <Card.Header>
          <span className="fw-semibold">Profilo candidato</span>
        </Card.Header>
        <Card.Body>
          {loadingSettings ? (
            <LoadingState label="Caricamento profilo" />
          ) : (
            <EmptyState message="Impostazioni AI non caricate" />
          )}
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card className="h-100">
      <Card.Header>
        <Stack direction="horizontal" className="justify-content-between align-items-center gap-3">
          <span className="fw-semibold">Profilo candidato</span>
          <ImportExportButtons
            onExport={handleExport}
            onImport={(file) => void handleImport(file)}
          />
        </Stack>
      </Card.Header>
      <Card.Body>
        <Stack className="gap-3">
          {error ? <ErrorState message={error} /> : null}
          {formError ? <ErrorState message={formError} /> : null}
          {notice ? (
            <Alert className="mb-0" variant="success">
              {notice}
            </Alert>
          ) : null}

          <p className="text-secondary mb-0">
            Descrivi chi sei e cosa cerchi. L’AI confronta ogni offerta con questo profilo per
            assegnare il punteggio e spiegare la decisione. Scrivilo in linguaggio naturale, come lo
            racconteresti a una persona.
          </p>

          <Form.Group controlId="ai-candidate-profile">
            <Form.Label className="form-eyebrow">Il tuo profilo</Form.Label>
            <Form.Control
              as="textarea"
              onChange={(event) => {
                setCandidateProfile(event.target.value);
                setNotice(null);
              }}
              placeholder="Es. Frontend engineer con 5 anni di esperienza in React e TypeScript, cerco un ruolo mid/senior, remoto o ibrido a Milano. Non mi interessano stage o ruoli solo backend."
              rows={12}
              value={candidateProfile}
            />
            <Form.Text className="d-flex flex-wrap gap-2 mt-2 align-items-center">
              <span className="text-secondary">Cosa includere:</span>
              {PROFILE_HINTS.map((hint) => (
                <span className="badge text-bg-light border fw-normal" key={hint}>
                  {hint}
                </span>
              ))}
            </Form.Text>
          </Form.Group>

          <Stack direction="horizontal" className="gap-3 align-items-center flex-wrap">
            <Button disabled={savingSettings} onClick={() => void handleSave()} variant="primary">
              {savingSettings ? <Spinner animation="border" className="me-2" size="sm" /> : null}
              Salva profilo
            </Button>
            <span className="small text-secondary font-mono">{charCount} caratteri</span>
            {isDirty ? (
              <span className="small text-warning-emphasis">Modifiche non salvate</span>
            ) : null}
          </Stack>
        </Stack>
      </Card.Body>
    </Card>
  );
}
