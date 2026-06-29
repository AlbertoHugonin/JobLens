import { useCallback, useEffect } from 'react';

import Alert from 'react-bootstrap/Alert';
import Col from 'react-bootstrap/Col';
import Row from 'react-bootstrap/Row';
import Stack from 'react-bootstrap/Stack';

import { JobDetail } from '../components/Jobs/JobDetail';
import { JobFilterBar } from '../components/Jobs/JobFilterBar';
import { JobList } from '../components/Jobs/JobList';
import { PageHeader } from '../components/Layout/PageHeader';
import { JobsProvider, useJobs } from '../contexts/JobsContext';
import { useInitialLoad } from '../hooks/useInitialLoad';

function JobsWorkspace() {
  const {
    batchReviewing,
    error,
    exportJobJson,
    filters,
    jobs,
    limit,
    loadJobs,
    loadSearchOptions,
    loadingDetail,
    loadingJobs,
    mutatingId,
    offset,
    requestBatchReviews,
    requestReview,
    reviewNotice,
    reviews,
    reviewsError,
    reviewingJobId,
    loadingReviews,
    searchOptions,
    selectJob,
    selectedId,
    selectedJob,
    setFilters,
    setPageOffset,
    total,
    updateLocalStatus,
  } = useJobs();

  const initialLoad = useCallback(async () => {
    await loadSearchOptions();
  }, [loadSearchOptions]);

  useInitialLoad(initialLoad);

  useEffect(() => {
    void loadJobs({ force: true });
  }, [filters, loadJobs, offset]);

  // Always keep an offer open: when the list changes (incl. filter changes) and the
  // current selection is gone, fall back to the first item so the detail is never empty.
  useEffect(() => {
    const first = jobs[0];
    if (!first) {
      return;
    }
    if (!selectedId || !jobs.some((job) => job.id === selectedId)) {
      void selectJob(first.id);
    }
  }, [jobs, selectedId, selectJob]);

  return (
    <Stack className="app-page gap-4">
      <PageHeader description="Lista paginata, filtri e dettaglio offerta" title="Offerte" />
      <JobFilterBar
        batchReviewDisabled={jobs.length === 0}
        batchReviewing={batchReviewing}
        filters={filters}
        loading={loadingJobs}
        onBatchReview={() => void requestBatchReviews()}
        onChange={setFilters}
        onRefresh={() => void loadJobs({ force: true })}
        searches={searchOptions}
        total={total}
      />
      {reviewNotice ? (
        <Alert className="mb-0 py-2" variant="success">
          {reviewNotice}
        </Alert>
      ) : null}
      <Row className="app-page-fill g-3">
        <Col className="app-page-pane" lg={4} xl={3}>
          <JobList
            error={error}
            jobs={jobs}
            limit={limit}
            loading={loadingJobs}
            offset={offset}
            onPageChange={setPageOffset}
            onSelect={(id) => void selectJob(id)}
            selectedId={selectedId}
            total={total}
          />
        </Col>
        <Col className="app-page-pane" lg={8} xl={9}>
          <JobDetail
            job={selectedJob}
            loading={loadingDetail}
            loadingReviews={loadingReviews}
            mutating={mutatingId === selectedJob?.id}
            onExport={exportJobJson}
            onRequestReview={(id) => void requestReview(id)}
            onUpdateStatus={(id, status) => void updateLocalStatus(id, status)}
            reviews={reviews}
            reviewsError={reviewsError}
            reviewing={reviewingJobId === selectedJob?.id}
          />
        </Col>
      </Row>
    </Stack>
  );
}

export function JobsPage() {
  return (
    <JobsProvider>
      <JobsWorkspace />
    </JobsProvider>
  );
}
