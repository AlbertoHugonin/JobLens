import Alert from 'react-bootstrap/Alert';

export function PlaceholderPanel({ title }: { title: string }) {
  return (
    <Alert className="mb-0" variant="light">
      {title}
    </Alert>
  );
}
