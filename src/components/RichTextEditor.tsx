import { CKEditor } from '@ckeditor/ckeditor5-react';
import {
  ClassicEditor,
  Alignment,
  Autoformat,
  AutoLink,
  BlockQuote,
  Bold,
  Code,
  CodeBlock,
  Essentials,
  FindAndReplace,
  FontBackgroundColor,
  FontColor,
  FontFamily,
  FontSize,
  Fullscreen,
  Heading,
  Highlight,
  HorizontalLine,
  Image,
  ImageCaption,
  ImageInsertViaUrl,
  ImageResize,
  ImageStyle,
  ImageToolbar,
  Indent,
  IndentBlock,
  Italic,
  Link,
  List,
  ListProperties,
  Paragraph,
  PasteFromOffice,
  RemoveFormat,
  SelectAll,
  ShowBlocks,
  SourceEditing,
  SpecialCharacters,
  SpecialCharactersEssentials,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  TableCaption,
  TableCellProperties,
  TableColumnResize,
  TableProperties,
  TableToolbar,
  TextTransformation,
  TodoList,
  Underline,
  type EditorConfig,
} from 'ckeditor5';
import 'ckeditor5/ckeditor5.css';
import { EDITOR_NAME_TRANSLATIONS } from '../lib/editorTranslations';
import '../assets/sass/rich-text.scss';

// The full open-source (GPL) CKEditor 5 toolbar. Everything it can emit is kept
// by the server's 'rich' sanitize profile (worker/sanitize.ts). Left out on
// purpose: image *upload* (no storage for it — images are inserted by URL),
// media embeds (<oembed> needs a third-party renderer), HTML embeds, and
// plugins that need extra services or config (emoji, mentions, styles).
const CONFIG: EditorConfig = {
  licenseKey: 'GPL',
  translations: EDITOR_NAME_TRANSLATIONS,
  plugins: [
    Alignment, Autoformat, AutoLink, BlockQuote, Bold, Code, CodeBlock, Essentials, FindAndReplace,
    FontBackgroundColor, FontColor, FontFamily, FontSize, Fullscreen, Heading, Highlight, HorizontalLine,
    Image, ImageCaption, ImageInsertViaUrl, ImageResize, ImageStyle, ImageToolbar, Indent, IndentBlock,
    Italic, Link, List, ListProperties, Paragraph, PasteFromOffice, RemoveFormat, SelectAll, ShowBlocks,
    SourceEditing, SpecialCharacters, SpecialCharactersEssentials, Strikethrough, Subscript, Superscript,
    Table, TableCaption, TableCellProperties, TableColumnResize, TableProperties, TableToolbar,
    TextTransformation, TodoList, Underline,
  ],
  toolbar: {
    items: [
      'undo', 'redo', '|',
      'heading', '|',
      'fontSize', 'fontFamily', 'fontColor', 'fontBackgroundColor', '|',
      'bold', 'italic', 'underline', 'strikethrough', 'subscript', 'superscript', 'code', 'removeFormat', '|',
      'link', 'insertImageViaUrl', 'insertTable', 'blockQuote', 'codeBlock', 'horizontalLine', 'highlight',
      'specialCharacters', '|',
      'alignment', '|',
      'bulletedList', 'numberedList', 'todoList', 'outdent', 'indent', '|',
      'findAndReplace', 'selectAll', 'showBlocks', 'sourceEditing', 'fullscreen',
    ],
    // Overflowing items collapse into a "⋮" menu on narrow screens.
    shouldNotGroupWhenFull: false,
  },
  image: {
    toolbar: ['imageTextAlternative', 'toggleImageCaption', '|', 'imageStyle:inline', 'imageStyle:block', 'imageStyle:side'],
  },
  table: {
    contentToolbar: ['tableColumn', 'tableRow', 'mergeTableCells', 'tableProperties', 'tableCellProperties', 'toggleTableCaption'],
  },
  list: {
    properties: { styles: true, startIndex: true, reversed: true },
  },
  link: {
    addTargetToExternalLinks: true,
    defaultProtocol: 'https://',
  },
};

export type RichTextEditorInstance = ClassicEditor;

export default function RichTextEditor({
  initialData = '',
  label,
  placeholder,
  onChange,
  onReady,
}: {
  initialData?: string;
  // Accessible name for the editable area.
  label?: string;
  placeholder?: string;
  onChange: (html: string) => void;
  // For callers that need to set content imperatively (reset, insert text).
  onReady?: (editor: RichTextEditorInstance) => void;
}) {
  return (
    <div className="rich-text-editor">
      <CKEditor
        editor={ClassicEditor}
        data={initialData}
        config={{ ...CONFIG, placeholder, label }}
        onReady={(editor) => onReady?.(editor)}
        onChange={(_event, editor) => onChange(editor.getData())}
      />
    </div>
  );
}
