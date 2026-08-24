import { useState, type FormEvent } from 'react';
import { CKEditor } from '@ckeditor/ckeditor5-react';
import { ClassicEditor, Essentials, Paragraph, Bold, Italic, Link, List } from 'ckeditor5';
import 'ckeditor5/ckeditor5.css';

export interface AlertFormValues {
  type: 'info' | 'success' | 'warning' | 'danger';
  visibility: 'dashboard' | 'public' | 'both';
  body_html: string;
}

export default function AlertEditor({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: AlertFormValues;
  submitLabel: string;
  onSubmit: (values: AlertFormValues) => Promise<void>;
}) {
  const [type, setType] = useState<AlertFormValues['type']>(initial?.type ?? 'info');
  const [visibility, setVisibility] = useState<AlertFormValues['visibility']>(initial?.visibility ?? 'public');
  const [bodyHtml, setBodyHtml] = useState(initial?.body_html ?? '');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({ type, visibility, body_html: bodyHtml });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Type
        <select value={type} onChange={(e) => setType(e.target.value as AlertFormValues['type'])}>
          <option value="info">Info</option>
          <option value="success">Success</option>
          <option value="warning">Warning</option>
          <option value="danger">Danger</option>
        </select>
      </label>
      <label>
        Visibility
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as AlertFormValues['visibility'])}>
          <option value="dashboard">Dashboard only</option>
          <option value="public">Public only</option>
          <option value="both">Both</option>
        </select>
      </label>
      <CKEditor
        editor={ClassicEditor}
        data={bodyHtml}
        config={{
          licenseKey: 'GPL',
          plugins: [Essentials, Paragraph, Bold, Italic, Link, List],
          toolbar: ['bold', 'italic', 'link', 'bulletedList', 'numberedList'],
        }}
        onChange={(_event, editor) => setBodyHtml(editor.getData())}
      />
      <button type="submit" disabled={submitting}>{submitLabel}</button>
    </form>
  );
}
