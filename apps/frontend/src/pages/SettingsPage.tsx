import { useCallback, useState } from 'react';

import {
  Bug,
  Cpu,
  ListChecks,
  Plug,
  Server,
  SlidersHorizontal,
  UserRound,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import Card from 'react-bootstrap/Card';
import Col from 'react-bootstrap/Col';
import ListGroup from 'react-bootstrap/ListGroup';
import Row from 'react-bootstrap/Row';
import Stack from 'react-bootstrap/Stack';

import { AiBehaviorPanel } from '../components/Settings/AiBehaviorPanel';
import { AiCandidateProfilePanel } from '../components/Settings/AiCandidateProfilePanel';
import { AiConnectionPanel } from '../components/Settings/AiConnectionPanel';
import { AiModelPanel } from '../components/Settings/AiModelPanel';
import { AiProfileRulesPanel } from '../components/Settings/AiProfileRulesPanel';
import { DebugSettingsPanel } from '../components/Settings/DebugSettingsPanel';
import { MaintenancePanel } from '../components/Settings/MaintenancePanel';
import { ProviderSessionPanel } from '../components/Settings/ProviderSessionPanel';
import { PageHeader } from '../components/Layout/PageHeader';
import { AiSettingsProvider, useAiSettings } from '../contexts/AiSettingsContext';
import { MaintenanceProvider } from '../contexts/MaintenanceContext';
import { ProvidersProvider, useProviders } from '../contexts/ProvidersContext';
import { useActivityEvents } from '../hooks/useActivityEvents';
import { useInitialLoad } from '../hooks/useInitialLoad';
import { isActiveActivity } from '../models/activity';

type SettingsKey =
  | 'provider'
  | 'ai-connection'
  | 'ai-model'
  | 'ai-behavior'
  | 'ai-profile'
  | 'ai-rules'
  | 'maintenance'
  | 'debug';

interface SettingsEntry {
  description: string;
  hint: string;
  icon: LucideIcon;
  key: SettingsKey;
  render: () => React.ReactNode;
  title: string;
}

interface SettingsGroup {
  entries: SettingsEntry[];
  label: string;
}

const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: 'Provider',
    entries: [
      {
        description:
          'Gestisci le sessioni dei provider che JobLens usa per raccogliere le offerte.',
        hint: 'Sessioni e credenziali',
        icon: Plug,
        key: 'provider',
        render: () => <ProviderSessionPanel />,
        title: 'Sessioni',
      },
    ],
  },
  {
    label: 'Intelligenza artificiale',
    entries: [
      {
        description: 'Scegli quale server AI usare e controlla se risponde.',
        hint: 'Server e stato',
        icon: Server,
        key: 'ai-connection',
        render: () => <AiConnectionPanel />,
        title: 'Connessione',
      },
      {
        description: 'Scegli il modello per le valutazioni e installa nuovi modelli.',
        hint: 'Modello e installazione',
        icon: Cpu,
        key: 'ai-model',
        render: () => <AiModelPanel />,
        title: 'Modello',
      },
      {
        description: 'Attiva le valutazioni e regola parametri, timeout e pause.',
        hint: 'Valutazioni, parametri, pause',
        icon: SlidersHorizontal,
        key: 'ai-behavior',
        render: () => <AiBehaviorPanel />,
        title: 'Comportamento',
      },
      {
        description:
          'Descrivi chi sei e cosa cerchi: l’AI confronta ogni offerta con questo profilo.',
        hint: 'Chi sei e cosa cerchi',
        icon: UserRound,
        key: 'ai-profile',
        render: () => <AiCandidateProfilePanel />,
        title: 'Profilo candidato',
      },
      {
        description: 'Definisci i criteri con cui l’AI valuta ogni offerta e i campi del verdetto.',
        hint: 'Criteri e campi del verdetto',
        icon: ListChecks,
        key: 'ai-rules',
        render: () => <AiProfileRulesPanel />,
        title: 'Regole di profilo',
      },
    ],
  },
  {
    label: 'Sistema',
    entries: [
      {
        description: 'Pulisci le valutazioni salvate e usa gli strumenti di diagnostica.',
        hint: 'Pulizia e diagnostica',
        icon: Wrench,
        key: 'maintenance',
        render: () => <MaintenancePanel />,
        title: 'Manutenzione',
      },
      {
        description: 'Mostra le azioni e i pannelli di diagnostica nelle pagine operative.',
        hint: 'Strumenti di debug nella UI',
        icon: Bug,
        key: 'debug',
        render: () => <DebugSettingsPanel />,
        title: 'Debug',
      },
    ],
  },
];

const SETTINGS_ENTRIES = SETTINGS_GROUPS.flatMap((group) => group.entries);

function SettingsWorkspace() {
  const { installActivity, loadAll, refreshInstallActivity } = useAiSettings();
  const { loadDescriptor, loadSessions } = useProviders();
  const [active, setActive] = useState<SettingsKey>('provider');
  const initialLoad = useCallback(async () => {
    await Promise.all([loadAll(true), loadDescriptor(), loadSessions(true)]);
  }, [loadAll, loadDescriptor, loadSessions]);
  const hasActiveInstall = Boolean(installActivity && isActiveActivity(installActivity.status));

  useInitialLoad(initialLoad);
  useActivityEvents(refreshInstallActivity, hasActiveInstall);

  const current = SETTINGS_ENTRIES.find((entry) => entry.key === active);

  return (
    <Stack className="settings-page gap-4">
      <PageHeader
        description="Configura provider, intelligenza artificiale e manutenzione"
        title="Impostazioni"
      />

      <Row className="g-4">
        <Col lg={4} xl={3}>
          <Card className="settings-nav-card sticky-lg-top" style={{ top: '1rem' }}>
            <Card.Body className="p-2">
              {SETTINGS_GROUPS.map((group) => (
                <div className="mb-2" key={group.label}>
                  <div className="form-eyebrow px-2 pt-2 pb-1">{group.label}</div>
                  <ListGroup className="settings-nav" variant="flush">
                    {group.entries.map((entry) => {
                      const Icon = entry.icon;
                      return (
                        <ListGroup.Item
                          key={entry.key}
                          action
                          active={entry.key === active}
                          onClick={() => setActive(entry.key)}
                        >
                          <Stack direction="horizontal" className="gap-3 align-items-center">
                            <span className="settings-nav-icon">
                              <Icon aria-hidden="true" size={18} />
                            </span>
                            <div className="min-w-0">
                              <div className="fw-semibold">{entry.title}</div>
                              <div className="small text-secondary text-truncate">{entry.hint}</div>
                            </div>
                          </Stack>
                        </ListGroup.Item>
                      );
                    })}
                  </ListGroup>
                </div>
              ))}
            </Card.Body>
          </Card>
        </Col>

        <Col lg={8} xl={9}>
          <Stack className="settings-content-stack gap-3">
            {current ? (
              <>
                <div>
                  <h2 className="h5 mb-1">{current.title}</h2>
                  <p className="text-secondary mb-0">{current.description}</p>
                </div>
                {current.render()}
              </>
            ) : null}
          </Stack>
        </Col>
      </Row>
    </Stack>
  );
}

export function SettingsPage() {
  return (
    <ProvidersProvider>
      <AiSettingsProvider>
        <MaintenanceProvider>
          <SettingsWorkspace />
        </MaintenanceProvider>
      </AiSettingsProvider>
    </ProvidersProvider>
  );
}
