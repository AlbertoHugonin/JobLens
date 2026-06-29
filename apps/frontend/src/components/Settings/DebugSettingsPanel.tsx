import Card from 'react-bootstrap/Card';
import Form from 'react-bootstrap/Form';
import Stack from 'react-bootstrap/Stack';

import { useDebugMode } from '../../contexts/DebugModeContext';

export function DebugSettingsPanel() {
  const { debugMode, setDebugMode } = useDebugMode();

  return (
    <Card>
      <Card.Body>
        <Stack className="gap-3">
          <Form.Check
            checked={debugMode}
            id="debug-mode-toggle"
            label="Mostra strumenti di debug"
            onChange={(event) => setDebugMode(event.target.checked)}
            type="switch"
          />
          <p className="text-secondary small mb-0">
            Mostra le azioni e i pannelli di diagnostica nelle pagine operative — ad esempio
            &quot;Crea prova&quot; nella coda Attivita, il pannello Debug LinkedIn nel dettaglio
            attivita e i dettagli tecnici JSON delle valutazioni. Tienilo disattivato per
            un&apos;interfaccia pulita, adatta alla produzione.
          </p>
        </Stack>
      </Card.Body>
    </Card>
  );
}
