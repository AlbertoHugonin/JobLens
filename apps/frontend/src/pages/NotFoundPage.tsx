import Button from 'react-bootstrap/Button';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '../components/Layout/PageHeader';
import { PlaceholderPanel } from '../components/Utilities/PlaceholderPanel';

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <>
      <PageHeader title="Pagina non trovata" />
      <div className="d-grid gap-3">
        <PlaceholderPanel title="Percorso non disponibile" />
        <div>
          <Button onClick={() => navigate('/')} variant="primary">
            Dashboard
          </Button>
        </div>
      </div>
    </>
  );
}
