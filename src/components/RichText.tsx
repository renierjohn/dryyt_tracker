import 'ckeditor5/ckeditor5-content.css';
import '../assets/sass/rich-text.scss';

// Plain text of stored rich text, one line per block, for compact previews.
function toPlainText(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  doc.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr, figcaption').forEach((el) => el.append('\n'));
  return (doc.body.textContent ?? '').replace(/\n{2,}/g, '\n').trim();
}

// Renders stored rich text (already sanitized server-side) with CKEditor's own
// content styles, so it looks the same as it did in the editor. With `lines`,
// shows a plain-text preview clamped to that many lines with an ellipsis
// (tables, images and formatting are dropped); hover shows the full text.
export default function RichText({ html, as: Tag = 'div', lines }: { html: string; as?: 'div' | 'dd' | 'span'; lines?: number }) {
  if (lines) {
    const text = toPlainText(html);
    return (
      <Tag className="rich-text-preview" style={{ WebkitLineClamp: lines }} title={text}>
        {text}
      </Tag>
    );
  }
  return <Tag className="ck-content rich-text" dangerouslySetInnerHTML={{ __html: html }} />;
}
