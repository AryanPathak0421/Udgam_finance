import { Children, Fragment, isValidElement, useEffect, useMemo, useRef, useState } from 'react';

// A drop-in for <select> that can be searched: it takes the same <option> children, `value`, `disabled`, `id`, `aria-label`, `style`
// and an `onChange` that is called like a select's (`event.target.value`). Click it and type to narrow the list; arrow keys and Enter
// choose, Escape closes. The empty-value option (the placeholder) stays at the top to clear the choice.

const textOf = (node) => {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf(node.props.children);
  return String(node);
};

function optionsOf(children) {
  const out = [];
  const walk = (nodes) => {
    Children.forEach(nodes, (child) => {
      if (!isValidElement(child)) return;
      if (child.type === Fragment) walk(child.props.children);
      else if (child.type === 'option') out.push({ value: String(child.props.value ?? textOf(child.props.children)), label: textOf(child.props.children), disabled: Boolean(child.props.disabled) });
    });
  };
  walk(children);
  return out;
}

export default function SearchableSelect({ id, value, onChange, disabled, children, style, className = '', 'aria-label': ariaLabel, placeholder }) {
  const options = useMemo(() => optionsOf(children), [children]);
  const current = options.find((o) => o.value === String(value ?? ''));
  const empty = options.find((o) => o.value === '');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef(null);
  const input = useRef(null);

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = options.filter((o) => o.value !== '' && words.every((w) => o.label.toLowerCase().includes(w)));
  const list = empty && !query ? [empty, ...shown] : shown;

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  useEffect(() => setActive(0), [query, open]);

  function choose(o) {
    if (!o || o.disabled) return;
    onChange?.({ target: { value: o.value, id } });
    setOpen(false);
    setQuery('');
  }

  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, list.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open) { e.preventDefault(); choose(list[active]); }
    else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  }

  return (
    <div className={`ss ${className}`} style={style} ref={box}>
      <input
        id={id}
        ref={input}
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        autoComplete="off"
        className="ss-input"
        disabled={disabled}
        placeholder={open ? 'Type to search…' : (placeholder || empty?.label || '')}
        value={open ? query : (current && current.value !== '' ? current.label : '')}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={onKey}
      />
      <span className="ss-caret" aria-hidden="true">▾</span>
      {open && !disabled && (
        <ul className="ss-list" role="listbox">
          {list.length === 0 && <li className="ss-none">Nothing matches “{query}”</li>}
          {list.map((o, i) => (
            <li
              key={o.value || '__empty'}
              role="option"
              aria-selected={o.value === String(value ?? '')}
              className={`ss-opt${i === active ? ' active' : ''}${o.value === String(value ?? '') ? ' picked' : ''}${o.value === '' ? ' muted' : ''}${o.disabled ? ' off' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); choose(o); }}
              onMouseEnter={() => setActive(i)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
