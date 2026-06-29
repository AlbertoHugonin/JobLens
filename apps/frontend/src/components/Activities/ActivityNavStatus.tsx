import Badge from 'react-bootstrap/Badge';
import Dropdown from 'react-bootstrap/Dropdown';
import Spinner from 'react-bootstrap/Spinner';
import Stack from 'react-bootstrap/Stack';

import {
  getActivityStatusLabel,
  getActivityStatusVariant,
  isActiveActivity,
} from '../../models/activity';
import { useAppStatus } from '../../contexts/AppStatusContext';
import { useInitialLoad } from '../../hooks/useInitialLoad';

export function ActivityNavStatus() {
  const { activityError, activityPreview, loadActivityPreview, loadingActivities } = useAppStatus();

  useInitialLoad(loadActivityPreview);

  const items = activityPreview?.items ?? [];
  const activeCount = items.filter((activity) => isActiveActivity(activity.status)).length;
  const total = activityPreview?.total ?? 0;
  const visibleItems = items.slice(0, 3);
  const extraCount = Math.max(0, total - visibleItems.length);

  return (
    <Dropdown align="end">
      <Dropdown.Toggle
        className="d-flex align-items-center gap-2"
        size="sm"
        title="Attivita"
        variant={activeCount > 0 ? 'outline-primary' : 'outline-secondary'}
      >
        {loadingActivities && !activityPreview ? (
          <Spinner animation="border" role="status" size="sm" />
        ) : null}
        <span>Attivita</span>
        <Badge bg={activeCount > 0 ? 'primary' : 'secondary'}>{activeCount}</Badge>
      </Dropdown.Toggle>

      <Dropdown.Menu className="activity-menu">
        {activityError ? (
          <Dropdown.ItemText className="text-danger">{activityError}</Dropdown.ItemText>
        ) : null}
        {!activityError && visibleItems.length === 0 ? (
          <Dropdown.ItemText className="text-secondary">Nessuna attivita recente</Dropdown.ItemText>
        ) : null}
        {visibleItems.map((activity) => (
          <Dropdown.ItemText key={activity.id}>
            <Stack direction="horizontal" className="justify-content-between gap-3">
              <span className="text-truncate">{activity.activityType}</span>
              <Badge bg={getActivityStatusVariant(activity.status)}>
                {getActivityStatusLabel(activity.status)}
              </Badge>
            </Stack>
            {activity.message ? (
              <div className="small text-secondary text-truncate">{activity.message}</div>
            ) : null}
          </Dropdown.ItemText>
        ))}
        {extraCount > 0 ? (
          <Dropdown.ItemText className="text-secondary">+{extraCount} altre</Dropdown.ItemText>
        ) : null}
      </Dropdown.Menu>
    </Dropdown>
  );
}
