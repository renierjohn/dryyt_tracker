import { useId, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import '../assets/sass/autocomplete.scss';

export interface AutocompleteOption {
  id: number | string;
  // What the input is set to when the option is picked.
  value: string;
  label: string;
  detail?: string | null;
}

const MAX_SHOWN = 8;

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

// Styled replacement for <input list> + <datalist>: same free-text input, with
// a suggestion dropdown (name + detail line) that filters as you type. Picking
// a suggestion calls onChange with its value, just like choosing a datalist option.
export default function Autocomplete({
  value,
  onChange,
  options,
  ...inputProps
}: {
  value: string;
  onChange: (value: string) => void;
  options: AutocompleteOption[];
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'list' | 'role'>) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const query = value.trim().toLowerCase();
  const matches = options
    .filter((o) => o.value !== value && `${o.label} ${o.detail ?? ''}`.toLowerCase().includes(query))
    .slice(0, MAX_SHOWN);
  const expanded = open && matches.length > 0;

  function pick(option: AutocompleteOption) {
    onChange(option.value);
    setOpen(false);
    setActive(-1);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (matches.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + matches.length) % matches.length);
    } else if (e.key === 'Enter' && expanded && active >= 0) {
      e.preventDefault();
      pick(matches[active]);
    } else if (e.key === 'Escape' && expanded) {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <span className="autocomplete">
      <input
        {...inputProps}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={(e) => {
          setOpen(true);
          inputProps.onFocus?.(e);
        }}
        onBlur={(e) => {
          setOpen(false);
          inputProps.onBlur?.(e);
        }}
        onKeyDown={handleKeyDown}
      />
      {expanded && (
        <ul className="autocomplete__list" id={listId} role="listbox">
          {matches.map((o, i) => (
            <li
              key={o.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`autocomplete__option${i === active ? ' autocomplete__option--active' : ''}`}
              // mousedown, not click: fires before the input's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="autocomplete__avatar" aria-hidden="true">{initials(o.label)}</span>
              <span className="autocomplete__text">
                <span className="autocomplete__label">{o.label}</span>
                {o.detail && <span className="autocomplete__detail">{o.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
