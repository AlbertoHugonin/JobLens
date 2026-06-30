import { useCallback, useEffect, useMemo, useState } from 'react';

import Card from 'react-bootstrap/Card';
import Col from 'react-bootstrap/Col';
import Row from 'react-bootstrap/Row';
import Stack from 'react-bootstrap/Stack';

import { SearchList } from '../components/Searches/SearchList';
import { SearchRunPanel } from '../components/Searches/SearchRunPanel';
import { SearchSummaryCard } from '../components/Searches/SearchSummaryCard';
import { SearchWizardDrawer } from '../components/Searches/SearchWizardDrawer';
import { EmptyState } from '../components/Utilities/SectionState';
import { ProvidersProvider, useProviders } from '../contexts/ProvidersContext';
import { SearchesProvider, useSearches } from '../contexts/SearchesContext';
import { useActivityEvents } from '../hooks/useActivityEvents';
import { useInitialLoad } from '../hooks/useInitialLoad';
import type { Search } from '../models/search';

function SearchesWorkspace() {
  const {
    deleteSearch,
    error,
    loadRuns,
    loadSearches,
    loading,
    runSearch,
    runAllSearches,
    runningAll,
    runNotice,
    runs,
    searches,
    selectedId,
    selectSearch,
    total,
  } = useSearches();
  const { loadSessions, sessions } = useProviders();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingSearch, setEditingSearch] = useState<Search | null>(null);

  // A provider can only be used (and a search can only run) when there is at
  // least one active LinkedIn session, otherwise every collection would fail.
  const hasActiveSession = useMemo(
    () => sessions.some((session) => session.status === 'active'),
    [sessions],
  );

  const initialLoad = useCallback(async () => {
    await Promise.all([loadSearches(true), loadSessions(true)]);
  }, [loadSearches, loadSessions]);
  const selectedSearch = useMemo(
    () => searches.find((search) => search.id === selectedId),
    [searches, selectedId],
  );
  const refreshRuns = useCallback(async () => {
    if (selectedId) {
      await loadRuns(selectedId, true);
      await loadSearches(true);
    }
  }, [loadRuns, loadSearches, selectedId]);

  useInitialLoad(initialLoad);
  useEffect(() => {
    if (selectedId) {
      void refreshRuns();
    }
  }, [refreshRuns, selectedId]);
  useActivityEvents(refreshRuns, Boolean(selectedId));

  // Always keep a search open: fall back to the first item when nothing valid is selected.
  useEffect(() => {
    const first = searches[0];
    if (!first) {
      return;
    }
    if (!selectedId || !searches.some((search) => search.id === selectedId)) {
      void selectSearch(first.id);
    }
  }, [searches, selectedId, selectSearch]);

  const openNew = () => {
    setEditingSearch(null);
    setDrawerOpen(true);
  };
  const openEdit = (search: Search) => {
    setEditingSearch(search);
    setDrawerOpen(true);
  };

  return (
    <Stack className="app-page gap-4">
      <Row className="app-page-fill g-3">
        <Col className="app-page-pane" lg={5} xl={4}>
          <SearchList
            error={error}
            loading={loading}
            onCreate={openNew}
            onDelete={(id) => void deleteSearch(id)}
            onSelect={selectSearch}
            searches={searches}
            selectedId={selectedId}
            total={total}
          />
        </Col>
        <Col className="detail-scroll-pane" lg={7} xl={8}>
          {selectedSearch ? (
            <div className="search-detail-stack d-grid gap-3">
              <SearchSummaryCard onEdit={() => openEdit(selectedSearch)} search={selectedSearch} />
              <SearchRunPanel
                canRunAll={hasActiveSession && searches.some((search) => search.enabled)}
                hasActiveSession={hasActiveSession}
                notice={runNotice}
                onRunAll={() => void runAllSearches()}
                onRun={(id) => void runSearch(id)}
                runningAll={runningAll}
                running={false}
                runs={runs}
                search={selectedSearch}
              />
            </div>
          ) : (
            <Card>
              <Card.Body>
                <EmptyState message="Seleziona una ricerca dalla lista oppure creane una nuova." />
              </Card.Body>
            </Card>
          )}
        </Col>
      </Row>

      <SearchWizardDrawer
        hasActiveSession={hasActiveSession}
        onHide={() => setDrawerOpen(false)}
        search={editingSearch}
        show={drawerOpen}
      />
    </Stack>
  );
}

export function SearchesPage() {
  return (
    <ProvidersProvider>
      <SearchesProvider>
        <SearchesWorkspace />
      </SearchesProvider>
    </ProvidersProvider>
  );
}
