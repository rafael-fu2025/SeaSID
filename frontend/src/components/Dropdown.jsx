import { useState, useRef, useEffect, useId } from 'react';
import { CheckIcon, ChevronDownIcon } from './icons';

/**
 * Dropdown — controlled-style headless select with full keyboard navigation.
 *
 * Props:
 *   value:        current value (string|number)
 *   onChange:     (value) => void
 *   options:      [{ value, label, description? }]
 *   placeholder?: string
 *   className?:   extra classes for the outer wrapper
 *   ariaLabel?:   string
 */
export default function Dropdown({
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  className,
  ariaLabel,
  id,
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const autoId = useId();
  const menuId = id ? `${id}-menu` : `${autoId}-menu`;

  const selected = options.find((o) => o.value === value);
  const selectedIndex = options.findIndex((o) => o.value === value);

  // Outside-click + Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Reset highlight when opening
  useEffect(() => {
    if (open) {
      setHighlight(selectedIndex >= 0 ? selectedIndex : 0);
      // Focus the menu for keyboard nav
      requestAnimationFrame(() => menuRef.current?.focus());
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (idx) => {
    const o = options[idx];
    if (!o) return;
    onChange?.(o.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(options.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(highlight);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setHighlight(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setHighlight(options.length - 1);
    }
  };

  return (
    <div
      ref={wrapRef}
      className={`dropdown ${open ? 'is-open' : ''} ${className || ''}`}
    >
      <button
        ref={triggerRef}
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={ariaLabel}
        className="dropdown__trigger"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        data-testid={id ? `dropdown-${id}` : undefined}
      >
        <span>{selected ? selected.label : placeholder}</span>
        {selected?.description && (
          <span className="dropdown__option-meta">{selected.description}</span>
        )}
      </button>

      {open && (
        <ul
          ref={menuRef}
          id={menuId}
          role="listbox"
          tabIndex={-1}
          className="dropdown__menu"
          aria-label={ariaLabel}
          onKeyDown={onKeyDown}
        >
          {options.map((o, i) => (
            <li key={o.value} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`dropdown__option ${i === highlight ? 'is-highlighted' : ''} ${
                  o.value === value ? 'is-selected' : ''
                }`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(i)}
                data-testid={`dropdown-option-${o.value}`}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span>{o.label}</span>
                  {o.description && (
                    <span className="dropdown__option-meta">{o.description}</span>
                  )}
                </span>
                {o.value === value && <CheckIcon size={14} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
