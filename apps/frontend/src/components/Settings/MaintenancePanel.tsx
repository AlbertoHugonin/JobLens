import { useEffect, useState } from 'react';

import Alert from 'react-bootstrap/Alert';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import Col from 'react-bootstrap/Col';
import Form from 'react-bootstrap/Form';
import Row from 'react-bootstrap/Row';
import Spinner from 'react-bootstrap/Spinner';
import Stack from 'react-bootstrap/Stack';
import Table from 'react-bootstrap/Table';

import { useMaintenance } from '../../contexts/MaintenanceContext';
import { ConfirmActionButton } from '../Utilities/ConfirmActionButton';
import { EmptyState, ErrorState, LoadingState } from '../Utilities/SectionState';

function formatNumber(value: number | null, digits = 0): string {
  if (value === null) {
    return '-';
  }

  return value.toLocaleString('it-IT', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatDate(value: Date): string {
  return value.toLocaleString('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export function MaintenancePanel() {
  const {
    createDebugBundle,
    createJobsReviewsExport,
    deleteAiReviews,
    error,
    lastActivity,
    lastBenchmark,
    lastDeletion,
    loadModelMetrics,
    loadingMetrics,
    metrics,
    mutating,
    notice,
    runBenchmark,
  } = useMaintenance();
  const [benchmarkModelName, setBenchmarkModelName] = useState('');
  const [deleteModelName, setDeleteModelName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    void loadModelMetrics();
  }, [loadModelMetrics]);

  const handleBenchmark = async () => {
    const modelName = benchmarkModelName.trim();
    if (!modelName) {
      setFormError('Nome modello benchmark richiesto');
      return;
    }

    const result = await runBenchmark(modelName);
    if (result) {
      setFormError(null);
    }
  };

  const handleDeleteModelReviews = async () => {
    const modelName = deleteModelName.trim();
    if (!modelName) {
      setFormError('Nome modello da cancellare richiesto');
      return;
    }

    const result = await deleteAiReviews({ modelName });
    if (result) {
      setFormError(null);
    }
  };

  return (
    <Card>
      <Card.Header>
        <Stack direction="horizontal" className="justify-content-between gap-3">
          <span className="fw-semibold">Debug, export e benchmark</span>
          {loadingMetrics ? <Spinner animation="border" size="sm" /> : null}
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

          <section>
            <div className="form-eyebrow mb-2">Export e debug</div>
            <Row className="g-3">
              <Col md={6}>
                <Button
                  className="w-100"
                  disabled={mutating}
                  onClick={() => void createJobsReviewsExport()}
                  variant="outline-primary"
                >
                  Export offerte/review JSONL
                </Button>
              </Col>
              <Col md={6}>
                <Button
                  className="w-100"
                  disabled={mutating}
                  onClick={() => void createDebugBundle()}
                  variant="outline-secondary"
                >
                  Bundle debug
                </Button>
              </Col>
            </Row>
            {lastActivity ? (
              <div className="small text-secondary mt-2 text-break">
                Ultima attivita: <span className="font-mono">{lastActivity.activityType}</span> ·{' '}
                <span className="font-mono">{lastActivity.id}</span>
              </div>
            ) : null}
          </section>

          <section>
            <div className="form-eyebrow mb-2">Benchmark globale</div>
            <Row className="g-3 align-items-end">
              <Col md={8}>
                <Form.Group controlId="maintenance-benchmark-model">
                  <Form.Label>Modello benchmark globale</Form.Label>
                  <Form.Control
                    className="font-mono"
                    onChange={(event) => setBenchmarkModelName(event.target.value)}
                    placeholder="llama3.2"
                    value={benchmarkModelName}
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Button
                  className="w-100"
                  disabled={mutating}
                  onClick={() => void handleBenchmark()}
                  variant="outline-success"
                >
                  Benchmark
                </Button>
              </Col>
            </Row>
            {lastBenchmark ? (
              <div className="small text-secondary mt-2">
                Accodate {lastBenchmark.queued.length} review su {lastBenchmark.totalJobs} offerte
              </div>
            ) : null}
          </section>

          <section>
            <div className="form-eyebrow mb-2">Pulizia review</div>
            <Row className="g-3 align-items-end">
              <Col md={8}>
                <Form.Group controlId="maintenance-delete-model">
                  <Form.Label>Review da cancellare per modello</Form.Label>
                  <Form.Control
                    className="font-mono"
                    onChange={(event) => setDeleteModelName(event.target.value)}
                    placeholder="Nome modello"
                    value={deleteModelName}
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <ConfirmActionButton
                  className="w-100"
                  confirmMessage={
                    <>
                      Le review AI create con il modello <strong>{deleteModelName.trim()}</strong>{' '}
                      verranno eliminate. Attivita e log resteranno disponibili.
                    </>
                  }
                  confirmTitle="Cancellare review del modello?"
                  disabled={mutating || !deleteModelName.trim()}
                  onConfirm={() => void handleDeleteModelReviews()}
                  variant="outline-danger"
                >
                  Cancella modello
                </ConfirmActionButton>
              </Col>
              <Col xs={12}>
                <ConfirmActionButton
                  confirmMessage="Tutte le review AI verranno eliminate. Offerte, attivita e log non saranno eliminati."
                  confirmTitle="Cancellare tutte le review AI?"
                  disabled={mutating}
                  onConfirm={() => void deleteAiReviews({ all: true })}
                  size="sm"
                  variant="outline-danger"
                >
                  Cancella tutte le review AI
                </ConfirmActionButton>
                {lastDeletion ? (
                  <span className="small text-secondary ms-2">
                    Ultima cancellazione: {lastDeletion.deleted}
                  </span>
                ) : null}
              </Col>
            </Row>
          </section>

          <section>
            <Stack direction="horizontal" className="justify-content-between mb-2 gap-3">
              <span className="form-eyebrow">Metriche modello</span>
              <Button
                disabled={loadingMetrics}
                onClick={() => void loadModelMetrics()}
                size="sm"
                variant="outline-secondary"
              >
                Aggiorna
              </Button>
            </Stack>
            {loadingMetrics && metrics.length === 0 ? (
              <LoadingState label="Caricamento metriche" />
            ) : null}
            {!loadingMetrics && metrics.length === 0 ? (
              <EmptyState message="Nessuna review AI disponibile" />
            ) : null}
            {metrics.length > 0 ? (
              <Table responsive size="sm">
                <thead>
                  <tr>
                    <th>Modello</th>
                    <th>Review</th>
                    <th>Successi</th>
                    <th>Errori</th>
                    <th>Score</th>
                    <th>Durata ms</th>
                    <th>Token/s</th>
                    <th>Ultima</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((item) => (
                    <tr key={`${item.endpointId ?? 'none'}-${item.modelName}`}>
                      <td className="text-break">
                        <div className="fw-medium font-mono">{item.modelName}</div>
                        {item.endpointName ? (
                          <Badge bg="light" text="dark">
                            {item.endpointName}
                          </Badge>
                        ) : null}
                      </td>
                      <td className="font-mono">{item.reviewCount}</td>
                      <td className="font-mono">{item.successCount}</td>
                      <td className="font-mono">{item.failedCount}</td>
                      <td className="font-mono">{formatNumber(item.avgScore, 1)}</td>
                      <td className="font-mono">{formatNumber(item.avgDurationMs, 0)}</td>
                      <td className="font-mono">{formatNumber(item.avgTokensPerSecond, 1)}</td>
                      <td className="font-mono">{formatDate(item.lastReviewedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : null}
          </section>
        </Stack>
      </Card.Body>
    </Card>
  );
}
