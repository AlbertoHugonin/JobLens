import type { ReactNode } from 'react';

import { Ban, CheckCircle2, CirclePlus, Info, TriangleAlert } from 'lucide-react';
import Badge from 'react-bootstrap/Badge';
import Col from 'react-bootstrap/Col';
import Row from 'react-bootstrap/Row';
import Stack from 'react-bootstrap/Stack';

import {
  getJobDecisionVariant,
  getJobReviewPriorityLabel,
  type JobReviewDecision,
  type JobReviewDetail,
} from '../../models/job';
import { ScoreRing } from '../Layout/ScoreRing';
import { JobDecisionBadge } from './JobStatusBadges';

type Severity = 'success' | 'warning' | 'danger';

interface ParsedReview {
  blockers: string[];
  cautionNotes: string[];
  decision: JobReviewDecision | null;
  locationFit: string | null;
  mandatoryGaps: string[];
  matchingPoints: string[];
  optionalMatches: string[];
  reason: string | null;
  score: number | null;
  seniorityFit: string | null;
  skillFit: string | null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function asDecision(value: unknown): JobReviewDecision | null {
  return value === 'apply' || value === 'maybe' || value === 'reject' ? value : null;
}

function parseReviewResult(result: Record<string, unknown>): ParsedReview {
  return {
    blockers: asStringArray(result.blockers),
    cautionNotes: asStringArray(result.caution_notes),
    decision: asDecision(result.decision),
    locationFit: asString(result.location_fit),
    mandatoryGaps: asStringArray(result.mandatory_gaps),
    matchingPoints: asStringArray(result.matching_points),
    optionalMatches: asStringArray(result.explicit_optional_matches),
    reason: asString(result.reason),
    score: asNumber(result.score),
    seniorityFit: asString(result.seniority_fit),
    skillFit: asString(result.skill_fit),
  };
}

const FIT_LABELS: Record<string, string> = {
  buono: 'Buono',
  discreto: 'Discreto',
  excellent: 'Ottimo',
  fair: 'Discreto',
  good: 'Buono',
  high: 'Alto',
  low: 'Basso',
  medium: 'Medio',
  moderate: 'Moderato',
  none: 'Nullo',
  partial: 'Parziale',
  poor: 'Scarso',
  strong: 'Forte',
  weak: 'Debole',
};

function fitVariant(value: string | null): Severity | 'secondary' {
  if (!value) {
    return 'secondary';
  }
  const key = value.toLowerCase();
  if (['good', 'high', 'strong', 'excellent', 'ottimo', 'buono', 'alto', 'forte'].includes(key)) {
    return 'success';
  }
  if (['partial', 'medium', 'moderate', 'fair', 'medio', 'parziale', 'discreto'].includes(key)) {
    return 'warning';
  }
  if (['poor', 'low', 'weak', 'none', 'basso', 'scarso', 'debole', 'nullo'].includes(key)) {
    return 'danger';
  }
  return 'secondary';
}

function fitLabel(value: string): string {
  return FIT_LABELS[value.toLowerCase()] ?? value;
}

function FitChip({ label, value }: { label: string; value: string | null }) {
  if (!value) {
    return null;
  }
  const variant = fitVariant(value);

  return (
    <span className="d-inline-flex align-items-center gap-2">
      <span
        className="d-inline-block rounded-circle"
        style={{ backgroundColor: `var(--bs-${variant})`, height: 9, width: 9 }}
      />
      <span className="text-secondary small">{label}</span>
      <span className="fw-semibold small">{fitLabel(value)}</span>
    </span>
  );
}

function ReviewList({
  icon,
  items,
  title,
  variant,
}: {
  icon: ReactNode;
  items: string[];
  title: string;
  variant: Severity;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <Col md={6}>
      <div className={`h-100 rounded-3 p-3 bg-${variant}-subtle`}>
        <div className={`d-flex align-items-center gap-2 mb-2 fw-semibold text-${variant}-emphasis`}>
          {icon}
          <span>{title}</span>
          <span className="ms-auto font-mono small">{items.length}</span>
        </div>
        <ul className="list-unstyled mb-0 d-grid gap-2 small">
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </div>
    </Col>
  );
}

export function AiReviewResultPanel({ review }: { review: JobReviewDetail }) {
  const parsed = parseReviewResult(review.result);
  const decision = review.decision ?? parsed.decision;
  const score = review.score ?? parsed.score;
  const variant = decision ? getJobDecisionVariant(decision) : 'secondary';

  if (review.status === 'failed') {
    return (
      <div className="rounded-3 bg-danger-subtle text-danger-emphasis p-3">
        <div className="fw-semibold mb-1">Valutazione fallita</div>
        <div className="small">{review.error ?? 'Errore non specificato durante la review.'}</div>
      </div>
    );
  }

  return (
    <Stack className="gap-3">
      <Stack direction="horizontal" className="align-items-center flex-wrap gap-3">
        <ScoreRing score={score} size={84} variant={variant} />
        <div className="min-w-0">
          <Stack direction="horizontal" className="align-items-center flex-wrap gap-2">
            {decision ? (
              <JobDecisionBadge decision={decision} />
            ) : (
              <Badge bg="secondary">Senza esito</Badge>
            )}
            {review.isPriority ? (
              <Badge bg="primary-subtle" text="dark">
                {getJobReviewPriorityLabel(review.priorityReason)}
              </Badge>
            ) : null}
          </Stack>
          <Stack direction="horizontal" className="flex-wrap gap-3 mt-2">
            <FitChip label="Competenze" value={parsed.skillFit} />
            <FitChip label="Seniority" value={parsed.seniorityFit} />
            <FitChip label="Localita" value={parsed.locationFit} />
          </Stack>
        </div>
      </Stack>

      {parsed.reason ? <p className="mb-0">{parsed.reason}</p> : null}

      <Row className="g-3">
        <ReviewList
          icon={<CheckCircle2 aria-hidden="true" size={16} />}
          items={parsed.matchingPoints}
          title="Punti di match"
          variant="success"
        />
        <ReviewList
          icon={<CirclePlus aria-hidden="true" size={16} />}
          items={parsed.optionalMatches}
          title="Match opzionali"
          variant="success"
        />
        <ReviewList
          icon={<TriangleAlert aria-hidden="true" size={16} />}
          items={parsed.mandatoryGaps}
          title="Gap obbligatori"
          variant="warning"
        />
        <ReviewList
          icon={<Info aria-hidden="true" size={16} />}
          items={parsed.cautionNotes}
          title="Note di attenzione"
          variant="warning"
        />
        <ReviewList
          icon={<Ban aria-hidden="true" size={16} />}
          items={parsed.blockers}
          title="Bloccanti"
          variant="danger"
        />
      </Row>
    </Stack>
  );
}
