import { useEffect, useState } from 'react';

import { Lock, Minus, Plus, RotateCcw, Trash2 } from 'lucide-react';
import Alert from 'react-bootstrap/Alert';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import Form from 'react-bootstrap/Form';
import Spinner from 'react-bootstrap/Spinner';
import Stack from 'react-bootstrap/Stack';

import { useAiSettings } from '../../contexts/AiSettingsContext';
import {
  aiReviewOutputLanguageOptions,
  defaultAiReviewFieldKeys,
  defaultAiReviewFields,
  type AiReviewField,
  type AiReviewOutputLanguage,
} from '../../models/ai';
import { normalizeReviewFieldKey } from '../../services/aiService';
import { downloadJson, readJsonFile } from '../../utils/transfer';
import { ConfirmActionButton } from '../Utilities/ConfirmActionButton';
import { EmptyState, ErrorState, LoadingState } from '../Utilities/SectionState';
import { ImportExportButtons } from './ImportExportButtons';

function formatTimestamp(value: Date): string {
  return value.toLocaleString('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

const RESERVED_REVIEW_FIELD_KEYS = new Set([
  'decision',
  'diagnostic',
  'location_fit',
  'missing_skills',
  'optional_strengths',
  'reason',
  'score',
  'seniority_fit',
  'skill_fit',
]);

// Always emitted by the core review; shown read-only so the full verdict shape is legible.
const VERDICT_SPINE = ['Decisione', 'Punteggio', 'Fit', 'Motivazione'];

const RULES_KIND = 'joblens.profile-rules';
const OUTPUT_LANGUAGE_VALUES = new Set(aiReviewOutputLanguageOptions.map((option) => option.value));

function parseRulesImport(raw: unknown): {
  evaluationRules: string;
  outputLanguage: AiReviewOutputLanguage | null;
  reviewFields: AiReviewField[];
} {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('File non valido');
  }

  const data = raw as Record<string, unknown>;
  if (typeof data.kind === 'string' && data.kind !== RULES_KIND) {
    throw new Error('Questo file non contiene regole di profilo');
  }

  if (typeof data.evaluationRules !== 'string' || !data.evaluationRules.trim()) {
    throw new Error('Il file non contiene regole di valutazione valide');
  }

  if (!Array.isArray(data.reviewFields)) {
    throw new Error('Il file non contiene i campi del verdetto');
  }

  const reviewFields = data.reviewFields.map((item, index): AiReviewField => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`Campo del verdetto non valido alla posizione ${index + 1}`);
    }

    const field = item as Record<string, unknown>;
    if (typeof field.key !== 'string' || typeof field.label !== 'string') {
      throw new Error(`Campo del verdetto non valido alla posizione ${index + 1}`);
    }

    return {
      description: typeof field.description === 'string' ? field.description : '',
      enabled: typeof field.enabled === 'boolean' ? field.enabled : true,
      key: field.key,
      label: field.label,
      maxItems:
        typeof field.maxItems === 'number' && Number.isFinite(field.maxItems) ? field.maxItems : 3,
    };
  });

  const outputLanguage =
    typeof data.outputLanguage === 'string' &&
    OUTPUT_LANGUAGE_VALUES.has(data.outputLanguage as AiReviewOutputLanguage)
      ? (data.outputLanguage as AiReviewOutputLanguage)
      : null;

  return { evaluationRules: data.evaluationRules, outputLanguage, reviewFields };
}

export function AiProfileRulesPanel() {
  const { error, loadingSettings, resetRules, saveSettings, savingSettings, settings } =
    useAiSettings();
  const [evaluationRules, setEvaluationRules] = useState('');
  const [outputLanguage, setOutputLanguage] = useState<AiReviewOutputLanguage>('it');
  const [reviewFields, setReviewFields] = useState<AiReviewField[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setEvaluationRules(settings.evaluationRules);
    setOutputLanguage(settings.outputLanguage);
    setReviewFields(settings.reviewFields.map((field) => ({ ...field })));
  }, [settings]);

  const updateReviewField = (index: number, patch: Partial<AiReviewField>) => {
    setReviewFields((current) =>
      current.map((field, fieldIndex) =>
        fieldIndex === index
          ? {
              ...field,
              ...patch,
            }
          : field,
      ),
    );
  };

  const setMaxItems = (index: number, next: number) => {
    updateReviewField(index, { maxItems: Math.max(1, Math.min(10, next)) });
  };

  const addReviewField = () => {
    setReviewFields((current) => [
      ...current,
      {
        description: 'Concrete evidence from the offer.',
        enabled: true,
        key: `custom_field_${current.length + 1}`,
        label: 'Nuovo campo',
        maxItems: 3,
      },
    ]);
  };

  const removeReviewField = (index: number) => {
    setReviewFields((current) => current.filter((_, fieldIndex) => fieldIndex !== index));
  };

  const resetReviewFields = () => {
    setReviewFields(defaultAiReviewFields.map((field) => ({ ...field })));
  };

  const validateReviewFields = (): AiReviewField[] | null => {
    if (reviewFields.length === 0) {
      setFormError('Configura almeno un campo del verdetto');
      return null;
    }

    const seen = new Set<string>();
    const normalized = [];

    for (const field of reviewFields) {
      const key = normalizeReviewFieldKey(field.key);
      if (!key || key.length < 2 || !/^[a-z][a-z0-9_]*$/.test(key)) {
        setFormError('Le chiavi dei campi devono usare solo lettere, numeri e underscore');
        return null;
      }
      if (RESERVED_REVIEW_FIELD_KEYS.has(key)) {
        setFormError(`La chiave ${key} è riservata al core della review`);
        return null;
      }
      if (seen.has(key)) {
        setFormError(`Campo duplicato: ${key}`);
        return null;
      }
      if (!field.label.trim()) {
        setFormError(`Il campo ${key} deve avere una label`);
        return null;
      }

      seen.add(key);
      normalized.push({
        ...field,
        description: field.description.trim(),
        key,
        label: field.label.trim(),
        maxItems: Math.max(1, Math.min(10, Math.round(field.maxItems))),
      });
    }

    return normalized;
  };

  const handleSave = async () => {
    if (!evaluationRules.trim()) {
      setFormError('Le regole di valutazione sono obbligatorie');
      return;
    }

    const normalizedReviewFields = validateReviewFields();
    if (!normalizedReviewFields) {
      return;
    }

    const result = await saveSettings({
      evaluationRules,
      outputLanguage,
      reviewFields: normalizedReviewFields,
    });
    if (result) {
      setReviewFields(result.reviewFields.map((field) => ({ ...field })));
      setFormError(null);
      setNotice(null);
    }
  };

  const handleResetRules = async () => {
    const result = await resetRules();
    if (result) {
      setEvaluationRules(result.evaluationRules);
      setFormError(null);
      setNotice(null);
    }
  };

  const handleExport = () => {
    downloadJson('joblens-regole-profilo.json', {
      evaluationRules,
      kind: RULES_KIND,
      outputLanguage,
      reviewFields,
      version: 1,
    });
  };

  const handleImport = async (file: File) => {
    try {
      const imported = parseRulesImport(await readJsonFile(file));
      setEvaluationRules(imported.evaluationRules);
      if (imported.outputLanguage) {
        setOutputLanguage(imported.outputLanguage);
      }
      setReviewFields(imported.reviewFields.map((field) => ({ ...field })));
      setFormError(null);
      setNotice('Regole importate. Controlla criteri e campi, poi premi Salva regole.');
    } catch (caught: unknown) {
      setNotice(null);
      setFormError(caught instanceof Error ? caught.message : 'Import non riuscito');
    }
  };

  if (!settings) {
    return (
      <Card className="h-100">
        <Card.Header>
          <span className="fw-semibold">Regole di profilo</span>
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

  const customFieldCount = reviewFields.filter(
    (field) => !defaultAiReviewFieldKeys.has(field.key),
  ).length;

  return (
    <Card className="h-100">
      <Card.Header>
        <Stack
          direction="horizontal"
          className="justify-content-between align-items-center gap-3 flex-wrap"
        >
          <span className="fw-semibold">Regole di profilo</span>
          <Stack direction="horizontal" className="gap-2 align-items-center">
            <ImportExportButtons
              onExport={handleExport}
              onImport={(file) => void handleImport(file)}
            />
            <Badge bg="secondary" className="font-mono">
              Template v{settings.rulesTemplateVersion}
            </Badge>
          </Stack>
        </Stack>
      </Card.Header>
      <Card.Body>
        <Stack className="gap-4">
          {error ? <ErrorState message={error} /> : null}
          {formError ? <ErrorState message={formError} /> : null}
          {notice ? (
            <Alert className="mb-0" variant="success">
              {notice}
            </Alert>
          ) : null}

          {/* ── Zone 1: the rubric prose ───────────────────────────── */}
          <section>
            <Stack
              direction="horizontal"
              className="justify-content-between align-items-end gap-3 mb-2 flex-wrap"
            >
              <div>
                <div className="form-eyebrow">Criteri di valutazione</div>
                <div className="small text-secondary">
                  Istruzioni in linguaggio naturale che l’AI segue per decidere.
                </div>
              </div>
              <Stack direction="horizontal" className="gap-3 align-items-center">
                <span className="small text-secondary font-mono">
                  agg. {formatTimestamp(settings.updatedAt)}
                </span>
                <ConfirmActionButton
                  confirmLabel="Ripristina"
                  confirmMessage="Le regole di valutazione correnti verranno sostituite con il template default."
                  confirmTitle="Ripristinare il template?"
                  disabled={savingSettings}
                  onConfirm={() => void handleResetRules()}
                  size="sm"
                  variant="outline-secondary"
                >
                  <RotateCcw aria-hidden="true" className="me-1" size={14} />
                  Template
                </ConfirmActionButton>
              </Stack>
            </Stack>
            <Form.Control
              as="textarea"
              className="font-mono small"
              id="ai-evaluation-rules"
              onChange={(event) => setEvaluationRules(event.target.value)}
              rows={12}
              value={evaluationRules}
            />
          </section>

          {/* ── Zone 2: the verdict scorecard ──────────────────────── */}
          <section>
            <Stack
              direction="horizontal"
              className="justify-content-between align-items-end gap-3 mb-3 flex-wrap"
            >
              <div>
                <div className="form-eyebrow">La scheda del verdetto</div>
                <div className="small text-secondary">
                  Per ogni offerta l’AI compila questi campi.
                </div>
              </div>
              <Form.Group
                className="d-flex align-items-center gap-2"
                controlId="ai-output-language"
              >
                <Form.Label className="mb-0 small text-secondary text-nowrap">
                  Lingua dell’esito
                </Form.Label>
                <Form.Select
                  onChange={(event) =>
                    setOutputLanguage(event.target.value as AiReviewOutputLanguage)
                  }
                  size="sm"
                  style={{ width: 'auto' }}
                  value={outputLanguage}
                >
                  {aiReviewOutputLanguageOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Stack>

            {/* locked core — always present */}
            <div className="mb-3">
              <span className="form-eyebrow d-block mb-2">Sempre presenti</span>
              <div className="verdict-spine">
                {VERDICT_SPINE.map((label) => (
                  <span className="verdict-chip" key={label}>
                    <Lock aria-hidden="true" size={12} />
                    {label}
                  </span>
                ))}
              </div>
            </div>

            <Stack
              direction="horizontal"
              className="justify-content-between align-items-center gap-3 mb-2 flex-wrap"
            >
              <span className="form-eyebrow">
                Campi aggiuntivi{customFieldCount ? ` · ${customFieldCount} tuoi` : ''}
              </span>
              <Button
                className="p-0 text-secondary text-decoration-none"
                disabled={savingSettings}
                onClick={resetReviewFields}
                size="sm"
                type="button"
                variant="link"
              >
                <RotateCcw aria-hidden="true" className="me-1" size={13} />
                Ripristina campi default
              </Button>
            </Stack>

            <Stack className="gap-2">
              {reviewFields.map((field, index) => {
                const isStandard = defaultAiReviewFieldKeys.has(field.key);

                return (
                  <div
                    className={`verdict-slip ${isStandard ? 'verdict-slip--standard' : 'verdict-slip--custom'}`}
                    key={`${field.key}-${index}`}
                  >
                    <Stack className="gap-2">
                      <Stack
                        direction="horizontal"
                        className="justify-content-between align-items-start gap-3"
                      >
                        <div className="flex-grow-1 min-w-0">
                          <span className="form-eyebrow d-inline-flex align-items-center gap-1 mb-1">
                            {isStandard ? (
                              <>
                                <Lock aria-hidden="true" size={11} />
                                standard
                              </>
                            ) : (
                              'tuo'
                            )}
                          </span>
                          <Form.Control
                            aria-label="Etichetta del campo"
                            className="verdict-slip-label"
                            onChange={(event) =>
                              updateReviewField(index, { label: event.target.value })
                            }
                            value={field.label}
                          />
                        </div>
                        <Stack
                          direction="horizontal"
                          className="gap-2 align-items-center flex-shrink-0"
                        >
                          <Form.Check
                            checked={field.enabled}
                            id={`ai-review-field-enabled-${index}`}
                            label={<span className="small text-secondary">Attivo</span>}
                            onChange={(event) =>
                              updateReviewField(index, { enabled: event.target.checked })
                            }
                            type="switch"
                          />
                          {isStandard ? null : (
                            <Button
                              aria-label="Rimuovi campo"
                              className="text-danger p-1"
                              disabled={savingSettings}
                              onClick={() => removeReviewField(index)}
                              size="sm"
                              title="Rimuovi campo"
                              type="button"
                              variant="link"
                            >
                              <Trash2 aria-hidden="true" size={15} />
                            </Button>
                          )}
                        </Stack>
                      </Stack>

                      <Stack
                        direction="horizontal"
                        className="gap-2 align-items-center flex-wrap text-secondary"
                      >
                        {isStandard ? (
                          <span className="verdict-slip-key">
                            <Lock aria-hidden="true" size={12} />
                            {field.key}
                          </span>
                        ) : (
                          <Form.Control
                            aria-label="Chiave del campo"
                            className="font-mono verdict-slip-key-input"
                            onChange={(event) =>
                              updateReviewField(index, { key: event.target.value })
                            }
                            size="sm"
                            value={field.key}
                          />
                        )}
                        <span aria-hidden="true">·</span>
                        <span className="small">fino a</span>
                        <span
                          aria-label="Numero massimo di voci"
                          className="verdict-stepper"
                          role="group"
                        >
                          <button
                            aria-label="Riduci"
                            disabled={field.maxItems <= 1}
                            onClick={() => setMaxItems(index, field.maxItems - 1)}
                            type="button"
                          >
                            <Minus aria-hidden="true" size={13} />
                          </button>
                          <span className="verdict-stepper-value">{field.maxItems}</span>
                          <button
                            aria-label="Aumenta"
                            disabled={field.maxItems >= 10}
                            onClick={() => setMaxItems(index, field.maxItems + 1)}
                            type="button"
                          >
                            <Plus aria-hidden="true" size={13} />
                          </button>
                        </span>
                        <span className="small">voci</span>
                      </Stack>

                      <div>
                        <Form.Label
                          className="form-eyebrow mb-1"
                          htmlFor={`ai-review-field-desc-${index}`}
                        >
                          Cosa cercare nell’offerta
                        </Form.Label>
                        <Form.Control
                          as="textarea"
                          id={`ai-review-field-desc-${index}`}
                          onChange={(event) =>
                            updateReviewField(index, { description: event.target.value })
                          }
                          rows={2}
                          value={field.description}
                        />
                      </div>
                    </Stack>
                  </div>
                );
              })}

              <button
                className="verdict-add"
                disabled={savingSettings}
                onClick={addReviewField}
                type="button"
              >
                <Plus aria-hidden="true" className="me-1" size={15} />
                Aggiungi campo
              </button>
            </Stack>
          </section>

          <div>
            <Button disabled={savingSettings} onClick={() => void handleSave()} variant="primary">
              {savingSettings ? <Spinner animation="border" className="me-2" size="sm" /> : null}
              Salva regole
            </Button>
          </div>
        </Stack>
      </Card.Body>
    </Card>
  );
}
