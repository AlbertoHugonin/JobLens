import { useState } from 'react';

import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import Col from 'react-bootstrap/Col';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';
import Row from 'react-bootstrap/Row';
import Spinner from 'react-bootstrap/Spinner';
import Stack from 'react-bootstrap/Stack';

import {
  clearOperationalData,
  exportJobLensBackup,
  importJobLensBackup,
  resetApplicationData,
  type ApplicationResetDto,
  type BackupImportModeDto,
  type BackupImportResultDto,
  type BackupSectionDto,
  type OperationalClearDto,
} from '../../API/maintenance';
import { useDebugMode } from '../../contexts/DebugModeContext';
import { downloadJson, readJsonFile } from '../../utils/transfer';
import { ImportExportButtons } from './ImportExportButtons';

const RESET_CONFIRMATION = 'RESET';
const CLEAR_CONFIRMATION = 'CLEAR';

const BACKUP_SECTIONS: Array<{
  description: string;
  key: BackupSectionDto;
  label: string;
}> = [
  {
    description: 'Configurazione e pianificazione delle ricerche.',
    key: 'searches',
    label: 'Ricerche',
  },
  {
    description: 'Offerte e identificativi esterni per deduplica.',
    key: 'jobs',
    label: 'Offerte',
  },
  {
    description: 'Associazioni tra offerte e ricerche.',
    key: 'jobSearchPresence',
    label: 'Collegamenti offerte-ricerche',
  },
  {
    description: 'Testo e HTML salvati per le offerte.',
    key: 'jobDescriptions',
    label: 'Descrizioni offerte',
  },
  {
    description: 'Verdetti, score e output delle valutazioni.',
    key: 'jobReviews',
    label: 'Valutazioni AI',
  },
  {
    description: 'Cookie e credenziali sessione provider.',
    key: 'providerSessions',
    label: 'Sessioni provider',
  },
  {
    description: 'Profilo, regole, runtime, pause e campi review.',
    key: 'aiSettings',
    label: 'Impostazioni AI',
  },
  {
    description: 'Endpoint AI configurati e catalogo modelli.',
    key: 'aiEndpoints',
    label: 'Endpoint e modelli AI',
  },
];

const BACKUP_SECTION_ORDER = BACKUP_SECTIONS.map((section) => section.key);

const BACKUP_PRESETS: Array<{
  key: string;
  label: string;
  sections: BackupSectionDto[];
}> = [
  {
    key: 'searches',
    label: 'Solo ricerche',
    sections: ['searches'],
  },
  {
    key: 'jobs-searches',
    label: 'Offerte + ricerche',
    sections: ['searches', 'jobs', 'jobSearchPresence', 'jobDescriptions'],
  },
  {
    key: 'jobs-searches-ai',
    label: 'Offerte + ricerche + valutazioni AI',
    sections: ['searches', 'jobs', 'jobSearchPresence', 'jobDescriptions', 'jobReviews'],
  },
  {
    key: 'operational',
    label: 'Migrazione operativa',
    sections: [
      'searches',
      'jobs',
      'jobSearchPresence',
      'jobDescriptions',
      'jobReviews',
      'providerSessions',
    ],
  },
  {
    key: 'ai-config',
    label: 'Configurazione AI',
    sections: ['aiSettings', 'aiEndpoints'],
  },
  {
    key: 'complete',
    label: 'Backup completo ripristinabile',
    sections: [...BACKUP_SECTION_ORDER],
  },
];

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Errore imprevisto';
}

function compactTimestamp(): string {
  return new Date().toISOString().replace(/\D/g, '').slice(0, 14);
}

function sortSections(sections: BackupSectionDto[]): BackupSectionDto[] {
  const selected = new Set(sections);
  return BACKUP_SECTION_ORDER.filter((section) => selected.has(section));
}

export function DebugSettingsPanel() {
  const { debugMode, setDebugMode } = useDebugMode();
  const [backupSections, setBackupSections] = useState<BackupSectionDto[]>(
    BACKUP_PRESETS[1]?.sections ?? ['searches'],
  );
  const [backupMode, setBackupMode] = useState<BackupImportModeDto>('merge');
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [backupImportResult, setBackupImportResult] = useState<BackupImportResultDto | null>(null);
  const [showReset, setShowReset] = useState(false);
  const [resetInput, setResetInput] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<ApplicationResetDto | null>(null);
  const [showClear, setShowClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [clearResult, setClearResult] = useState<OperationalClearDto | null>(null);

  const selectedBackupSections = sortSections(backupSections);
  const selectedBackupSectionSet = new Set(selectedBackupSections);

  const toggleBackupSection = (section: BackupSectionDto) => {
    setBackupSections((current) =>
      current.includes(section)
        ? current.filter((item) => item !== section)
        : sortSections([...current, section]),
    );
    setBackupError(null);
  };

  const applyBackupPreset = (presetKey: string) => {
    const preset = BACKUP_PRESETS.find((item) => item.key === presetKey);
    if (preset) {
      setBackupSections(preset.sections);
      setBackupError(null);
    }
  };

  const ensureBackupSelection = (): BackupSectionDto[] | null => {
    if (selectedBackupSections.length === 0) {
      setBackupError('Seleziona almeno una sezione');
      return null;
    }

    return selectedBackupSections;
  };

  const handleExportBackup = async () => {
    const sections = ensureBackupSelection();
    if (!sections) {
      return;
    }

    setBackupBusy(true);
    try {
      const response = await exportJobLensBackup({ sections });
      downloadJson(`joblens-backup-${compactTimestamp()}.json`, response.data);
      setBackupImportResult(null);
      setBackupNotice(`Backup esportato: ${sections.length} sezioni`);
      setBackupError(null);
    } catch (error: unknown) {
      setBackupError(readErrorMessage(error));
    } finally {
      setBackupBusy(false);
    }
  };

  const handleImportBackup = async (file: File) => {
    const sections = ensureBackupSelection();
    if (!sections) {
      return;
    }

    if (
      backupMode === 'replace' &&
      !window.confirm('Le sezioni selezionate verranno sostituite prima dell’import. Continuare?')
    ) {
      return;
    }

    setBackupBusy(true);
    try {
      const backup = await readJsonFile(file);
      const response = await importJobLensBackup({ backup, mode: backupMode, sections });
      setBackupImportResult(response.data);
      setBackupNotice('Import completato');
      setBackupError(null);
    } catch (error: unknown) {
      setBackupError(readErrorMessage(error));
    } finally {
      setBackupBusy(false);
    }
  };

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
          <div className="border-top pt-3">
            <div className="fw-semibold">Import/export selettivo</div>
            <p className="text-secondary small mb-3">
              Crea o ripristina backup JSON scegliendo singole sezioni o preset comuni.
              L&apos;import predefinito unisce e aggiorna i dati esistenti; la sostituzione cancella
              prima solo le sezioni selezionate.
            </p>
            <Stack className="gap-3">
              <Row className="g-3">
                <Col md={6}>
                  <Form.Group controlId="debug-backup-preset">
                    <Form.Label>Preset</Form.Label>
                    <Form.Select
                      disabled={!debugMode || backupBusy}
                      onChange={(event) => applyBackupPreset(event.target.value)}
                      value=""
                    >
                      <option value="">Scegli preset</option>
                      {BACKUP_PRESETS.map((preset) => (
                        <option key={preset.key} value={preset.key}>
                          {preset.label}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group controlId="debug-backup-mode">
                    <Form.Label>Modalita import</Form.Label>
                    <Form.Select
                      disabled={!debugMode || backupBusy}
                      onChange={(event) =>
                        setBackupMode(event.target.value === 'replace' ? 'replace' : 'merge')
                      }
                      value={backupMode}
                    >
                      <option value="merge">Unisci / aggiorna</option>
                      <option value="replace">Sostituisci sezioni selezionate</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
              </Row>
              <Row className="g-2">
                {BACKUP_SECTIONS.map((section) => (
                  <Col md={6} key={section.key}>
                    <Form.Check
                      checked={selectedBackupSectionSet.has(section.key)}
                      disabled={!debugMode || backupBusy}
                      id={`debug-backup-section-${section.key}`}
                      label={
                        <span>
                          <span className="fw-medium">{section.label}</span>
                          <span className="d-block small text-secondary">
                            {section.description}
                          </span>
                        </span>
                      }
                      onChange={() => toggleBackupSection(section.key)}
                      type="checkbox"
                    />
                  </Col>
                ))}
              </Row>
              {backupError ? (
                <Alert className="mb-0" variant="danger">
                  {backupError}
                </Alert>
              ) : null}
              {backupNotice ? (
                <Alert className="mb-0" variant="success">
                  {backupNotice}
                </Alert>
              ) : null}
              {backupImportResult ? (
                <div className="small text-secondary">
                  {Object.entries(backupImportResult.sections).map(([section, result]) =>
                    result ? (
                      <div key={section}>
                        <span className="font-mono">{section}</span>: importati {result.imported},
                        saltati {result.skipped}, eliminati {result.deleted}
                      </div>
                    ) : null,
                  )}
                </div>
              ) : null}
              <Stack direction="horizontal" className="gap-2 align-items-center flex-wrap">
                <ImportExportButtons
                  disabled={!debugMode || backupBusy}
                  exportLabel={backupBusy ? 'Operazione in corso' : 'Esporta selezione'}
                  importLabel="Importa file"
                  onExport={() => void handleExportBackup()}
                  onImport={(file) => void handleImportBackup(file)}
                />
                {backupBusy ? <Spinner animation="border" size="sm" /> : null}
              </Stack>
              {!debugMode ? (
                <div className="small text-secondary">
                  Attiva gli strumenti di debug per usare import/export.
                </div>
              ) : null}
            </Stack>
          </div>
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
