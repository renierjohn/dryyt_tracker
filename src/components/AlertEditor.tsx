import { useState, type FormEvent } from 'react';
import { CKEditor } from '@ckeditor/ckeditor5-react';
import { ClassicEditor, Essentials, Paragraph, Bold, Italic, Link, List } from 'ckeditor5';
import 'ckeditor5/ckeditor5.css';
import { EDITOR_NAME_TRANSLATIONS } from '../lib/editorTranslations';
import '../assets/sass/alert-editor.scss';

export interface AlertFormValues {
  type: 'info' | 'success' | 'warning' | 'danger';
  visibility: 'dashboard' | 'public';
  body_html: string;
}

const VISIBILITY_LABELS: Record<AlertFormValues['visibility'], string> = {
  dashboard: 'Dashboard only',
  public: 'Public only',
};
const ALL_VISIBILITIES = Object.keys(VISIBILITY_LABELS) as AlertFormValues['visibility'][];

export default function AlertEditor({
  initial,
  submitLabel,
  onSubmit,
  visibilityOptions = ALL_VISIBILITIES,
}: {
  initial?: AlertFormValues;
  submitLabel: string;
  onSubmit: (values: AlertFormValues) => Promise<void>;
  // Restricts the Visibility choices; an existing alert outside them is saved
  // with the first allowed option.
  visibilityOptions?: AlertFormValues['visibility'][];
}) {
  const [type, setType] = useState<AlertFormValues['type']>(initial?.type ?? 'info');
  const [visibility, setVisibility] = useState<AlertFormValues['visibility']>(
    initial && visibilityOptions.includes(initial.visibility)
      ? initial.visibility
      : visibilityOptions.includes('public')
        ? 'public'
        : visibilityOptions[0],
  );
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
    <form className="alert-editor" onSubmit={handleSubmit}>
      <div className="alert-editor__fields">
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
            {visibilityOptions.map((v) => (
              <option key={v} value={v}>{VISIBILITY_LABELS[v]}</option>
            ))}
          </select>
        </label>
      </div>
      <CKEditor
        editor={ClassicEditor}
        data={bodyHtml}
        config={{
          licenseKey: 'GPL',
          translations: EDITOR_NAME_TRANSLATIONS,
          plugins: [Essentials, Paragraph, Bold, Italic, Link, List],
          toolbar: ['bold', 'italic', 'link', 'bulletedList', 'numberedList'],
        }}
        onChange={(_event, editor) => setBodyHtml(editor.getData())}
      />
      <button className="alert-editor__submit" type="submit" disabled={submitting}>{submitLabel}</button>
    </form>
  );
}
