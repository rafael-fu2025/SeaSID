/**
 * SiteSelector — single-line select styled to match the design system.
 */
export default function SiteSelector({ sites = [], value, onChange, id = 'site-selector' }) {
  return (
    <select
      className="select"
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Select dive site"
      data-testid="site-selector"
    >
      {sites.map((site) => (
        <option key={site.key} value={site.key}>
          {site.name}
        </option>
      ))}
    </select>
  );
}
