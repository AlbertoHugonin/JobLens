import { useState, type MouseEvent, type ReactNode } from 'react';

import Button from 'react-bootstrap/Button';
import Modal from 'react-bootstrap/Modal';

export function ConfirmActionButton({
  cancelLabel = 'Annulla',
  children,
  className,
  confirmLabel = 'Conferma',
  confirmMessage,
  confirmTitle,
  disabled = false,
  onClick,
  onConfirm,
  size,
  title,
  variant = 'outline-danger',
}: {
  cancelLabel?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
  confirmLabel?: string | undefined;
  confirmMessage: ReactNode;
  confirmTitle: string;
  disabled?: boolean | undefined;
  onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  onConfirm: () => void;
  size?: 'lg' | 'sm' | undefined;
  title?: string | undefined;
  variant?: string | undefined;
}) {
  const [show, setShow] = useState(false);

  const buttonOptionalProps = {
    ...(className ? { className } : {}),
    ...(size ? { size } : {}),
    ...(title ? { title } : {}),
  };

  const handleConfirm = () => {
    setShow(false);
    onConfirm();
  };

  return (
    <>
      <Button
        {...buttonOptionalProps}
        disabled={disabled}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) {
            setShow(true);
          }
        }}
        variant={variant}
      >
        {children}
      </Button>
      <Modal centered onHide={() => setShow(false)} show={show}>
        <Modal.Header closeButton>
          <Modal.Title className="h5">{confirmTitle}</Modal.Title>
        </Modal.Header>
        <Modal.Body>{confirmMessage}</Modal.Body>
        <Modal.Footer>
          <Button onClick={() => setShow(false)} variant="outline-secondary">
            {cancelLabel}
          </Button>
          <Button onClick={handleConfirm} variant="danger">
            {confirmLabel}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
