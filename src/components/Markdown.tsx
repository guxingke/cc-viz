import { useMemo } from 'react';
import { marked } from 'marked';

marked.use({ gfm: true, breaks: false });

export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => {
    try {
      return marked.parse(source, { async: false }) as string;
    } catch {
      return escapeHtml(source);
    }
  }, [source]);
  return <div className="cc-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
