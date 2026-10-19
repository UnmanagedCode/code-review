// Markdown AST -> React elements: the only renderer of message bodies, and so
// the security boundary for them (the page runs same-origin with cc, whose API
// has no auth). Elements come from the fixed node-type -> tag switch below;
// AST content lands only as text children or as the typed props written here,
// never spread into props. No `style` prop is ever set. A link renders only
// when `safeHref` accepts its href again here; a citation's href comes from
// the route serialiser.
import { Fragment, useMemo, type ReactNode } from 'react';
import { RouteLink } from '@/components/RouteLink';
import { parseMarkdown, type Block, type Inline } from '@/lib/markdown';
import { formatLines } from '@/lib/route';
import { safeHref } from '@/lib/safeHref';
import type { Citation } from '@/lib/types';

function inlines(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text': return n.v;
      case 'br': return <br key={i} />;
      case 'code': return <code key={i}>{inlines(n.c)}</code>;
      case 'em': return <em key={i}>{inlines(n.c)}</em>;
      case 'strong': return <strong key={i}>{inlines(n.c)}</strong>;
      case 'del': return <del key={i}>{inlines(n.c)}</del>;
      case 'link': {
        const href = safeHref(n.href);
        if (!href) return <Fragment key={i}>{inlines(n.c)}</Fragment>;
        return <a key={i} href={href} target="_blank" rel="noopener noreferrer">{inlines(n.c)}</a>;
      }
      case 'cite':
        return (
          <RouteLink key={i} to={{ file: n.path, side: 'new', lines: formatLines(n.start, n.end), thread: undefined }} className="font-mono text-primary underline underline-offset-2">
            {inlines(n.c)}
          </RouteLink>
        );
    }
  });
}

const ALIGN_CLASS = { left: 'md-align-left', center: 'md-align-center', right: 'md-align-right' } as const;

function blocks(nodes: Block[], tight = false): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'p': return tight ? <Fragment key={i}>{inlines(n.c)}</Fragment> : <p key={i}>{inlines(n.c)}</p>;
      case 'h': {
        const H = (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const)[n.level - 1];
        return <H key={i}>{inlines(n.c)}</H>;
      }
      case 'pre': return <pre key={i}><code>{n.text}</code></pre>;
      case 'ul': return <ul key={i}>{n.items.map((it, j) => <li key={j}>{blocks(it, n.tight)}</li>)}</ul>;
      case 'ol': return <ol key={i} start={n.start}>{n.items.map((it, j) => <li key={j}>{blocks(it, n.tight)}</li>)}</ol>;
      case 'quote': return <blockquote key={i}>{blocks(n.c)}</blockquote>;
      case 'table': {
        const cls = (c: number) => { const a = n.align[c]; return a ? ALIGN_CLASS[a] : undefined; };
        return (
          <div key={i} className="md-table">
            <table>
              <thead><tr>{n.head.map((c, j) => <th key={j} className={cls(j)}>{inlines(c)}</th>)}</tr></thead>
              <tbody>{n.rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className={cls(j)}>{inlines(c)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      }
      case 'hr': return <hr key={i} />;
    }
  });
}

/** A parsed body. Renders any AST through the same fixed tag map and link checks. */
export function MarkdownBlocks({ ast }: { ast: Block[] }) {
  return <div className="md">{blocks(ast)}</div>;
}

/** A message body rendered as markdown. Only `citations` (the server's list for this body) become in-app citation links. */
export function Markdown({ body, citations }: { body: string; citations: Citation[] }) {
  const ast = useMemo(() => parseMarkdown(body, citations), [body, citations]);
  return <MarkdownBlocks ast={ast} />;
}
