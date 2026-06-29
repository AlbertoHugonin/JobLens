import { useCallback, useEffect, useState } from 'react';

import Alert from 'react-bootstrap/Alert';
import Col from 'react-bootstrap/Col';
import Row from 'react-bootstrap/Row';
import Stack from 'react-bootstrap/Stack';

import { ActivityDetail } from '../components/Activities/ActivityDetail';
import { ActivityList } from '../components/Activities/ActivityList';
import { LiveQueueBanner } from '../components/Activities/LiveQueueBanner';
import { ActivitiesProvider, useActivities } from '../contexts/ActivitiesContext';
import { useActivityEvents } from '../hooks/useActivityEvents';
import { useInitialLoad } from '../hooks/useInitialLoad';

function ActivitiesWorkspace() {
  const {
    activities,
    cancelActivity,
    cancelQueue,
    cancellingQueue,
    createDummyActivity,
    creating,
    error,
    filters,
    limit,
    loadActivities,
    loadSummary,
    loadingActivities,
    loadingLinkedInDebug,
    loadingLogs,
    loadingSelected,
    logs,
    linkedinDebug,
    linkedinDebugError,
    logsError,
    mutatingId,
    offset,
    queueNotice,
    refreshLive,
    retryActivity,
    selectedActivity,
    selectedId,
    selectActivity,
    setFilters,
    setPageOffset,
    summary,
    total,
  } = useActivities();
  const liveMode = useActivityEvents(refreshLive);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const initialLoad = useCallback(() => loadSummary(), [loadSummary]);

  useInitialLoad(initialLoad);
  useEffect(() => {
    void loadActivities({ force: true, offset: 0 });
  }, [filters.status, filters.type]);
  useEffect(() => {
    if (summary) {
      setSyncedAt(new Date());
    }
  }, [summary]);

  // Always keep an activity open: fall back to the first item when nothing valid is selected.
  useEffect(() => {
    const first = activities[0];
    if (!first) {
      return;
    }
    if (!selectedId || !activities.some((activity) => activity.id === selectedId)) {
      void selectActivity(first.id);
    }
  }, [activities, selectedId, selectActivity]);

  return (
    <Stack className="app-page gap-4">
      <LiveQueueBanner
        cancellingQueue={cancellingQueue}
        creating={creating}
        filters={filters}
        lastUpdatedAt={syncedAt}
        liveMode={liveMode}
        loading={loadingActivities}
        onCancelQueue={() => void cancelQueue()}
        onChange={setFilters}
        onCreateDummy={() => void createDummyActivity()}
        onRefresh={() => void Promise.all([loadActivities({ force: true }), loadSummary()])}
        summary={summary}
      />

      {queueNotice ? (
        <Alert className="mb-0" variant="success">
          {queueNotice}
        </Alert>
      ) : null}

      <Row className="app-page-fill g-3">
        <Col className="app-page-pane" lg={5} xl={4}>
          <ActivityList
            activities={activities}
            error={error}
            limit={limit}
            loading={loadingActivities}
            offset={offset}
            onPageChange={(nextOffset) => void setPageOffset(nextOffset)}
            onSelect={selectActivity}
            selectedId={selectedId}
            total={total}
          />
        </Col>
        <Col className="detail-scroll-pane" lg={7} xl={8}>
          <ActivityDetail
            activity={selectedActivity}
            linkedinDebug={linkedinDebug}
            linkedinDebugError={linkedinDebugError}
            loading={loadingSelected}
            loadingLinkedInDebug={loadingLinkedInDebug}
            loadingLogs={loadingLogs}
            logs={logs}
            logsError={logsError}
            mutating={mutatingId === selectedActivity?.id}
            onCancel={(id) => void cancelActivity(id)}
            onRetry={(id) => void retryActivity(id)}
          />
        </Col>
      </Row>
    </Stack>
  );
}

export function ActivitiesPage() {
  return (
    <ActivitiesProvider>
      <ActivitiesWorkspace />
    </ActivitiesProvider>
  );
}
