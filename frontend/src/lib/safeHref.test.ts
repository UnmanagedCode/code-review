import { describe, expect, test } from 'vitest';
import { safeHref } from './safeHref';

describe('safeHref', () => {
  test.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'file:///etc/passwd'])(
    'refuses %s',
    (u) => expect(safeHref(u)).toBeNull(),
  );

  // Without a base, a relative or protocol-relative string is not a URL, so it cannot resolve against the page's origin.
  test.each(['//evil.com/x', 'foo/bar', '/pluginBridge.js', '?x=1'])('refuses the relative reference %s', (u) => expect(safeHref(u)).toBeNull());

  test.each(['https://example.com/a?b=1', 'http://example.com', 'mailto:a@example.com'])('allows %s', (u) =>
    expect(safeHref(u)).not.toBeNull(),
  );
});
