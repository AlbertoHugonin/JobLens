import Badge from 'react-bootstrap/Badge';

import {
  getActivityStatusLabel,
  getActivityStatusVariant,
  type ActivityStatus,
} from '../../models/activity';

export function ActivityStatusBadge({ status }: { status: ActivityStatus }) {
  return <Badge bg={getActivityStatusVariant(status)}>{getActivityStatusLabel(status)}</Badge>;
}
