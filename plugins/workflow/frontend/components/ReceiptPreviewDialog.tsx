import { Icon, QrCode } from '../../../sdk';
import { notesToText, ownerLineOf, trackUrlFor, type Receipt } from '../printReceipt';
import ConfirmDialog from './ConfirmDialog';

// What the thermal printer will print, shown before sending it to RawBT.
export default function ReceiptPreviewDialog({
  receipt,
  onPrint,
  onCancel,
}: {
  receipt: Receipt;
  onPrint: () => void;
  onCancel: () => void;
}) {
  const notes = notesToText(receipt.notesHtml);
  const trackUrl = trackUrlFor(receipt.code);
  return (
    <ConfirmDialog
      title="Print preview"
      onCancel={onCancel}
      actions={
        <button type="button" className="m3-button" onClick={onPrint}>
          <Icon name="print" />
          Print
        </button>
      }
    >
      <div className="receipt-preview">
        <p className="receipt-preview__owner">{receipt.ownerName}</p>
        <p className="receipt-preview__center">{ownerLineOf(receipt)}</p>
        <p>Name: {receipt.customerName}</p>
        <p>Control Number: {receipt.controlNumber ?? '-'}</p>
        <p>Weight: {receipt.weightKg === null ? '-' : `${receipt.weightKg} kg`}</p>
        <p className="receipt-preview__notes">Notes: {notes || '-'}</p>
        <div className="receipt-preview__qr">
          <QrCode value={trackUrl} size={140} label={`QR code for ${trackUrl}`} />
          <p className="receipt-preview__code">{receipt.code}</p>
        </div>
      </div>
    </ConfirmDialog>
  );
}
