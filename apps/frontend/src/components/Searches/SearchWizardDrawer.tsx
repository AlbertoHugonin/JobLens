import { useEffect, useState } from 'react';

import Button from 'react-bootstrap/Button';
import Collapse from 'react-bootstrap/Collapse';
import Form from 'react-bootstrap/Form';
import InputGroup from 'react-bootstrap/InputGroup';
import Modal from 'react-bootstrap/Modal';
import Spinner from 'react-bootstrap/Spinner';
import Stack from 'react-bootstrap/Stack';

import { useSearches } from '../../contexts/SearchesContext';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import {
  createDraftFromQuery,
  createDraftFromSearch,
  createEmptyLinkedInSearchDraft,
  searchScheduleDayOptions,
  type LinkedInSearchDraft,
  type Search,
  type SearchScheduleConfig,
} from '../../models/search';
import { ErrorState } from '../Utilities/SectionState';
import { LinkedInSearchForm } from './LinkedInSearchForm';

function toggleScheduleDay(schedule: SearchScheduleConfig, day: number, checked: boolean): number[] {
  if (checked) {
    return Array.from(new Set([...schedule.activeDays, day])).sort((left, right) => left - right);
  }

  const nextDays = schedule.activeDays.filter((item) => item !== day);
  return nextDays.length > 0 ? nextDays : schedule.activeDays;
}

function readScheduleNumber(value: string, fallback: number, min: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.trunc(parsed)) : fallback;
}

export function SearchWizardDrawer({
  onHide,
  search,
  show,
}: {
  onHide: () => void;
  search: Search | null;
  show: boolean;
}) {
  const { error, geoError, geoHits, importUrl, preview, previewDraft, saveDraft, searchGeo } =
    useSearches();
  const [draft, setDraft] = useState<LinkedInSearchDraft>(createEmptyLinkedInSearchDraft);
  const [importInput, setImportInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const debouncedLocation = useDebouncedValue(draft.location, 350);
  const previewUrl = preview?.url ?? search?.query.publicUrl ?? '';

  useEffect(() => {
    if (show) {
      setDraft(search ? createDraftFromSearch(search) : createEmptyLinkedInSearchDraft());
      setImportInput('');
      setShowSchedule(search?.scheduleConfig.enabled ?? false);
    }
  }, [search, show]);

  useEffect(() => {
    if (show) {
      void searchGeo(debouncedLocation);
    }
  }, [debouncedLocation, searchGeo, show]);

  const updateSchedule = (input: Partial<SearchScheduleConfig>) => {
    setDraft((current) => ({
      ...current,
      scheduleConfig: { ...current.scheduleConfig, ...input },
    }));
  };

  const updateInactiveWindow = (input: Partial<SearchScheduleConfig['inactiveWindow']>) => {
    setDraft((current) => ({
      ...current,
      scheduleConfig: {
        ...current.scheduleConfig,
        inactiveWindow: { ...current.scheduleConfig.inactiveWindow, ...input },
      },
    }));
  };

  const handlePreview = async () => {
    setPreviewing(true);
    await previewDraft(draft);
    setPreviewing(false);
  };

  const handleSave = async () => {
    setSaving(true);
    const saved = await saveDraft(draft, search?.id);
    setSaving(false);
    if (saved) {
      onHide();
    }
  };

  const handleImport = async () => {
    if (!importInput.trim()) {
      return;
    }

    setImporting(true);
    const result = await importUrl(importInput);
    if (result) {
      const importedDraft = createDraftFromQuery(result.query);
      setDraft((current) => ({
        ...importedDraft,
        enabled: current.enabled,
        name: current.name || importedDraft.keywords || 'Ricerca LinkedIn',
      }));
    }
    setImporting(false);
  };

  return (
    <Modal
      centered
      className="search-wizard-modal"
      onHide={onHide}
      scrollable
      show={show}
      size="lg"
    >
      <Modal.Header closeButton>
        <Modal.Title>{search ? 'Modifica ricerca' : 'Nuova ricerca'}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Stack className="gap-4">
          {error ? <ErrorState message={error} /> : null}

          <section>
            <div className="form-eyebrow mb-2">Generale</div>
            <div className="row g-3">
              <Form.Group className="col-md-6" controlId="search-provider">
                <Form.Label>Provider</Form.Label>
                <Form.Select disabled value="linkedin">
                  <option value="linkedin">LinkedIn</option>
                </Form.Select>
              </Form.Group>
              <Form.Group className="col-md-6" controlId="search-enabled">
                <Form.Label>Stato</Form.Label>
                <Form.Select
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, enabled: event.target.value === 'true' }))
                  }
                  value={String(draft.enabled)}
                >
                  <option value="true">Attiva</option>
                  <option value="false">In pausa</option>
                </Form.Select>
              </Form.Group>
              <Form.Group className="col-12" controlId="search-name">
                <Form.Label>Nome ricerca</Form.Label>
                <Form.Control
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Frontend remoto"
                  value={draft.name}
                />
              </Form.Group>
              <Form.Group className="col-12" controlId="search-import-url">
                <Form.Label>Importa da URL</Form.Label>
                <InputGroup>
                  <Form.Control
                    onChange={(event) => setImportInput(event.target.value)}
                    placeholder="https://www.linkedin.com/jobs/search/?keywords=..."
                    type="url"
                    value={importInput}
                  />
                  <Button
                    disabled={!importInput.trim() || importing}
                    onClick={() => void handleImport()}
                  >
                    {importing ? <Spinner animation="border" className="me-2" size="sm" /> : null}
                    Importa
                  </Button>
                </InputGroup>
                <Form.Text className="text-secondary">
                  Incolla l&apos;URL di una ricerca per precompilare i campi.
                </Form.Text>
              </Form.Group>
            </div>
          </section>

          <section>
            <div className="form-eyebrow mb-2">Parametri di ricerca</div>
            <LinkedInSearchForm
              draft={draft}
              geoError={geoError}
              geoHits={geoHits}
              setDraft={setDraft}
            />
          </section>

          <div>
            <Button
              aria-expanded={showSchedule}
              className="p-0 text-decoration-none"
              onClick={() => setShowSchedule((current) => !current)}
              variant="link"
            >
              {showSchedule
                ? 'Nascondi pianificazione automatica'
                : 'Pianificazione automatica (avanzato)'}
            </Button>
            <Collapse in={showSchedule}>
              <div className="pt-3">
                <Stack className="gap-3">
                  <Form.Check
                    checked={draft.scheduleConfig.enabled}
                    id="search-schedule-enabled"
                    label="Scheduler automatico"
                    onChange={(event) => updateSchedule({ enabled: event.target.checked })}
                    type="switch"
                  />
                  <div className="row g-3">
                    <Form.Group className="col-md-6" controlId="search-schedule-interval">
                      <Form.Label>Intervallo minuti</Form.Label>
                      <Form.Control
                        min={1}
                        onChange={(event) =>
                          updateSchedule({
                            intervalMinutes: readScheduleNumber(
                              event.target.value,
                              draft.scheduleConfig.intervalMinutes,
                              1,
                            ),
                          })
                        }
                        type="number"
                        value={draft.scheduleConfig.intervalMinutes}
                      />
                    </Form.Group>
                    <Form.Group className="col-md-6" controlId="search-schedule-delay">
                      <Form.Label>Ritardo extra minuti</Form.Label>
                      <Form.Control
                        min={0}
                        onChange={(event) =>
                          updateSchedule({
                            extraDelayMinutes: readScheduleNumber(
                              event.target.value,
                              draft.scheduleConfig.extraDelayMinutes,
                              0,
                            ),
                          })
                        }
                        type="number"
                        value={draft.scheduleConfig.extraDelayMinutes}
                      />
                    </Form.Group>
                    <Form.Group className="col-12" controlId="search-schedule-days">
                      <Form.Label>Giorni attivi</Form.Label>
                      <Stack direction="horizontal" className="flex-wrap gap-3">
                        {searchScheduleDayOptions.map((option) => (
                          <Form.Check
                            key={option.value}
                            checked={draft.scheduleConfig.activeDays.includes(option.value)}
                            id={`search-schedule-day-${option.value}`}
                            label={option.label}
                            onChange={(event) =>
                              updateSchedule({
                                activeDays: toggleScheduleDay(
                                  draft.scheduleConfig,
                                  option.value,
                                  event.target.checked,
                                ),
                              })
                            }
                            type="checkbox"
                          />
                        ))}
                      </Stack>
                    </Form.Group>
                    <Form.Group
                      className="col-md-4 d-flex align-items-end"
                      controlId="search-schedule-inactive-enabled"
                    >
                      <Form.Check
                        checked={draft.scheduleConfig.inactiveWindow.enabled}
                        label="Fascia inattiva"
                        onChange={(event) => updateInactiveWindow({ enabled: event.target.checked })}
                        type="switch"
                      />
                    </Form.Group>
                    <Form.Group className="col-md-4" controlId="search-schedule-inactive-start">
                      <Form.Label>Inizio</Form.Label>
                      <Form.Control
                        onChange={(event) => updateInactiveWindow({ startTime: event.target.value })}
                        type="time"
                        value={draft.scheduleConfig.inactiveWindow.startTime}
                      />
                    </Form.Group>
                    <Form.Group className="col-md-4" controlId="search-schedule-inactive-end">
                      <Form.Label>Fine</Form.Label>
                      <Form.Control
                        onChange={(event) => updateInactiveWindow({ endTime: event.target.value })}
                        type="time"
                        value={draft.scheduleConfig.inactiveWindow.endTime}
                      />
                    </Form.Group>
                  </div>
                </Stack>
              </div>
            </Collapse>
          </div>

          <Form.Group controlId="search-preview-url">
            <Form.Label>URL completo</Form.Label>
            <Form.Control
              as="textarea"
              className="font-mono small"
              readOnly
              rows={3}
              value={previewUrl}
            />
          </Form.Group>
        </Stack>
      </Modal.Body>
      <Modal.Footer>
        <Button
          className="me-auto"
          disabled={previewing}
          onClick={() => void handlePreview()}
          variant="outline-secondary"
        >
          {previewing ? <Spinner animation="border" className="me-2" size="sm" /> : null}
          Preview URL
        </Button>
        <Button disabled={saving} onClick={() => void handleSave()} variant="primary">
          {saving ? <Spinner animation="border" className="me-2" size="sm" /> : null}
          {search ? 'Aggiorna' : 'Salva ricerca'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
