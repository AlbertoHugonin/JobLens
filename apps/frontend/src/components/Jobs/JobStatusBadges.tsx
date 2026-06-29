import Badge from 'react-bootstrap/Badge';

import {
  getJobAvailabilityStatusLabel,
  getJobAvailabilityStatusVariant,
  getJobDecisionLabel,
  getJobDecisionVariant,
  getJobLocalStatusLabel,
  getJobLocalStatusVariant,
  type JobAvailabilityStatus,
  type JobLocalStatus,
  type JobReviewDecision,
} from '../../models/job';

export function JobLocalStatusBadge({ status }: { status: JobLocalStatus }) {
  return <Badge bg={getJobLocalStatusVariant(status)}>{getJobLocalStatusLabel(status)}</Badge>;
}

export function JobAvailabilityBadge({ status }: { status: JobAvailabilityStatus }) {
  return (
    <Badge bg={getJobAvailabilityStatusVariant(status)}>
      {getJobAvailabilityStatusLabel(status)}
    </Badge>
  );
}

export function JobDecisionBadge({ decision }: { decision: JobReviewDecision }) {
  return <Badge bg={getJobDecisionVariant(decision)}>{getJobDecisionLabel(decision)}</Badge>;
}
