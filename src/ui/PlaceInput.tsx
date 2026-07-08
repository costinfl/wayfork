import { useEffect, useState } from "react";
import { searchPlaces } from "../domain/geocode";
import type { Place } from "../domain/types";
import { C, mono } from "./theme";

const inputStyle = { border: `1px solid ${C.border}`, background: "#fff" };

const fmtCoord = (n: number): string => Number(n.toFixed(4)).toString();

export type SearchFn = (query: string) => Promise<Place[]>;

// Autocomplete field bound to the Open-Meteo place search. A selected place is
// the source of truth (name + lat/lon); the visible text is a query buffer.
// Clearing the text nulls the selection — the "no location" state.
export function PlaceInput({
  label,
  placeholder,
  value,
  onChange,
  search = searchPlaces,
}: {
  label: string;
  placeholder: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
  search?: SearchFn;
}) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const q = query.trim();
    // Already showing the chosen place's name — nothing to search for.
    if (value && q === value.name) {
      setOpen(false);
      setSuggestions([]);
      return;
    }
    if (q.length < 2) {
      setOpen(false);
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      search(q).then((results) => {
        if (cancelled) return;
        setSuggestions(results);
        setActive(0);
        setOpen(results.length > 0);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, value, search]);

  const choose = (p: Place) => {
    onChange(p);
    setQuery(p.name);
    setSuggestions([]);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(suggestions[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <label className="text-xs block relative" style={{ color: C.sub }}>
      {label}
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (value && e.target.value !== value.name) onChange(null);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        className="w-full rounded px-2 py-1.5 text-sm mt-0.5"
        style={inputStyle}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && (
        <ul
          role="listbox"
          className="absolute z-10 left-0 right-0 mt-1 rounded-md overflow-hidden shadow-lg"
          style={{ background: C.card, border: `1px solid ${C.border}` }}
        >
          {suggestions.map((p, i) => (
            <li key={`${p.name}-${p.lat}-${p.lon}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(p);
                }}
                onMouseEnter={() => setActive(i)}
                className="block w-full text-left px-2 py-1.5 text-sm"
                style={{ background: i === active ? C.lineSoft : C.card, color: C.ink }}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {value && query === value.name && (
        <div className="text-xs mt-0.5" style={{ color: C.ghost, ...mono }}>
          📍 {fmtCoord(value.lat)}, {fmtCoord(value.lon)}
        </div>
      )}
    </label>
  );
}
