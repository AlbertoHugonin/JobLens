import { useMemo, useState, type ReactNode } from 'react';

import { ChevronDown, Clock, ExternalLink, Layers, Search, Sparkles } from 'lucide-react';
import Accordion from 'react-bootstrap/Accordion';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import Col from 'react-bootstrap/Col';
import Collapse from 'react-bootstrap/Collapse';
import Form from 'react-bootstrap/Form';
import ListGroup from 'react-bootstrap/ListGroup';
import Row from 'react-bootstrap/Row';
import Stack from 'react-bootstrap/Stack';

import { useDebugMode } from '../../contexts/DebugModeContext';
import {
  jobLocalStatusOptions,
  getJobDecisionVariant,
  getJobReviewPriorityLabel,
  type JobDetail as JobDetailModel,
  type JobDescription,
  type JobExport,
  type JobLocalStatus,
  type JobReviewDetail as JobReviewDetailModel,
} from '../../models/job';
import { ScoreRing } from '../Layout/ScoreRing';
import { EmptyState, ErrorState, LoadingState } from '../Utilities/SectionState';
import { AiReviewResultPanel } from './AiReviewResultPanel';
import { JobAvailabilityBadge, JobDecisionBadge } from './JobStatusBadges';

function formatDate(value: Date | null): string {
  if (!value) {
    return '-';
  }

  return value.toLocaleString('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function SectionHeading({
  icon,
  title,
  trailing,
}: {
  icon: ReactNode;
  title: string;
  trailing?: ReactNode;
}) {
  return (
    <Stack direction="horizontal" className="align-items-center gap-2 mb-3">
      <span className="text-secondary d-inline-flex">{icon}</span>
      <h2 className="h6 mb-0">{title}</h2>
      {trailing ? <span className="ms-auto">{trailing}</span> : null}
    </Stack>
  );
}

function MetadataItem({ label, value }: { label: string; value: string | number }) {
  return (
    <Col sm={6} xl={4}>
      <div className="small text-secondary">{label}</div>
      <div className="fw-medium text-break">{value}</div>
    </Col>
  );
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function shortHash(value: string): string {
  return value ? value.slice(0, 10) : '-';
}

function downloadJson(job: JobDetailModel, exported: JobExport): void {
  const blob = new Blob([JSON.stringify(exported, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `joblens-job-${job.id}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

const DESCRIPTION_ROOT_SELECTORS = [
  '.show-more-less-html__markup',
  '.jobs-description__content',
  '.jobs-description-content__text',
  '.jobs-box__html-content',
  '.description__text',
  '.description',
];

const DESCRIPTION_EXCLUDED_SELECTORS = ['.description__job-criteria-list'];

const ALLOWED_DESCRIPTION_TAGS = new Set([
  'a',
  'b',
  'blockquote',
  'br',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'li',
  'ol',
  'p',
  'section',
  'span',
  'strong',
  'u',
  'ul',
]);

const BLOCKED_DESCRIPTION_TAGS = new Set([
  'canvas',
  'embed',
  'form',
  'iframe',
  'math',
  'noscript',
  'object',
  'script',
  'style',
  'svg',
  'template',
]);

const DESCRIPTION_TRIM_BLOCK_SELECTOR = 'blockquote, div, li, ol, p, section, ul';

interface LinkedInDescriptionCriteria {
  employmentType: string | null;
  industries: string | null;
  jobFunction: string | null;
  seniority: string | null;
}

function isAllowedLink(href: string): boolean {
  try {
    const url = new URL(href, window.location.origin);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function normalizeCriteriaLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '');
}

function readCriteriaValue(item: Element): string | null {
  const explicit = item.querySelector('.description__job-criteria-text')?.textContent?.trim();
  if (explicit) {
    return explicit;
  }

  const clone = item.cloneNode(true) as Element;
  clone.querySelector('h1, h2, h3, h4')?.remove();
  const text = clone.textContent?.replace(/\s+/g, ' ').trim();
  return text || null;
}

function extractDescriptionCriteria(html: string | null): LinkedInDescriptionCriteria | null {
  if (!html || typeof DOMParser === 'undefined') {
    return null;
  }

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const criteria: LinkedInDescriptionCriteria = {
    employmentType: null,
    industries: null,
    jobFunction: null,
    seniority: null,
  };

  for (const item of Array.from(parsed.body.querySelectorAll('.description__job-criteria-item'))) {
    const label = normalizeCriteriaLabel(
      item.querySelector('h1, h2, h3, h4')?.textContent?.trim() ?? '',
    );
    const value = readCriteriaValue(item);
    if (!label || !value) {
      continue;
    }

    if (label === 'senioritylevel') {
      criteria.seniority = value;
    } else if (label === 'employmenttype') {
      criteria.employmentType = value;
    } else if (label === 'jobfunction') {
      criteria.jobFunction = value;
    } else if (label === 'industries') {
      criteria.industries = value;
    }
  }

  return Object.values(criteria).some(Boolean) ? criteria : null;
}

function findPlainCriteriaLabelPositions(text: string): Array<{
  index: number;
  key: keyof LinkedInDescriptionCriteria;
  label: string;
}> {
  const labels: Array<{ key: keyof LinkedInDescriptionCriteria; label: string }> = [
    { key: 'seniority', label: 'Seniority level' },
    { key: 'employmentType', label: 'Employment type' },
    { key: 'jobFunction', label: 'Job function' },
    { key: 'industries', label: 'Industries' },
  ];
  const normalized = text.toLowerCase();

  return labels
    .map((item) => ({
      ...item,
      index: normalized.indexOf(item.label.toLowerCase()),
    }))
    .filter((item) => item.index >= 0)
    .sort((left, right) => left.index - right.index);
}

function extractPlainDescriptionCriteria(text: string | null): LinkedInDescriptionCriteria | null {
  if (!text) {
    return null;
  }

  const positions = findPlainCriteriaLabelPositions(text);
  if (positions.length < 2 || positions[0]?.key !== 'seniority') {
    return null;
  }

  const criteria: LinkedInDescriptionCriteria = {
    employmentType: null,
    industries: null,
    jobFunction: null,
    seniority: null,
  };

  positions.forEach((item, index) => {
    const valueStart = item.index + item.label.length;
    const valueEnd = positions[index + 1]?.index ?? text.length;
    const value = text.slice(valueStart, valueEnd).replace(/\s+/g, ' ').trim();
    if (value) {
      criteria[item.key] = value;
    }
  });

  return Object.values(criteria).some(Boolean) ? criteria : null;
}

function stripPlainDescriptionCriteria(text: string): string {
  const positions = findPlainCriteriaLabelPositions(text);
  if (positions.length < 2 || positions[0]?.key !== 'seniority') {
    return text;
  }

  return text.slice(0, positions[0].index).trim() || text;
}

function getDescriptionRoots(parsed: Document): Element[] {
  const roots: Element[] = [];

  for (const selector of DESCRIPTION_ROOT_SELECTORS) {
    for (const element of Array.from(parsed.body.querySelectorAll(selector))) {
      const overlapsExistingRoot = roots.some(
        (root) => root === element || root.contains(element) || element.contains(root),
      );
      if (!overlapsExistingRoot && (element.textContent?.trim().length ?? 0) > 0) {
        roots.push(element);
      }
    }
  }

  return roots.length > 0 ? roots : [parsed.body];
}

function isWhitespaceTextNode(node: Node): boolean {
  return node.nodeType === Node.TEXT_NODE && !(node.textContent ?? '').trim();
}

function isBreakElement(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName.toLowerCase() === 'br';
}

function findPreviousNonWhitespaceSibling(node: Node): Node | null {
  let previous = node.previousSibling;
  while (previous && isWhitespaceTextNode(previous)) {
    previous = previous.previousSibling;
  }

  return previous;
}

function trimBlockEdgeBreaks(root: Element): void {
  for (const element of Array.from(root.querySelectorAll(DESCRIPTION_TRIM_BLOCK_SELECTOR))) {
    while (element.firstChild && (isWhitespaceTextNode(element.firstChild) || isBreakElement(element.firstChild))) {
      element.firstChild.remove();
    }

    while (element.lastChild && (isWhitespaceTextNode(element.lastChild) || isBreakElement(element.lastChild))) {
      element.lastChild.remove();
    }
  }
}

function collapseRepeatedBreaks(root: Element): void {
  for (const br of Array.from(root.querySelectorAll('br'))) {
    const previous = findPreviousNonWhitespaceSibling(br);
    if (previous && isBreakElement(previous)) {
      br.remove();
    }
  }
}

function removeEmptyDescriptionBlocks(root: Element): void {
  const blocks = Array.from(
    root.querySelectorAll('blockquote, div, li, p, section'),
  ).reverse();

  for (const element of blocks) {
    if (!element.textContent?.trim() && element.children.length === 0) {
      element.remove();
    }
  }
}

function normalizeDescriptionSpacing(root: Element): void {
  collapseRepeatedBreaks(root);
  trimBlockEdgeBreaks(root);
  removeEmptyDescriptionBlocks(root);
}

function appendSanitizedDescriptionNode(source: Node, target: Node): void {
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(document.createTextNode(child.textContent ?? ''));
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) {
      continue;
    }

    const element = child as Element;
    const tagName = element.tagName.toLowerCase();

    if (BLOCKED_DESCRIPTION_TAGS.has(tagName)) {
      continue;
    }

    if (!ALLOWED_DESCRIPTION_TAGS.has(tagName)) {
      appendSanitizedDescriptionNode(element, target);
      continue;
    }

    const sanitized = document.createElement(tagName);

    if (tagName === 'a') {
      const href = element.getAttribute('href')?.trim();
      if (href && isAllowedLink(href)) {
        sanitized.setAttribute('href', href);
        sanitized.setAttribute('rel', 'noreferrer');
        sanitized.setAttribute('target', '_blank');
      }
    }

    appendSanitizedDescriptionNode(element, sanitized);
    target.appendChild(sanitized);
  }
}

function sanitizeDescriptionHtml(html: string): string | null {
  if (
    typeof DOMParser === 'undefined' ||
    typeof document === 'undefined' ||
    typeof window === 'undefined'
  ) {
    return null;
  }

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  for (const selector of DESCRIPTION_EXCLUDED_SELECTORS) {
    for (const element of Array.from(parsed.body.querySelectorAll(selector))) {
      element.remove();
    }
  }

  const container = document.createElement('div');

  for (const root of getDescriptionRoots(parsed)) {
    const section = document.createElement('section');
    appendSanitizedDescriptionNode(root, section);
    if (section.textContent?.trim()) {
      container.appendChild(section);
    }
  }

  normalizeDescriptionSpacing(container);

  const sanitized = container.innerHTML.trim();
  return sanitized || null;
}

function JobDescriptionContent({ description }: { description: JobDescription }) {
  const sanitizedHtml = useMemo(
    () => (description.html ? sanitizeDescriptionHtml(description.html) : null),
    [description.html],
  );

  if (sanitizedHtml) {
    return (
      <div
        className="job-description job-description-rich text-break"
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      />
    );
  }

  return (
    <div className="job-description job-description-plain text-break">
      {stripPlainDescriptionCriteria(description.text)}
    </div>
  );
}

function ReviewTechnicalDetails({ review }: { review: JobReviewDetailModel }) {
  return (
    <details className="mt-3">
      <summary className="small text-secondary">Dettagli tecnici e JSON</summary>
      <Stack className="gap-3 mt-3">
        <Row className="g-3">
          <MetadataItem label="Stato" value={review.status} />
          <MetadataItem label="Endpoint" value={review.endpointName ?? '-'} />
          <MetadataItem label="Profilo" value={shortHash(review.profileHash)} />
          <MetadataItem label="Regole" value={shortHash(review.rulesHash)} />
        </Row>
        <div>
          <div className="small text-secondary mb-1">Risultato normalizzato</div>
          <pre className="debug-snippet mb-0">{formatJson(review.result)}</pre>
        </div>
        {review.rawOutput ? (
          <div>
            <div className="small text-secondary mb-1">Raw output</div>
            <pre className="debug-snippet mb-0">{review.rawOutput}</pre>
          </div>
        ) : null}
        <div>
          <div className="small text-secondary mb-1">Metriche</div>
          <pre className="debug-snippet mb-0">{formatJson(review.metrics)}</pre>
        </div>
      </Stack>
    </details>
  );
}

export function JobDetail({
  job,
  loading,
  loadingReviews,
  mutating,
  onExport,
  onRequestReview,
  onUpdateStatus,
  reviews,
  reviewsError,
  reviewing,
}: {
  job: JobDetailModel | null;
  loading: boolean;
  loadingReviews: boolean;
  mutating: boolean;
  onExport: (id: string) => Promise<JobExport | null>;
  onRequestReview: (id: string) => void;
  onUpdateStatus: (id: string, localStatus: JobLocalStatus) => void;
  reviews: JobReviewDetailModel[];
  reviewsError: string | null;
  reviewing: boolean;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const { debugMode } = useDebugMode();

  if (!job) {
    return (
      <Card className="scroll-card h-100">
        <Card.Body>
          <EmptyState message="Seleziona un'offerta" />
        </Card.Body>
      </Card>
    );
  }

  const providerLink = job.providerUrl ?? job.sourceUrl;
  const mainReview =
    reviews.find((review) => review.id === job.latestReview?.id) ??
    reviews.find((review) => review.isPriority) ??
    reviews[0] ??
    null;
  const descriptionCriteria =
    extractDescriptionCriteria(job.description?.html ?? null) ??
    extractPlainDescriptionCriteria(job.description?.text ?? null);
  const employmentType = job.employmentType ?? descriptionCriteria?.employmentType ?? '-';
  const seniority = job.seniority ?? descriptionCriteria?.seniority ?? '-';

  return (
    <Card className="job-detail-card scroll-card h-100">
      <Card.Header>
        <Stack
          direction="horizontal"
          className="job-detail-header flex-wrap justify-content-between align-items-start gap-3"
        >
          <div className="job-detail-heading min-w-0">
            <div className="job-detail-title h5 mb-1">
              <span className="job-detail-title-text">{job.title}</span>
              <span className="job-detail-title-badge">
                <JobAvailabilityBadge status={job.availabilityStatus} />
              </span>
            </div>
            <div className="text-secondary">{job.companyName}</div>
          </div>
          <Stack
            direction="horizontal"
            className="job-detail-actions flex-wrap justify-content-end align-items-center gap-2 ms-auto"
          >
            <Stack direction="horizontal" className="flex-wrap align-items-center gap-2">
              <Form.Select
                aria-label="Stato locale"
                className="w-auto"
                disabled={mutating}
                onChange={(event) =>
                  onUpdateStatus(job.id, event.target.value as JobLocalStatus)
                }
                size="sm"
                value={job.localStatus}
              >
                {jobLocalStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Form.Select>
            </Stack>
            <span aria-hidden="true" className="job-detail-action-separator" />
            <Stack direction="horizontal" className="flex-wrap justify-content-end gap-2">
              {providerLink ? (
                <Button
                  as="a"
                  className="d-inline-flex align-items-center gap-2"
                  href={providerLink}
                  rel="noreferrer"
                  size="sm"
                  target="_blank"
                  variant="outline-primary"
                >
                  <ExternalLink aria-hidden="true" size={15} />
                  Apri sul portale
                </Button>
              ) : null}
              {debugMode ? (
                <Button
                  disabled={loading}
                  onClick={() => {
                    void onExport(job.id).then((exported) => {
                      if (exported) {
                        downloadJson(job, exported);
                      }
                    });
                  }}
                  size="sm"
                  variant="outline-secondary"
                >
                  Export JSON
                </Button>
              ) : null}
              <Button
                className="d-inline-flex align-items-center gap-2"
                disabled={loading || reviewing}
                onClick={() => onRequestReview(job.id)}
                size="sm"
                variant="outline-success"
              >
                <Sparkles aria-hidden="true" size={15} />
                {reviewing ? 'Review in coda...' : 'Valuta con AI'}
              </Button>
            </Stack>
          </Stack>
        </Stack>
      </Card.Header>
      <Card.Body>
        <Stack className="gap-4">
          {loading ? <LoadingState label="Aggiornamento offerta" /> : null}

          <section>
            <SectionHeading icon={<Sparkles size={16} />} title="Valutazione AI" />
            {job.latestReview ? (
              loadingReviews && !mainReview ? (
                <LoadingState label="Caricamento valutazione" />
              ) : mainReview ? (
                <AiReviewResultPanel review={mainReview} />
              ) : reviewsError ? (
                <ErrorState message={reviewsError} />
              ) : (
                <Stack direction="horizontal" className="align-items-center flex-wrap gap-3">
                  <ScoreRing
                    score={job.latestReview.score}
                    size={84}
                    variant={
                      job.latestReview.decision
                        ? getJobDecisionVariant(job.latestReview.decision)
                        : 'secondary'
                    }
                  />
                  <div>
                    {job.latestReview.decision ? (
                      <JobDecisionBadge decision={job.latestReview.decision} />
                    ) : null}
                    <div className="small text-secondary mt-1">{job.latestReview.modelName}</div>
                  </div>
                </Stack>
              )
            ) : (
              <div className="text-secondary d-inline-flex align-items-center gap-2">
                <Sparkles aria-hidden="true" size={15} />
                <span>
                  Non ancora valutata. Usa <span className="fw-semibold">Valuta con AI</span> qui
                  sopra.
                </span>
              </div>
            )}
          </section>

          <section>
            <SectionHeading icon={<Layers size={16} />} title="Dettagli offerta" />
            <Row className="g-3">
              <MetadataItem label="Localita" value={job.locationText ?? '-'} />
              <MetadataItem label="Pubblicazione" value={formatDate(job.publishedAt)} />
              <MetadataItem label="Ripubblicazione" value={formatDate(job.repostedAt)} />
              <MetadataItem label="Modalita" value={job.workplaceType ?? '-'} />
              <MetadataItem label="Contratto" value={employmentType} />
              <MetadataItem label="Seniority" value={seniority} />
              {descriptionCriteria?.jobFunction ? (
                <MetadataItem label="Funzione" value={descriptionCriteria.jobFunction} />
              ) : null}
              {descriptionCriteria?.industries ? (
                <MetadataItem label="Settore" value={descriptionCriteria.industries} />
              ) : null}
            </Row>
          </section>

          <section>
            <button
              aria-expanded={historyOpen}
              className="btn btn-link text-reset text-decoration-none p-0 w-100 d-flex align-items-center gap-2 mb-3"
              disabled={reviews.length === 0}
              onClick={() => setHistoryOpen((open) => !open)}
              type="button"
            >
              <span className="text-secondary d-inline-flex">
                <Clock size={16} />
              </span>
              <span className="h6 mb-0">Cronologia valutazioni</span>
              <Badge bg="secondary" className="font-mono ms-1">
                {reviews.length}
              </Badge>
              {reviews.length > 0 ? (
                <ChevronDown
                  className="ms-auto"
                  size={16}
                  style={{
                    transition: 'transform .15s ease',
                    transform: historyOpen ? 'rotate(180deg)' : 'none',
                  }}
                />
              ) : null}
            </button>
            <Collapse in={historyOpen}>
              <div>
                {loadingReviews ? <LoadingState label="Caricamento review" /> : null}
                {reviewsError ? <ErrorState message={reviewsError} /> : null}
                {reviews.length > 0 ? (
                  <Accordion>
                {reviews.map((review, index) => (
                  <Accordion.Item key={review.id} eventKey={review.id}>
                    <Accordion.Header>
                      <Stack direction="horizontal" className="w-100 flex-wrap align-items-center gap-2">
                        <span className="fw-semibold font-mono">#{reviews.length - index}</span>
                        {review.decision ? (
                          <JobDecisionBadge decision={review.decision} />
                        ) : (
                          <Badge bg="danger">Errore</Badge>
                        )}
                        {review.isPriority ? (
                          <Badge bg="primary-subtle" text="dark">
                            {getJobReviewPriorityLabel(review.priorityReason)}
                          </Badge>
                        ) : null}
                        <span className="small text-secondary ms-auto">
                          {review.modelName} · {formatDate(review.createdAt)}
                        </span>
                      </Stack>
                    </Accordion.Header>
                    <Accordion.Body>
                      <AiReviewResultPanel review={review} />
                      {debugMode ? <ReviewTechnicalDetails review={review} /> : null}
                    </Accordion.Body>
                  </Accordion.Item>
                ))}
              </Accordion>
                ) : null}
              </div>
            </Collapse>
          </section>

          <section>
            <SectionHeading icon={<Search size={16} />} title="Descrizione" />
            {job.description ? (
              <JobDescriptionContent description={job.description} />
            ) : (
              <EmptyState message="Descrizione non ancora disponibile" />
            )}
          </section>

          <section>
            <SectionHeading icon={<Search size={16} />} title="Presente nelle ricerche" />
            {job.searches.length === 0 ? (
              <EmptyState message="Offerta non presente in ricerche salvate" />
            ) : (
              <ListGroup variant="flush">
                {job.searches.map((search) => (
                  <ListGroup.Item key={search.searchId} className="px-0">
                    <Stack direction="horizontal" className="justify-content-between gap-3">
                      <span className="fw-medium text-truncate">{search.searchName}</span>
                      <span className="small text-secondary">
                        Vista {formatDate(search.lastSeenAt)}
                      </span>
                    </Stack>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            )}
          </section>

          <section>
            <SectionHeading icon={<ExternalLink size={16} />} title="Sorgenti provider" />
            <ListGroup variant="flush">
              {job.externalJobs.map((externalJob) => (
                <ListGroup.Item key={externalJob.id} className="px-0">
                  <Stack className="gap-1">
                    <div className="fw-medium">{externalJob.providerName}</div>
                    <div className="small text-break font-mono">{externalJob.externalId}</div>
                    <div className="small text-secondary">
                      Prima vista {formatDate(externalJob.firstSeenAt)} · ultima vista{' '}
                      {formatDate(externalJob.lastSeenAt)}
                    </div>
                  </Stack>
                </ListGroup.Item>
              ))}
            </ListGroup>
          </section>
        </Stack>
      </Card.Body>
    </Card>
  );
}
