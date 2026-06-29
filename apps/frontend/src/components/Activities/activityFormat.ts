import type { ActivityStatus } from '../../models/activity';

export function formatTimestamp(value: Date | null): string {
  if (!value) {
    return '-';
  }

  return value.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'medium' });
}

export function formatClock(value: Date): string {
  return value.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatRelative(value: Date | null): string {
  if (!value) {
    return '-';
  }

  const seconds = Math.round((Date.now() - value.getTime()) / 1000);
  if (seconds < 5) {
    return 'ora';
  }
  if (seconds < 60) {
    return `${seconds}s fa`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min fa`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} h fa`;
  }

  return value.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
}

/** Left-edge rail colour for a run row, by lifecycle status. */
export function activityRailClass(status: ActivityStatus): string {
  switch (status) {
    case 'running':
      return 'rail-running';
    case 'success':
      // Completed runs are the resting state — no rail, so the bar only flags
      // runs that are in motion or need attention.
      return '';
    case 'failed':
      return 'rail-failed';
    case 'cancelled':
    case 'interrupted':
      return 'rail-warning';
    case 'queued':
    default:
      return 'rail-queued';
  }
}

/** Bootstrap variant used to tint the heartbeat pulse for a status. */
export function statusPulseVariant(status: ActivityStatus): string {
  switch (status) {
    case 'running':
      return 'info';
    case 'success':
      return 'success';
    case 'failed':
      return 'danger';
    case 'cancelled':
    case 'interrupted':
      return 'warning';
    default:
      return 'secondary';
  }
}
