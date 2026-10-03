import type { EditorConfig } from 'ckeditor5';

// CKEditor's built-in name for itself ("Rich Text Editor"), shown to screen
// readers and as the editing area's label when none is passed — renamed.
export const EDITOR_NAME_TRANSLATIONS: EditorConfig['translations'] = [
  {
    en: {
      dictionary: {
        'Rich Text Editor': 'Details',
        'Rich Text Editor. Editing area: %0': 'Details',
      },
    },
  },
];
