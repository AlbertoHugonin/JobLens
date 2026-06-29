import { useCallback, useState } from 'react';

import { BriefcaseBusiness, CircleCheckBig, Gauge, Hourglass } from 'lucide-react';
import Button from 'react-bootstrap/Button';
import Col from 'react-bootstrap/Col';
import ListGroup from 'react-bootstrap/ListGroup';
import Row from 'react-bootstrap/Row';
import Stack from 'react-bootstrap/Stack';

import { ServiceHealthPanel } from '../components/Health/ServiceHealthPanel';
import { JobDecisionBadge } from '../components/Jobs/JobStatusBadges';
import { PageHeader } from '../components/Layout/PageHeader';
import { Panel } from '../components/Layout/Panel';
import { ScoreRing } from '../components/Layout/ScoreRing';
import { StatCard } from '../components/Layout/StatCard';
import { AsyncSection } from '../components/Utilities/AsyncSection';
import { fetchJobInsights } from '../API/jobs';
import { useAppStatus } from '../contexts/AppStatusContext';
import { useInitialLoad } from '../hooks/useInitialLoad';
import {
  getJobDecisionVariant,
  type JobDecisionCount,
  type JobInsights,
} from '../models/job';
import { normalizeJobInsights } from '../services/jobService';

const DECISION_META: Record<JobDecisionCount['key'], { label: string; variant: string }> = {
  apply: { label: 'Apply', variant: 'success' },
  maybe: { label: 'Maybe', variant: 'warning' },
  none: { label: 'Da valutare', variant: 'secondary' },
  reject: { label: 'Reject', variant: 'danger' },
};

const DECISION_ORDER: Array<JobDecisionCount['key']> = ['apply', 'maybe', 'reject', 'none'];

function DecisionDistribution({ items }: { items: JobDecisionCount[] }) {
  const total = items.reduce((sum, item) => sum + item.count, 0);

  if (total === 0) {
    return <p className="text-secondary small mb-0">Nessuna review registrata</p>;
  }

  const ordered = DECISION_ORDER.map((key) => items.find((item) => item.key === key)).filter(
    (item): item is JobDecisionCount => Boolean(item && item.count > 0),
  );

  return (
    <Stack className="gap-2">
      <div
        className="d-flex rounded-pill overflow-hidden"
        style={{ background: 'var(--joblens-ring-track)', height: 10 }}
      >
        {ordered.map((item) => (
          <div
            key={item.key}
            style={{
              backgroundColor: `var(--bs-${DECISION_META[item.key].variant})`,
              width: `${(item.count / total) * 100}%`,
            }}
            title={`${DECISION_META[item.key].label}: ${item.count}`}
          />
        ))}
      </div>
      <Stack direction="horizontal" className="flex-wrap gap-3">
        {ordered.map((item) => (
          <span key={item.key} className="d-inline-flex align-items-center gap-2 small">
            <span
              className="d-inline-block rounded-circle"
              style={{
                backgroundColor: `var(--bs-${DECISION_META[item.key].variant})`,
                height: 9,
                width: 9,
              }}
            />
            <span className="text-secondary">{DECISION_META[item.key].label}</span>
            <span className="fw-semibold font-mono">{item.count}</span>
          </span>
        ))}
      </Stack>
    </Stack>
  );
}

function InsightStatCards({ insights }: { insights: JobInsights | null }) {
  return (
    <Row className="g-3">
      <Col sm={6} xl={3}>
        <StatCard
          icon={<BriefcaseBusiness aria-hidden="true" size={20} />}
          label="Offerte attive"
          value={insights?.totalActive ?? '–'}
          variant="primary"
        />
      </Col>
      <Col sm={6} xl={3}>
        <StatCard
          icon={<CircleCheckBig aria-hidden="true" size={20} />}
          label="Valutate"
          value={insights?.reviewed ?? '–'}
          variant="success"
        />
      </Col>
      <Col sm={6} xl={3}>
        <StatCard
          icon={<Hourglass aria-hidden="true" size={20} />}
          label="Da valutare"
          value={insights?.unreviewed ?? '–'}
          variant="warning"
        />
      </Col>
      <Col sm={6} xl={3}>
        <StatCard
          hint="Media review"
          icon={<Gauge aria-hidden="true" size={20} />}
          label="Score medio"
          value={insights?.averageScore ?? '–'}
          variant="info"
        />
      </Col>
    </Row>
  );
}

function AiPriorityPanel({
  error,
  insights,
  loading,
  onRefresh,
}: {
  error: string | null;
  insights: JobInsights | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <Panel
      title="Priorita AI"
      actions={
        <Button disabled={loading} onClick={onRefresh} size="sm" variant="outline-secondary">
          Aggiorna
        </Button>
      }
    >
      <AsyncSection
        error={error}
        loading={loading && !insights}
        loadingLabel="Caricamento priorita"
      >
        {insights ? (
          <Stack className="gap-3">
            <DecisionDistribution items={insights.byDecision} />
            {insights.topMatches.length === 0 ? (
              <p className="text-secondary mb-0">Nessuna offerta in evidenza al momento.</p>
            ) : (
              <ListGroup variant="flush">
                {insights.topMatches.map((job) => (
                  <ListGroup.Item key={job.id} className="px-0">
                    <Stack direction="horizontal" className="justify-content-between gap-3">
                      <div className="min-w-0">
                        <div className="fw-medium text-truncate">{job.title}</div>
                        <div className="small text-secondary text-truncate">{job.companyName}</div>
                      </div>
                      <Stack direction="horizontal" className="align-items-center gap-2">
                        {job.latestReview?.decision ? (
                          <JobDecisionBadge decision={job.latestReview.decision} />
                        ) : null}
                        <ScoreRing
                          score={job.latestReview?.score ?? null}
                          size={40}
                          variant={
                            job.latestReview?.decision
                              ? getJobDecisionVariant(job.latestReview.decision)
                              : 'secondary'
                          }
                        />
                      </Stack>
                    </Stack>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            )}
          </Stack>
        ) : null}
      </AsyncSection>
    </Panel>
  );
}

export function DashboardPage() {
  const { apiHealth, error, loadApiHealth, loading } = useAppStatus();
  const [insights, setInsights] = useState<JobInsights | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);

  const loadInsights = useCallback(async () => {
    setLoadingInsights(true);
    try {
      const response = await fetchJobInsights(5);
      setInsights(normalizeJobInsights(response.data));
      setInsightsError(null);
    } catch (caught: unknown) {
      setInsightsError(caught instanceof Error ? caught.message : 'Unexpected error');
    } finally {
      setLoadingInsights(false);
    }
  }, []);

  useInitialLoad(async () => {
    await Promise.all([loadApiHealth(), loadInsights()]);
  });

  const refreshApiHealth = useCallback(() => {
    void loadApiHealth(true);
  }, [loadApiHealth]);

  return (
    <Stack className="app-page gap-4">
      <PageHeader description="Stato servizi e attivita recenti" title="Dashboard" />

      <InsightStatCards insights={insights} />

      <Row className="app-page-fill g-3">
        <Col className="detail-scroll-pane" lg={5} xl={4}>
          <ServiceHealthPanel
            error={error}
            health={apiHealth}
            loading={loading}
            onRefresh={refreshApiHealth}
          />
        </Col>
        <Col className="detail-scroll-pane" lg={7} xl={8}>
          <AiPriorityPanel
            error={insightsError}
            insights={insights}
            loading={loadingInsights}
            onRefresh={() => void loadInsights()}
          />
        </Col>
      </Row>
    </Stack>
  );
}
