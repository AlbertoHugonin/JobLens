import { useEffect, useState } from 'react';

import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import Form from 'react-bootstrap/Form';
import Spinner from 'react-bootstrap/Spinner';
import Stack from 'react-bootstrap/Stack';

import { useAiSettings } from '../../contexts/AiSettingsContext';
import { ConfirmActionButton } from '../Utilities/ConfirmActionButton';
import { EmptyState, ErrorState, LoadingState } from '../Utilities/SectionState';

function formatTimestamp(value: Date): string {
  return value.toLocaleString('it-IT', {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
}

export function AiProfileRulesPanel() {
  const { error, loadingSettings, resetRules, saveSettings, savingSettings, settings } =
    useAiSettings();
  const [candidateProfile, setCandidateProfile] = useState('');
  const [evaluationRules, setEvaluationRules] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setCandidateProfile(settings.candidateProfile);
    setEvaluationRules(settings.evaluationRules);
  }, [settings]);

  const handleSave = async () => {
    if (!candidateProfile.trim()) {
      setFormError('Il profilo candidato e obbligatorio');
      return;
    }

    if (!evaluationRules.trim()) {
      setFormError('Le regole di valutazione sono obbligatorie');
      return;
    }

    const result = await saveSettings({
      candidateProfile,
      evaluationRules,
    });
    if (result) {
      setFormError(null);
    }
  };

  const handleResetRules = async () => {
    const result = await resetRules();
    if (result) {
      setEvaluationRules(result.evaluationRules);
      setFormError(null);
    }
  };

  if (!settings) {
    return (
      <Card className="h-100">
        <Card.Header>
          <span className="fw-semibold">Profilo e regole</span>
        </Card.Header>
        <Card.Body>
          {loadingSettings ? (
            <LoadingState label="Caricamento regole AI" />
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
        <Stack direction="horizontal" className="justify-content-between gap-3">
          <span className="fw-semibold">Profilo e regole</span>
          <Badge bg="secondary" className="font-mono">
            Template v{settings.rulesTemplateVersion}
          </Badge>
        </Stack>
      </Card.Header>
      <Card.Body>
        <Stack className="gap-3">
          {error ? <ErrorState message={error} /> : null}
          {formError ? <ErrorState message={formError} /> : null}
          <Form.Group controlId="ai-candidate-profile">
            <Form.Label>Profilo candidato</Form.Label>
            <Form.Control
              as="textarea"
              onChange={(event) => setCandidateProfile(event.target.value)}
              rows={7}
              value={candidateProfile}
            />
          </Form.Group>
          <Form.Group controlId="ai-evaluation-rules">
            <Stack direction="horizontal" className="justify-content-between gap-3 mb-2">
              <Form.Label className="mb-0">Regole di valutazione</Form.Label>
              <span className="small text-secondary font-mono">
                {formatTimestamp(settings.updatedAt)}
              </span>
            </Stack>
            <Form.Control
              as="textarea"
              className="font-mono small"
              onChange={(event) => setEvaluationRules(event.target.value)}
              rows={12}
              value={evaluationRules}
            />
          </Form.Group>
          <Stack direction="horizontal" className="gap-2 flex-wrap">
            <Button disabled={savingSettings} onClick={() => void handleSave()} variant="primary">
              {savingSettings ? <Spinner animation="border" className="me-2" size="sm" /> : null}
              Salva profilo e regole
            </Button>
            <ConfirmActionButton
              confirmLabel="Ripristina"
              confirmMessage="Le regole di valutazione correnti verranno sostituite con il template default. Il profilo candidato non verra modificato."
              confirmTitle="Ripristinare il template?"
              disabled={savingSettings}
              onConfirm={() => void handleResetRules()}
              variant="outline-secondary"
            >
              Ripristina template
            </ConfirmActionButton>
          </Stack>
        </Stack>
      </Card.Body>
    </Card>
  );
}
