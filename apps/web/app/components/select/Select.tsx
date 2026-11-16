import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Popover } from "./Popover";

/**
 * Select (select-spec.md): Single / Grouped / Searchable, one component.
 * Trigger is a `role="combobox"` button; the listbox lives in a Popover.
 */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}
export interface SelectGroup {
  label: string;
  options: SelectOption[];
}
export type SelectItems = SelectOption[] | SelectGroup[];

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  items: SelectItems;
  size?: "default" | "compact" | "large";
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  popoverMinWidth?: number;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

interface FlatOption extends SelectOption {
  group: string | null;
  /** index in the full (unfiltered) flat list — stable for element ids */
  index: number;
}

function isGroups(items: SelectItems): items is SelectGroup[] {
  return items.length > 0 && "options" in (items[0] as object);
}

function flatten(items: SelectItems): FlatOption[] {
  const out: FlatOption[] = [];
  if (isGroups(items)) {
    for (const g of items) {
      for (const o of g.options) out.push({ ...o, group: g.label, index: out.length });
    }
  } else {
    for (const o of items as SelectOption[]) {
      out.push({ ...o, group: null, index: out.length });
    }
  }
  return out;
}

function Chevron() {
  return (
    <svg className="select-chevron" viewBox="0 0 20 20" width="16" height="16"
         fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 7.5 5 5 5-5" />
    </svg>
  );
}

function Check() {
  return (
    <svg className="select-check" viewBox="0 0 20 20" width="16" height="16"
         fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4.5 10.5 3.5 3.5 7.5-8" />
    </svg>
  );
}

export function Select(props: SelectProps) {
  const {
    value, onChange, items, size = "default", placeholder = "请选择",
    disabled = false, searchable = false, searchPlaceholder = "搜索",
    emptyText = "无匹配项", className, popoverMinWidth,
  } = props;
  const uid = useId();
  const listId = `${uid}-list`;
  const optId = (i: number) => `${uid}-opt-${i}`;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ buffer: "", timer: 0 as unknown as number });

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<number | null>(null);
  // keyboard focus ring only while navigating by keyboard (hover = grey)
  const [nav, setNav] = useState<"keyboard" | "pointer">("pointer");

  const all = useMemo(() => flatten(items), [items]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all;
  }, [all, query]);
  const enabled = useMemo(() => visible.filter((o) => !o.disabled), [visible]);
  const selected = all.find((o) => o.value === value);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setQuery("");
    setActive(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const openList = useCallback(() => {
    if (disabled) return;
    const start = selected && !selected.disabled ? selected
      : all.find((o) => !o.disabled);
    setActive(start ? start.index : null);
    setOpen(true);
  }, [disabled, selected, all]);

  const commit = useCallback((o: FlatOption) => {
    if (o.disabled) return;
    onChange(o.value);
    close(true);
  }, [onChange, close]);

  // searchable: move focus into the search box once the popover mounts
  useEffect(() => {
    if (open && searchable) searchRef.current?.focus();
  }, [open, searchable]);

  // keep the highlighted option in view
  useEffect(() => {
    if (!open || active === null) return;
    const el = document.getElementById(optId(active));
    el?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  // if the filter hides the highlighted option, fall to the first match
  useEffect(() => {
    if (!open) return;
    if (active === null || !enabled.some((o) => o.index === active)) {
      setActive(enabled[0]?.index ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, open]);

  const move = (delta: 1 | -1 | "first" | "last") => {
    if (enabled.length === 0) return;
    const pos = enabled.findIndex((o) => o.index === active);
    let next: number;
    if (delta === "first") next = 0;
    else if (delta === "last") next = enabled.length - 1;
    else next = pos === -1 ? 0
      : Math.min(Math.max(pos + delta, 0), enabled.length - 1);
    setActive(enabled[next]!.index);
  };

  const jumpByTyping = (ch: string) => {
    const t = typeahead.current;
    window.clearTimeout(t.timer);
    t.buffer += ch.toLowerCase();
    t.timer = window.setTimeout(() => { t.buffer = ""; }, 600);
    const hit = enabled.find((o) => o.label.toLowerCase().startsWith(t.buffer));
    if (hit) setActive(hit.index);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, inSearch: boolean) => {
    if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(e.key)) {
      setNav("keyboard");
    }
    const composing = e.nativeEvent.isComposing || e.keyCode === 229;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      } else if (!searchable && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        openList();
        jumpByTyping(e.key);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); move(1); break;
      case "ArrowUp": e.preventDefault(); move(-1); break;
      case "Home": if (!inSearch) { e.preventDefault(); move("first"); } break;
      case "End": if (!inSearch) { e.preventDefault(); move("last"); } break;
      case "Enter":
      case " ": {
        if (e.key === " " && inSearch) break; // a space is a character there
        if (composing) break;
        e.preventDefault();
        const o = visible.find((x) => x.index === active);
        if (o) commit(o);
        break;
      }
      case "Tab": close(false); break;
      default:
        if (!inSearch && !searchable && e.key.length === 1
            && !e.ctrlKey && !e.metaKey) {
          jumpByTyping(e.key);
        }
    }
  };

  const renderOption = (o: FlatOption) => {
    const isSelected = o.value === value;
    const cls = ["select-option",
      isSelected ? "is-selected" : "",
      active === o.index ? "is-active" : "",
      o.disabled ? "is-disabled" : ""].filter(Boolean).join(" ");
    return (
      <div key={o.index} id={optId(o.index)} role="option"
           aria-selected={isSelected} aria-disabled={o.disabled || undefined}
           className={cls}
           onMouseDown={(e) => e.preventDefault()}
           onMouseMove={() => {
             if (nav !== "pointer") setNav("pointer");
             if (!o.disabled && active !== o.index) setActive(o.index);
           }}
           onClick={() => commit(o)}>
        <span className="select-option-label">{o.label}</span>
        {isSelected ? <Check /> : null}
      </div>
    );
  };

  const body = () => {
    if (visible.length === 0) {
      return <div className="select-empty" role="presentation">{emptyText}</div>;
    }
    if (!isGroups(items)) return visible.map(renderOption);
    const labels = [...new Set(visible.map((o) => o.group))];
    return labels.map((g, gi) => (
      <div key={gi} role="group" aria-label={g ?? undefined}
           className="select-group">
        <div className="select-group-label" aria-hidden="true">{g}</div>
        {visible.filter((o) => o.group === g).map(renderOption)}
      </div>
    ));
  };

  const activeId = open && active !== null ? optId(active) : undefined;
  const label = selected?.label;

  return (
    <>
      <button ref={triggerRef} type="button" role="combobox"
              className={["select-trigger",
                size === "compact" ? "select-trigger--compact" : "",
                size === "large" ? "select-trigger--large" : "",
                open ? "is-open" : "", className ?? ""].filter(Boolean).join(" ")}
              aria-haspopup="listbox" aria-expanded={open}
              aria-controls={open ? listId : undefined}
              aria-activedescendant={!searchable ? activeId : undefined}
              aria-label={props["aria-label"]}
              aria-labelledby={props["aria-labelledby"]}
              disabled={disabled}
              onClick={() => { setNav("pointer"); if (open) close(false); else openList(); }}
              onKeyDown={(e) => onKeyDown(e, false)}>
        <span className={label === undefined
          ? "select-value is-placeholder" : "select-value"}>
          {label ?? placeholder}
        </span>
        <Chevron />
      </button>

      <Popover open={open} anchorRef={triggerRef} minWidth={popoverMinWidth}
               className="select-popover"
               onClose={(reason) => close(reason === "escape")}>
        {searchable ? (
          <input ref={searchRef} type="search" className="select-search"
                 aria-label={searchPlaceholder} placeholder={searchPlaceholder}
                 aria-controls={listId} aria-activedescendant={activeId}
                 autoComplete="off" value={query}
                 onChange={(e) => setQuery(e.target.value)}
                 onKeyDown={(e) => onKeyDown(e, true)} />
        ) : null}
        <div ref={listRef} id={listId} role="listbox" className="select-list"
             data-nav={nav}
             aria-label={props["aria-label"]}
             aria-labelledby={props["aria-labelledby"]}>
          {body()}
        </div>
      </Popover>
    </>
  );
}
