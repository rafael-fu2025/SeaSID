import ReactMarkdown from 'react-markdown';

// Emojis that the agent sometimes inserts and that look unprofessional in a
// dive-safety context. Match by codepoint, regex-based so we don't have to
// maintain a list. (We strip real pictographs but keep ASCII, math symbols,
// and inline formatting characters intact.)
const PICTOGRAPH_RE = /\p{Extended_Pictographic}/gu;

function stripEmoji(input) {
  if (!input) return input;
  return input.replace(PICTOGRAPH_RE, '');
}

/**
 * MarkdownResponse — pro-typography wrapper around `react-markdown`.
 *
 * Behavior:
 *  - Strips emoji pictographs (🤿, ⚠️, 🏆, ⭐, etc.) so the agent's output
 *    reads like a clean technical reply, not a marketing email.
 *  - Renders GFM tables, lists, blockquotes, inline code, fenced code
 *    blocks, headings, anchors. All styled via .markdown in index.css.
 *  - Force `p` to render as <span> when nested inside a chat bubble so the
 *    markdown doesn't add extra <p> margins around already-tight bubbles.
 *  - Links open in a new tab with `rel="noopener noreferrer"`.
 */
export default function MarkdownResponse({ children, dense = false, className = '' }) {
  const cleaned = stripEmoji(typeof children === 'string' ? children : '');

  return (
    <div className={`markdown ${dense ? 'markdown--dense' : ''} ${className}`}>
      <ReactMarkdown
        components={{
          // keep bubbles tight — render paragraphs as spans in chat density
          p: ({ children }) => (dense ? <span>{children}</span> : <p>{children}</p>),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}
