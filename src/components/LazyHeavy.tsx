import { lazy, Suspense, type ComponentProps } from 'react';

// plugins/sdk.ts is a barrel that eagerly-loaded plugin slots (e.g. the theme
// plugin's ThemeApplier) import from. Re-exporting CKEditor components
// there statically would drag those libs into the entry chunk, so the SDK
// exposes these lazy wrappers instead — each lib loads only when rendered.
const RichTextEditorImpl = lazy(() => import('./RichTextEditor'));
const StoreInfoImpl = lazy(() => import('./StoreInfo'));

export function RichTextEditor(props: ComponentProps<typeof RichTextEditorImpl>) {
  return (
    <Suspense fallback={null}>
      <RichTextEditorImpl {...props} />
    </Suspense>
  );
}

export function StoreInfo(props: ComponentProps<typeof StoreInfoImpl>) {
  return (
    <Suspense fallback={null}>
      <StoreInfoImpl {...props} />
    </Suspense>
  );
}
