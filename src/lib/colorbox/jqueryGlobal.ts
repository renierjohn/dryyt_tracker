import $ from 'jquery';

// jquery-colorbox is a classic plugin that reads a global `jQuery`; this module
// is imported right before it (see ./load.ts) so the global exists in time.
(window as unknown as { jQuery: JQueryStatic }).jQuery = $;

export default $;
