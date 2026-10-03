import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  apiFetch,
  ApiError,
  useSession,
  AppShell,
  Icon,
  RichText,
  RichTextEditor,
  useColorbox,
  hasPermission,
  CONTACT_ERROR,
  isInvalidContact,
  type RichTextEditorInstance,
} from '../../../sdk';
import { extractText, textToHtml } from '../ocr';
import { resizeImage } from '../resizeImage';
import CameraCapture from '../components/CameraCapture';
import TransactionDialog from '../components/TransactionDialog';
import MyTransactionsView from '../components/MyTransactionsView';
import '../workflow.scss';
import { formatDateTime } from '../datetime';
import { STATUS_LABELS } from '../status';

interface Transaction {
  id: number;
  code: string;
  customer_name: string;
  customer_contact: string | null;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  done_at: string | null;
  image_ids: number[];
}

const STATUSES = Object.keys(STATUS_LABELS);

interface Customer {
  id: number;
  display_name: string;
  email: string;
}

const customerLabel = (c: Customer) => `${c.display_name} - ${c.email}`;

// Owners (manage_users) manage their transactions; anyone else signed in — an
// owner's customer — gets a read-only list of the transactions registered for them.
export default function WorkflowAdminPage() {
  const { user } = useSession();
  return user && hasPermission(user, 'manage_users') ? <AdminView /> : <MyTransactionsView />;
}

function AdminView() {
  const { user, refresh } = useSession();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [openTransaction, setOpenTransaction] = useState<Transaction | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  useColorbox(tableRef, transactions);

  async function loadTransactions() {
    try {
      const body = await apiFetch<{ transactions: Transaction[] }>('/plugins/workflow/transactions');
      setTransactions(body.transactions);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTransactions();
  }, []);

  async function handleStatusChange(id: number, status: string) {
    try {
      await apiFetch(`/plugins/workflow/transactions/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      await loadTransactions();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <AppShell active="tracker" user={user} refresh={refresh} contentClassName="m3-page">
      <h1 className="m3-headline">Tracker</h1>
      <section>
        {error && <p className="m3-banner m3-banner--error" role="alert">{error}</p>}
        <RegisterTransactionForm
          onCreated={async (code) => {
            setLastCode(code);
            await loadTransactions();
          }}
        />
        {lastCode && (
          <p className="m3-banner" role="status">
            Registered — code for the customer: <strong>{lastCode}</strong>
          </p>
        )}
        <div className="m3-card m3-card--flush">
          <h2 className="m3-card__title">Transactions</h2>
          {transactions.length === 0 ? (
            <p className="m3-supporting" style={{ margin: '0 20px 12px' }}>No transactions yet.</p>
          ) : (
            <div ref={tableRef} className="m3-table-wrap">
              <table className="m3-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Photos</th>
                    <th>Customer</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th>Start</th>
                    <th>End</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t.id}>
                      <td><code>{t.code}</code></td>
                      <td>
                        <span className="workflow-thumbs">
                          {t.image_ids.map((imageId) => {
                            const src = `/api/plugins/workflow/transactions/${t.id}/images/${imageId}`;
                            return (
                              <a key={imageId} href={src} data-colorbox={`row-${t.id}`} title={t.code}>
                                <img src={src} alt={`Photo for ${t.code}`} loading="lazy" />
                              </a>
                            );
                          })}
                        </span>
                      </td>
                      <td>{t.customer_name}</td>
                      <td>
                        <button type="button" className="txn-desc" onClick={() => setOpenTransaction(t)}>
                          {t.description ? (
                            <RichText as="span" html={t.description} lines={2} />
                          ) : (
                            <span className="txn-desc__empty">View details</span>
                          )}
                        </button>
                      </td>
                      <td>
                        <select
                          className="m3-select m3-select--dense"
                          aria-label={`Status for ${t.code}`}
                          value={t.status}
                          onChange={(e) => handleStatusChange(t.id, e.target.value)}
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                      </td>
                      <td className="m3-table__nowrap">{formatDateTime(t.created_at)}</td>
                      <td className="m3-table__nowrap">{formatDateTime(t.done_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      {openTransaction && <TransactionDialog transaction={openTransaction} onClose={() => setOpenTransaction(null)} />}
    </AppShell>
  );
}

function RegisterTransactionForm({ onCreated }: { onCreated: (code: string) => Promise<void> }) {
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [description, setDescription] = useState('');
  const [scan, setScan] = useState<{ state: 'idle' } | { state: 'scanning'; progress: number } | { state: 'error' | 'empty' }>({
    state: 'idle',
  });
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<RichTextEditorInstance | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Photos to store with the transaction once it's registered (already resized).
  const [photos, setPhotos] = useState<{ id: number; blob: Blob; url: string }[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const nextPhotoId = useRef(0);

  async function loadCustomers() {
    try {
      const body = await apiFetch<{ customers: Customer[] }>('/plugins/workflow/customers');
      setCustomers(body.customers);
    } catch (err) {
      console.error('Loading customers failed', err);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCustomers();
  }, []);

  // Picking a "<name> - <email>" suggestion fills both fields.
  function handleCustomerNameChange(value: string) {
    const match = customers.find((c) => customerLabel(c) === value);
    if (match) {
      setCustomerName(match.display_name);
      setCustomerEmail(match.email);
    } else {
      setCustomerName(value);
    }
  }

  // Release preview object URLs when photos are removed or the form unmounts.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  async function addPhoto(file: File) {
    setPhotoError(null);
    try {
      const blob = await resizeImage(file);
      const url = URL.createObjectURL(blob);
      setPhotos((prev) => [...prev, { id: nextPhotoId.current++, blob, url }]);
    } catch (err) {
      console.error('Resize failed', err);
      setPhotoError('Couldn’t process that photo.');
    }
  }

  function removePhoto(id: number) {
    setPhotos((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((p) => p.id !== id);
    });
  }

  function handleNewImage(file: File) {
    void addPhoto(file);
    void scanImage(file);
  }

  function handleImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Allow picking the same file again.
    e.target.value = '';
    if (file) handleNewImage(file);
  }

  async function scanImage(file: File) {
    setScan({ state: 'scanning', progress: 0 });
    try {
      const text = await extractText(file, (progress) => setScan({ state: 'scanning', progress }));
      const editor = editorRef.current;
      if (!text) {
        setScan({ state: 'empty' });
      } else {
        if (editor) editor.setData(editor.getData() + textToHtml(text));
        setScan({ state: 'idle' });
      }
    } catch (err) {
      console.error('OCR failed', err);
      setScan({ state: 'error' });
    }
  }

  const contactInvalid = isInvalidContact(customerContact);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (contactInvalid) {
      setError(CONTACT_ERROR);
      return;
    }
    setSubmitting(true);
    try {
      const body = await apiFetch<{ transaction: { id: number; code: string } }>('/plugins/workflow/transactions', {
        method: 'POST',
        body: JSON.stringify({
          customer_name: customerName,
          customer_email: customerEmail || undefined,
          customer_contact: customerContact.trim() || undefined,
          description: description || undefined,
        }),
      });
      // The transaction exists now; upload its photos one by one. A failed
      // upload is reported but doesn't undo the registration.
      let failedUploads = 0;
      for (const photo of photos) {
        const form = new FormData();
        form.append('file', photo.blob, 'photo.jpg');
        try {
          await apiFetch(`/plugins/workflow/transactions/${body.transaction.id}/images`, { method: 'POST', body: form });
        } catch (err) {
          console.error('Photo upload failed', err);
          failedUploads++;
        }
      }
      setCustomerName('');
      setCustomerEmail('');
      setCustomerContact('');
      editorRef.current?.setData('');
      setDescription('');
      setScan({ state: 'idle' });
      photos.forEach((p) => URL.revokeObjectURL(p.url));
      setPhotos([]);
      if (failedUploads) setError(`${failedUploads} photo(s) couldn’t be saved.`);
      if (customerEmail) void loadCustomers();
      await onCreated(body.transaction.code);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.code === 'invalid_contact_number'
            ? CONTACT_ERROR
            : err.code
          : 'unknown_error',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const scanning = scan.state === 'scanning';

  return (
    <details className="m3-card m3-collapsible">
      <summary className="m3-card__title">Register transaction</summary>
      <form className="m3-form" onSubmit={handleSubmit}>
        {error && <p role="alert" className="m3-banner m3-banner--error">{error}</p>}
        <label>
          Customer name
          <input
            value={customerName}
            onChange={(e) => handleCustomerNameChange(e.target.value)}
            list="workflow-customers"
            autoComplete="off"
            required
          />
          <datalist id="workflow-customers">
            {customers.map((c) => (
              <option key={c.id} value={customerLabel(c)} />
            ))}
          </datalist>
        </label>
        <label>
          Email (optional)
          <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
        </label>
        <label>
          Contact (optional)
          <input
            type="tel"
            aria-invalid={contactInvalid}
            value={customerContact}
            onChange={(e) => setCustomerContact(e.target.value)}
          />
          {contactInvalid && <span role="alert" className="m3-field-error">{CONTACT_ERROR}</span>}
        </label>
        <div className="m3-field">
          <span>Description (optional)</span>
          <RichTextEditor
            label="Details"
            placeholder="Items, notes…"
            onChange={setDescription}
            onReady={(editor) => {
              editorRef.current = editor;
            }}
          />
        </div>
        <div className="workflow-scan">
          <label className={`m3-button m3-button--tonal${scanning ? ' is-disabled' : ''}`}>
            <Icon name="scan" />
            {scanning ? 'Scanning…' : 'Upload image'}
            <input
              ref={fileRef}
              className="visually-hidden"
              type="file"
              accept="image/*"
              onChange={handleImage}
              disabled={scanning}
            />
          </label>
          <button
            type="button"
            className="m3-button m3-button--tonal"
            onClick={() => setCameraOpen(true)}
            disabled={scanning}
          >
            <Icon name="camera" />
            Capture by camera
          </button>
          <span className="workflow-scan__status" aria-live="polite">
            {scan.state === 'scanning'
              ? `Reading text… ${Math.round(scan.progress * 100)}%`
              : scan.state === 'empty'
                ? 'No text found in that image.'
                : scan.state === 'error'
                  ? 'Couldn’t read that image — try another.'
                  : 'Text in the photo is added to the description.'}
          </span>
          {scanning && (
            <progress className="workflow-scan__progress" max={1} value={scan.progress} aria-label="Scan progress" />
          )}
        </div>
        {(photos.length > 0 || photoError) && (
          <div className="workflow-photos">
            {photoError && <p className="m3-banner m3-banner--error" role="alert">{photoError}</p>}
            <ul className="workflow-photos__list" aria-label="Photos to save">
              {photos.map((p, i) => (
                <li key={p.id} className="workflow-photos__item">
                  <img src={p.url} alt={`Photo ${i + 1}`} />
                  <span className="workflow-photos__size">{Math.round(p.blob.size / 1024)} KB</span>
                  <button
                    type="button"
                    className="workflow-photos__remove"
                    aria-label={`Remove photo ${i + 1}`}
                    onClick={() => removePhoto(p.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button type="submit" className="m3-button" disabled={scanning || submitting}>
          {submitting ? 'Saving…' : 'Register'}
        </button>
        {cameraOpen && (
          <CameraCapture
            onClose={() => setCameraOpen(false)}
            onCapture={(file) => {
              setCameraOpen(false);
              handleNewImage(file);
            }}
          />
        )}
      </form>
    </details>
  );
}
