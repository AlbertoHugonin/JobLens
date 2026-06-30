import { useRef } from 'react';

import { Download, Upload } from 'lucide-react';
import Button from 'react-bootstrap/Button';
import Stack from 'react-bootstrap/Stack';

export function ImportExportButtons({
  disabled = false,
  exportLabel = 'Esporta',
  importLabel = 'Importa',
  onExport,
  onImport,
}: {
  disabled?: boolean;
  exportLabel?: string;
  importLabel?: string;
  onExport: () => void;
  onImport: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <Stack direction="horizontal" className="gap-2">
      <Button disabled={disabled} onClick={onExport} size="sm" variant="outline-secondary">
        <Download aria-hidden="true" className="me-1" size={14} />
        {exportLabel}
      </Button>
      <Button
        disabled={disabled}
        onClick={() => fileRef.current?.click()}
        size="sm"
        variant="outline-secondary"
      >
        <Upload aria-hidden="true" className="me-1" size={14} />
        {importLabel}
      </Button>
      <input
        accept="application/json,.json"
        className="d-none"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) {
            onImport(file);
          }
        }}
        ref={fileRef}
        type="file"
      />
    </Stack>
  );
}
