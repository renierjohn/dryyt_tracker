import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  apiFetch,
  ApiError,
  useSession,
  AppShell,
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
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [openTransaction, setOpenTransaction] = useState<Transaction | null>(null);
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

  async function loadTransactions() {
    await Promise.all([loadOpen(), loadEnded(endedPage)]);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadOpen();
    void loadEnded(1);
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
        {STATUSES.map((status) => {
          const isEnd = status === 'end';
          const rows = isEnd ? (ended?.transactions ?? []) : transactions.filter((t) => t.status === status);
          const count = isEnd ? (ended?.total ?? 0) : rows.length;
          return (
            <TransactionsTable
              key={status}
              status={status}
              title={`${STATUS_LABELS[status]} (${count})`}
              empty="None."
              defaultOpen={status === 'hold'}
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
    </AppShell>
  );
}

// One collapsible card of the owner's transactions table — the page renders
// one per status, in STATUS_LABELS order, with only "On hold" open at first.
// `open` is only the initial state: React leaves the attribute alone after a
// user toggles it, since the prop never changes.
function TransactionsTable({
  status,
  title,
  empty,
  defaultOpen,
  footer,
  transactions,
  onStatusChange,
  onOpen,
}: {
  status: string;
  title: string;
  empty: string;
  defaultOpen: boolean;
  footer?: ReactNode;
  transactions: Transaction[];
  onStatusChange: (id: number, status: string) => void;
  onOpen: (transaction: Transaction) => void;
}) {
  return (
    <details className="m3-card m3-card--flush m3-collapsible" open={defaultOpen}>
      <summary className="m3-card__title">
        <span className="workflow-section-title">
          <span className={`workflow-section-icon workflow-section-icon--${status}`}>
            <Icon name={status as IconName} />
          </span>
          {title}
        </span>
      </summary>
      {transactions.length === 0 ? (
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
    try {
      const body = await apiFetch<{ customers: Customer[] }>('/plugins/workflow/customers');
      setCustomers(body.customers);
    } catch (err) {
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
    void loadCustomers();
    void loadNextControlNumber();
  }, []);

  // Picking a "<name>-<contact>" suggestion fills both fields; the contact
  // number is what links the transaction to that customer.
  function handleCustomerNameChange(value: string) {
    const match = customers.find((c) => customerLabel(c) === value);
    if (match) {
      setCustomerName(match.display_name);
      setCustomerContact(match.contact_number ?? '');
      setCustomerEmail('');
    } else {
      setCustomerName(value);
    }
  }

  const contactInvalid = isInvalidContact(customerContact);

  // Register (Enter or the Register button) asks first whether to go ahead
  // without printing; Print registers and then prints the claim slip.
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setConfirmingNoPrint(true);
  }

  function handlePrint() {
    if (formRef.current?.reportValidity()) void register(true);
  }

  async function register(print: boolean) {
    setConfirmingNoPrint(false);
    setError(null);
    if (contactInvalid) {
      setError(CONTACT_ERROR);
      return;
    }
    setSubmitting(true);
    try {
      const body = await apiFetch<{
        transaction: { id: number; code: string; customer_name: string; control_number: string | null; weight_kg: number | null };
      }>('/plugins/workflow/transactions', {
        method: 'POST',
        body: JSON.stringify({
          customer_name: customerName,
          customer_email: customerEmail || undefined,
          customer_contact: customerContact.trim() || undefined,
          description: description || undefined,
          weight_kg: weight.trim() || undefined,
          control_number: controlNumber.trim() || undefined,
        }),
      });
      setCustomerName('');
      setCustomerEmail('');
      setCustomerContact('');
      editorRef.current?.setData('');
      setDescription('');
      setWeight('');
      setControlNumber('');
      void loadNextControlNumber();
      if (customerContact.trim() || customerEmail) void loadCustomers();
      await onCreated(body.transaction.code);
      if (print && user) {
        const t = body.transaction;
        // The transaction is saved either way; a failed print can be redone from the browser.
        printReceipt({
          ownerName: user.display_name,
          ownerContact: user.contact_number,
          ownerEmail: user.email,
          customerName: t.customer_name,
          controlNumber: t.control_number,
          weightKg: t.weight_kg,
          code: t.code,
        }).catch((err) => {
          console.error('Printing failed', err);
          setError('Registered, but the slip couldn’t be printed.');
        });
      }
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
        <div className="workflow-form-row">
          <label>
            Control number
            <input
              inputMode="numeric"
              pattern="\d*"
              placeholder={nextControlNumber}
              value={controlNumber}
              onChange={(e) => setControlNumber(e.target.value)}
            />
          </label>
          <label>
            Weight in kg (optional)
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
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
            onChange={setDescription}
            onReady={(editor) => {
              editorRef.current = editor;
            }}
          />
        </div>
        <div className="workflow-form-actions">
          <button type="button" className="m3-button m3-button--tonal" onClick={handlePrint} disabled={submitting}>
            <Icon name="print" />
            Print
          </button>
          <button type="submit" className="m3-button" disabled={submitting}>
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
              <button type="button" className="m3-button m3-button--tonal" onClick={() => void register(true)}>
                <Icon name="print" />
                Print
              </button>
              <button type="button" className="m3-button" onClick={() => void register(false)}>
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
