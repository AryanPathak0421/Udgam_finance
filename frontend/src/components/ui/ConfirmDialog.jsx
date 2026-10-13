import Modal from './Modal.jsx';

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'primary', // primary | danger
  loading = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      busy={loading}
      size="sm"
      footer={
        <>
          <button className="btn" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button className={`btn ${tone === 'danger' ? 'danger' : 'primary'}`} onClick={onConfirm} disabled={loading}>
            {loading ? 'Please wait…' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="confirm-text">{message}</p>
    </Modal>
  );
}
