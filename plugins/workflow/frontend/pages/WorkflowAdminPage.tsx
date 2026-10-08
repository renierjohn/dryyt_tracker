import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  apiFetch,
  ApiError,
  useSession,
  AppShell,
  Autocomplete,
  Icon,
  RichText,
  RichTextEditor,
  type IconName,
  hasPermission,
  CONTACT_ERROR,
  isInvalidContact,
  type RichTextEditorInstance,
} from '../../../sdk';
import TransactionDialog from '../components/TransactionDialog';
import MyTransactionsView from '../components/MyTransactionsView';
import '../workflow.scss';
import { formatDateTime } from '../datetime';
import { formatWeight } from '../weight';
import { printReceipt } from '../printReceipt';
import ConfirmDialog from '../components/ConfirmDialog';
import { downloadReport, type ReportFormat } from '../exportReport';
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
  weight_kg: number | null;
  control_number: string | null;
}

const STATUSES = Object.keys(STATUS_LABELS);

interface Customer {
  id: number;
  display_name: string;
  email: string;
  contact_number: string | null;
}

const SUBMIT_ERRORS: Record<string, string> = {
  invalid_contact_number: CONTACT_ERROR,
  invalid_weight: 'Weight must be a number greater than 0.',
  invalid_control_number: 'Control number must be digits only.',
  duplicate_control_number: 'That control number is already used.',
  duplicate_code: 'The printed code was taken in the meantime — print again.',
};

const customerLabel = (c: Customer) => (c.contact_number ? `${c.display_name}-${c.contact_number}` : c.display_name);

// Owners (manage_users) manage their transactions; anyone else signed in — an
// owner's customer — gets a read-only list of the transactions registered for them.
export default function WorkflowAdminPage() {
  const { user } = useSession();
  return user && hasPermission(user, 'manage_users') ? <AdminView /> : <MyTransactionsView />;
}

function AdminView() {
  const { user, refresh } = useSession();
  // Every status section starts collapsed and loads on first expand: the open
  // statuses share one request, "End" pages on its own. null = not loaded yet.
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [openTransaction, setOpenTransaction] = useState<Transaction | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  // "End" is paginated server-side (it only grows); everything else comes
  // back in one unpaginated list.
  const [ended, setEnded] = useState<PagedTransactions | null>(null);
  const [endedPage, setEndedPage] = useState(1);

  async function loadOpen() {
    try {
      const body = await apiFetch<{ transactions: Transaction[] }>('/plugins/workflow/transactions');
      setTransactions(body.transactions);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  async function loadEnded(page: number) {
    try {
      const body = await apiFetch<PagedTransactions>(`/plugins/workflow/transactions?status=end&page=${page}`);
      const lastPage = Math.max(1, Math.ceil(body.total / body.page_size));
      // The page emptied (e.g. its last row was reopened) — step back.
      if (page > lastPage) return loadEnded(lastPage);
      setEndedPage(page);
      setEnded(body);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  // Refreshes only the sections that have been loaded.
  async function loadTransactions() {
    await Promise.all([transactions !== null && loadOpen(), ended !== null && loadEnded(endedPage)]);
  }

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
      <div className="workflow-headline">
        <h1 className="m3-headline">Tracker</h1>
        <button type="button" className="m3-button m3-button--tonal" onClick={() => setDownloadOpen(true)}>
          <Icon name="download" />
          Download Report
        </button>
      </div>
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
        {STATUSES.map((status) => {
          const isEnd = status === 'end';
          const rows = isEnd ? (ended?.transactions ?? null) : (transactions?.filter((t) => t.status === status) ?? null);
          const count = isEnd ? ended?.total : rows?.length;
          return (
            <TransactionsTable
              key={status}
              status={status}
              title={count === undefined ? STATUS_LABELS[status] : `${STATUS_LABELS[status]} (${count})`}
              empty="None."
              onExpand={() => {
                if (isEnd ? ended === null : transactions === null) void (isEnd ? loadEnded(1) : loadOpen());
              }}
              transactions={rows}
              onStatusChange={handleStatusChange}
              onOpen={setOpenTransaction}
              footer={
                isEnd && ended ? (
                  <Pager
                    page={endedPage}
                    pageCount={Math.max(1, Math.ceil(ended.total / ended.page_size))}
                    total={ended.total}
                    pageSize={ended.page_size}
                    onPage={(page) => void loadEnded(page)}
                  />
                ) : null
              }
            />
          );
        })}
      </section>
      {openTransaction && <TransactionDialog transaction={openTransaction} onClose={() => setOpenTransaction(null)} />}
      {downloadOpen && <DownloadReportDialog onClose={() => setDownloadOpen(false)} />}
    </AppShell>
  );
}

// One collapsible card of the owner's transactions table — the page renders
// one per status, in STATUS_LABELS order, all collapsed at first. onExpand
// fires each time it's opened; transactions is null until loaded.
function TransactionsTable({
  status,
  title,
  empty,
  onExpand,
  footer,
  transactions,
  onStatusChange,
  onOpen,
}: {
  status: string;
  title: string;
  empty: string;
  onExpand: () => void;
  footer?: ReactNode;
  transactions: Transaction[] | null;
  onStatusChange: (id: number, status: string) => void;
  onOpen: (transaction: Transaction) => void;
}) {
  return (
    <details className="m3-card m3-card--flush m3-collapsible" onToggle={(e) => e.currentTarget.open && onExpand()}>
      <summary className="m3-card__title">
        <span className="workflow-section-title">
          <span className={`workflow-section-icon workflow-section-icon--${status}`}>
            <Icon name={status as IconName} />
          </span>
          {title}
        </span>
      </summary>
      {transactions === null ? (
        <p className="m3-supporting" style={{ margin: '0 20px 12px' }}>Loading…</p>
      ) : transactions.length === 0 ? (
        <p className="m3-supporting" style={{ margin: '0 20px 12px' }}>{empty}</p>
      ) : (
        <div className="m3-table-wrap">
          <table className="m3-table">
            <thead>
              <tr>
                <th>Control #</th>
                <th>Code</th>
                <th>Customer</th>
                <th>Weight</th>
                <th>Description</th>
                <th>Status</th>
                <th>Start</th>
                <th>End</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id}>
                  <td>{t.control_number ?? '—'}</td>
                  <td><code>{t.code}</code></td>
                  <td>{t.customer_name}</td>
                  <td className="m3-table__nowrap">{formatWeight(t.weight_kg)}</td>
                  <td>
                    <button type="button" className="txn-desc" onClick={() => onOpen(t)}>
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
                      onChange={(e) => onStatusChange(t.id, e.target.value)}
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
      {footer}
    </details>
  );
}

interface ExportRow {
  control_number: string | null;
  code: string;
  customer_name: string;
  customer_contact: string | null;
  customer_email: string | null;
  status: string;
  created_at: string;
  done_at: string | null;
}

const REPORT_HEADER = ['Control Number', 'Code', 'Name', 'Phone', 'Email', 'Status', 'Date Started', 'Date Ended'];

const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// SQLite UTC "YYYY-MM-DD HH:MM:SS" → local "YYYY-MM-DD HH:MM".
function reportDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value.replace(' ', 'T') + 'Z');
  return `${localDay(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Every one of the owner's transactions, as CSV or Excel.
function DownloadReportDialog({ onClose }: { onClose: () => void }) {
  const [format, setFormat] = useState<ReportFormat>('xlsx');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setBusy(true);
    setError(null);
    try {
      const { transactions } = await apiFetch<{ transactions: ExportRow[] }>('/plugins/workflow/transactions/export');
      const rows = transactions.map((t) => [
        t.control_number,
        t.code,
        t.customer_name,
        t.customer_contact,
        t.customer_email,
        STATUS_LABELS[t.status] ?? t.status,
        reportDate(t.created_at),
        reportDate(t.done_at),
      ]);
      downloadReport(format, `transactions-${localDay(new Date())}`, REPORT_HEADER, rows);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      title="Download report"
      onCancel={onClose}
      actions={
        <button type="button" className="m3-button" onClick={() => void handleDownload()} disabled={busy}>
          <Icon name="download" />
          {busy ? 'Preparing…' : 'Download'}
        </button>
      }
    >
      {error && <p role="alert" className="m3-banner m3-banner--error">{error}</p>}
      <fieldset className="workflow-report-format">
        <legend className="m3-supporting">All your transactions, in this format:</legend>
        <label>
          <input type="radio" name="report-format" checked={format === 'xlsx'} onChange={() => setFormat('xlsx')} />
          Excel (.xlsx)
        </label>
        <label>
          <input type="radio" name="report-format" checked={format === 'csv'} onChange={() => setFormat('csv')} />
          CSV (.csv)
        </label>
      </fieldset>
    </ConfirmDialog>
  );
}

interface PagedTransactions {
  transactions: Transaction[];
  total: number;
  page: number;
  page_size: number;
}

function Pager({
  page,
  pageCount,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  if (total === 0) return null;
  return (
    <nav className="workflow-pager" aria-label="Ended transactions pages">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      {pageCount > 1 && (
        <span className="workflow-pager__controls">
          <button type="button" className="m3-button m3-button--tonal" onClick={() => onPage(page - 1)} disabled={page === 1}>
            ‹ Prev
          </button>
          <span aria-current="page">Page {page} of {pageCount}</span>
          <button
            type="button"
            className="m3-button m3-button--tonal"
            onClick={() => onPage(page + 1)}
            disabled={page === pageCount}
          >
            Next ›
          </button>
        </span>
      )}
    </nav>
  );
}

function RegisterTransactionForm({ onCreated }: { onCreated: (code: string) => Promise<void> }) {
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  // Customers load lazily, on focusing the customer name field; cleared after
  // registering a new customer so the next focus picks them up.
  const customersLoaded = useRef(false);
  const [description, setDescription] = useState('');
  const [weight, setWeight] = useState('');
  const [controlNumber, setControlNumber] = useState('');
  // What the server assigns when controlNumber is left blank.
  const [nextControlNumber, setNextControlNumber] = useState('000001');
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<RichTextEditorInstance | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingNoPrint, setConfirmingNoPrint] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const { user } = useSession();

  async function loadCustomers() {
    if (customersLoaded.current) return;
    customersLoaded.current = true;
    try {
      const body = await apiFetch<{ customers: Customer[] }>('/plugins/workflow/customers');
      setCustomers(body.customers);
    } catch (err) {
      customersLoaded.current = false;
      console.error('Loading customers failed', err);
    }
  }

  async function loadNextControlNumber() {
    try {
      const body = await apiFetch<{ control_number: string }>('/plugins/workflow/transactions/next-control-number');
      setNextControlNumber(body.control_number);
    } catch (err) {
      console.error('Loading next control number failed', err);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadNextControlNumber();
  }, []);

  // Picking a "<name>-<contact>" suggestion fills both fields; the contact
  // number is what links the transaction to that customer.
  function handleCustomerNameChange(value: string) {
    const match = customers.find((c) => customerLabel(c) === value);
    if (match) {
      setPrinted(false);
      setCustomerName(match.display_name);
      setCustomerContact(match.contact_number ?? '');
      setCustomerEmail('');
    } else {
      setPrinted(false);
      setCustomerName(value);
    }
  }

  const contactInvalid = isInvalidContact(customerContact);

  // Print only prints the claim slip — under a fresh code and the control
  // number it shows (pinned into the field) — and Register then saves the
  // transaction with both. Registering with nothing printed asks first.
  // Editing what's on the slip (name, control number, weight, notes)
  // afterwards means it needs printing again.
  const [printedCode, setPrintedCode] = useState<string | null>(null);
  const [printed, setPrinted] = useState(false);
  const [printing, setPrinting] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (printed) void register();
    else setConfirmingNoPrint(true);
  }

  async function handlePrint() {
    setConfirmingNoPrint(false);
    setError(null);
    if (!formRef.current?.reportValidity() || !user) return;
    setPrinting(true);
    try {
      const code = printedCode ?? (await apiFetch<{ code: string }>('/plugins/workflow/transactions/new-code')).code;
      const control = controlNumber.trim() || nextControlNumber;
      setPrintedCode(code);
      setControlNumber(control);
      await printReceipt({
        ownerName: user.display_name,
        ownerContact: user.contact_number,
        ownerEmail: user.email,
        customerName: customerName.trim(),
        controlNumber: control,
        weightKg: weight.trim() ? Math.round(Number(weight) * 100) / 100 : null,
        notesHtml: description,
        code,
      });
      setPrinted(true);
    } catch (err) {
      console.error('Printing failed', err);
      setError('The slip couldn’t be printed.');
    } finally {
      setPrinting(false);
    }
  }

  async function register() {
    setConfirmingNoPrint(false);
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
          weight_kg: weight.trim() || undefined,
          control_number: controlNumber.trim() || undefined,
          code: printed ? (printedCode ?? undefined) : undefined,
        }),
      });
      setCustomerName('');
      setCustomerEmail('');
      setCustomerContact('');
      editorRef.current?.setData('');
      setDescription('');
      setWeight('');
      setControlNumber('');
      setPrintedCode(null);
      setPrinted(false);
      void loadNextControlNumber();
      if (customerContact.trim() || customerEmail) customersLoaded.current = false;
      await onCreated(body.transaction.code);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (SUBMIT_ERRORS[err.code] ?? err.code)
          : 'unknown_error',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <details className="m3-card m3-collapsible">
      <summary className="m3-card__title">Register transaction</summary>
      <form ref={formRef} className="m3-form" onSubmit={handleSubmit}>
        {error && <p role="alert" className="m3-banner m3-banner--error">{error}</p>}
        <label className="workflow-form-full">
          <span>
            Customer name <span className="m3-required" aria-hidden="true">*</span>
          </span>
          <Autocomplete
            value={customerName}
            onChange={handleCustomerNameChange}
            onFocus={() => void loadCustomers()}
            options={customers.map((c) => ({ id: c.id, value: customerLabel(c), label: c.display_name, detail: c.contact_number }))}
            required
          />
        </label>
        <div className="workflow-form-row">
          <label>
            Control number
            <input
              inputMode="numeric"
              pattern="\d*"
              placeholder={nextControlNumber}
              value={controlNumber}
              onChange={(e) => {
                setPrinted(false);
                setControlNumber(e.target.value);
              }}
            />
          </label>
          <label>
            Weight in kg
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={weight}
              onChange={(e) => {
                setPrinted(false);
                setWeight(e.target.value);
              }}
            />
          </label>
        </div>
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
        <label>
          Email (optional)
          <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
        </label>
        <div className="m3-field">
          <span>Notes (optional)</span>
          <RichTextEditor
            label="Notes"
            placeholder="Items, notes…"
            onChange={(html) => {
              setPrinted(false);
              setDescription(html);
            }}
            onReady={(editor) => {
              editorRef.current = editor;
            }}
          />
        </div>
        <div className="workflow-form-actions">
          <button type="button" className="m3-button m3-button--tonal" onClick={() => void handlePrint()} disabled={submitting || printing}>
            <Icon name="print" />
            Print
          </button>
          <button type="submit" className="m3-button" disabled={submitting || printing}>
            <Icon name="save" />
            {submitting ? 'Saving…' : 'Register'}
          </button>
        </div>
      </form>
      {confirmingNoPrint && (
        <ConfirmDialog
          title="Register without printing?"
          onCancel={() => setConfirmingNoPrint(false)}
          actions={
            <>
              <button type="button" className="m3-button m3-button--tonal" onClick={() => void handlePrint()}>
                <Icon name="print" />
                Print
              </button>
              <button type="button" className="m3-button" onClick={() => void register()}>
                <Icon name="save" />
                Proceed without print
              </button>
            </>
          }
        >
          <p className="m3-supporting">No claim slip will be printed for this transaction.</p>
        </ConfirmDialog>
      )}
    </details>
  );
}
