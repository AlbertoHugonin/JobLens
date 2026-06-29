import Alert from 'react-bootstrap/Alert';
import Spinner from 'react-bootstrap/Spinner';

export function LoadingState({ label = 'Caricamento' }: { label?: string | undefined }) {
  return (
    <div className="d-flex align-items-center gap-2 text-secondary">
      <Spinner animation="border" role="status" size="sm" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <Alert className="mb-0" variant="danger">
      {message}
    </Alert>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <Alert className="mb-0" variant="light">
      {message}
    </Alert>
  );
}
