import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Emojis that the agent sometimes inserts look unprofessional in a dive-safety
// context. Match by codepoint, regex-based so we don't have to maintain a list.
// (We strip real pictographs but keep ASCII, math symbols, and inline
// formatting characters intact.)
const PICTOGRAPH_RE = /\p{Extended_Pictographic}/gu;
const THINK_BLOCK_RE = /<think\b[^>]*>[\s\S]*?<\/think\s*>/gi;
const THINK_DANGLING_RE = /<think\b[^>]*>[\s\S]*$/gi;
const THINK_TAG_RE = /<\/?think\b[^>]*>/gi;

function stripEmoji(input) {
  if (!input) return input;
  return input.replace(PICTOGRAPH_RE, '');
}

export function sanitizeModelOutput(input) {
  if (!input) return '';
  return stripEmoji(input)
    .replace(THINK_BLOCK_RE, '')
    .replace(THINK_DANGLING_RE, '')
    .replace(THINK_TAG_RE, '')
    .trim();
}

/**
 * MarkdownResponse — pro-typography wrapper around `react-markdown`.
 *
 * Behavior:
 *  - Strips emoji pictographs so the agent's output reads like a clean
 *    technical reply, not a marketing email.
 *  - Every element is styled via Tailwind utility classes mapped to the
 *    SeaSID design tokens (text-foreground, bg-inset, text-reef for
 *    emphasis, etc.) — no separate `.markdown` stylesheet needed.
 *  - Renders GFM tables, lists, blockquotes, inline code, fenced code
 *    blocks, headings, anchors.
 *  - `dense` mode renders paragraphs as <span> so they fit inside chat
 *    bubbles without margin churn.
 *  - Links open in a new tab with `rel="noopener noreferrer"`.
 */
export default function MarkdownResponse({ children, dense = false, className = '' }) {
  const cleaned = sanitizeModelOutput(typeof children === 'string' ? children : '');

  return (
    <div
      className={[
        'markdown text-sm leading-relaxed text-foreground',
        'break-words [&>*+*]:mt-2.5',
        className,
      ].join(' ')}
      data-testid="markdown-response"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (dense ? <span>{children}</span> : <p>{children}</p>),
          h1: ({ children }) => (
            <h1 className="text-base font-semibold tracking-tight text-foreground">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-semibold tracking-tight text-foreground">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-xs font-semibold text-foreground">{children}</h4>
          ),
          ul: ({ children }) => (
            <ul className="my-0 flex list-disc flex-col gap-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-0 flex list-decimal flex-col gap-1 pl-5">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="m-0 [&::marker]:text-muted-foreground">{children}</li>
          ),
          code: ({ inline, className: cls, children, ...props }) => {
            if (inline) {
              return (
                <code
                  className="rounded border border-border bg-inset px-1 py-px font-mono text-[0.92em] text-foreground"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={cls} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-md border border-border bg-inset p-3 font-mono text-xs leading-relaxed text-foreground">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="m-0 rounded-r-md border-l-2 border-reef bg-reef/10 px-3 py-1.5 text-xs italic text-muted-foreground">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-inset">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border-b border-border px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border px-2.5 py-1.5 text-foreground last:border-b-0">
              {children}
            </td>
          ),
          hr: () => <hr className="my-3 h-px border-0 bg-border" />,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-reef underline decoration-reef/40 underline-offset-2 hover:decoration-reef"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
        }}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}
