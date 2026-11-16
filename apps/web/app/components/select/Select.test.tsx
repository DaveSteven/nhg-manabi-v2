import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Select, type SelectItems } from "./Select";

const FRUITS = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
  { value: "cherry", label: "Cherry", disabled: true },
  { value: "date", label: "Date" },
];

const GROUPS = [
  { label: "N1", options: [{ value: "2025-12", label: "2025年12月" },
                           { value: "2025-07", label: "2025年7月" }] },
  { label: "N2", options: [{ value: "2024-12", label: "2024年12月" }] },
];

function Harness({ items = FRUITS, initial = "", ...rest }: {
  items?: SelectItems;
  initial?: string;
  searchable?: boolean;
  disabled?: boolean;
  onChange?: (v: string) => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <>
      <span id="lbl">水果</span>
      <Select aria-labelledby="lbl" value={v} items={items}
              placeholder="请选择"
              {...rest}
              onChange={(x) => { setV(x); rest.onChange?.(x); }} />
      <button type="button">other</button>
    </>
  );
}

const trigger = () => screen.getByRole("combobox", { name: "水果" });

afterEach(() => vi.restoreAllMocks());

describe("Select · single", () => {
  it("is a combobox showing the placeholder, closed by default", () => {
    render(<Harness />);
    expect(trigger()).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).toHaveTextContent("请选择");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("renders the popover in a body portal, not inside clipping ancestors", async () => {
    const user = userEvent.setup();
    render(<div data-testid="clip" style={{ overflow: "hidden", height: 10 }}>
      <Harness /></div>);
    await user.click(trigger());
    const list = screen.getByRole("listbox");
    expect(screen.getByTestId("clip")).not.toContainElement(list);
    expect(list.closest(".popover")?.parentElement).toBe(document.body);
    expect(list.closest(".popover")).toHaveStyle({ position: "fixed" });
  });

  it("marks the selected option with aria-selected and a check mark", async () => {
    const user = userEvent.setup();
    render(<Harness initial="banana" />);
    await user.click(trigger());
    const sel = screen.getByRole("option", { name: "Banana" });
    expect(sel).toHaveAttribute("aria-selected", "true");
    expect(sel.querySelector(".select-check")).not.toBeNull();
    expect(screen.getByRole("option", { name: "Apple" }))
      .toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("option", { name: "Apple" })
      .querySelector(".select-check")).toBeNull();
  });

  it("clicking an option selects it, closes, and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(trigger());
    await user.click(screen.getByRole("option", { name: "Date" }));
    expect(onChange).toHaveBeenCalledWith("date");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger()).toHaveTextContent("Date");
    expect(trigger()).toHaveFocus();
  });

  it("disabled options cannot be chosen", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(trigger());
    await user.click(screen.getByRole("option", { name: "Cherry" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Cherry" }))
      .toHaveAttribute("aria-disabled", "true");
  });

  it("a disabled select does not open", async () => {
    const user = userEvent.setup();
    render(<Harness disabled />);
    await user.click(trigger());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("keyboard: open, move (skipping disabled), select with Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    trigger().focus();
    await user.keyboard("{ArrowDown}");
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    const id = () => trigger().getAttribute("aria-activedescendant");
    expect(document.getElementById(id()!)).toHaveTextContent("Apple");
    await user.keyboard("{ArrowDown}");
    expect(document.getElementById(id()!)).toHaveTextContent("Banana");
    await user.keyboard("{ArrowDown}"); // Cherry is disabled → Date
    expect(document.getElementById(id()!)).toHaveTextContent("Date");
    await user.keyboard("{ArrowDown}"); // stays at the end
    expect(document.getElementById(id()!)).toHaveTextContent("Date");
    await user.keyboard("{Home}");
    expect(document.getElementById(id()!)).toHaveTextContent("Apple");
    await user.keyboard("{End}");
    expect(document.getElementById(id()!)).toHaveTextContent("Date");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("date");
    expect(trigger()).toHaveFocus();
  });

  it("opens on the current value; Space selects", async () => {
    const user = userEvent.setup();
    render(<Harness initial="banana" />);
    trigger().focus();
    await user.keyboard("{Enter}");
    const active = document.getElementById(
      trigger().getAttribute("aria-activedescendant")!);
    expect(active).toHaveTextContent("Banana");
    await user.keyboard("{ArrowUp}{ }");
    expect(trigger()).toHaveTextContent("Apple");
  });

  it("typing a letter jumps to the matching option", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    trigger().focus();
    await user.keyboard("b");
    const active = document.getElementById(
      trigger().getAttribute("aria-activedescendant")!);
    expect(active).toHaveTextContent("Banana");
  });

  it("Esc closes and restores focus; Tab closes without trapping", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.tab();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "other" })).toHaveFocus();
  });

  it("is a popover, not a modal: no overlay, outside press closes it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    expect(document.querySelector(".modal-overlay")).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // the rest of the page stays usable while it's open
    await user.click(screen.getByRole("button", { name: "other" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "other" })).toHaveFocus();
  });

  it("Esc closes only the popover, not a surrounding Modal's Esc handler", async () => {
    const user = userEvent.setup();
    const modalEsc = vi.fn();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") modalEsc(); };
    document.addEventListener("keydown", onKey);
    try {
      render(<Harness />);
      await user.click(trigger());
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(modalEsc).not.toHaveBeenCalled();
      // with nothing open, Esc still reaches the modal
      await user.keyboard("{Escape}");
      expect(modalEsc).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", onKey);
    }
  });

  it("flips above the trigger and caps height near the viewport bottom", async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(180);
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
    render(<Harness />);
    vi.spyOn(trigger(), "getBoundingClientRect").mockReturnValue({
      top: 720, bottom: 764, left: 100, right: 300, width: 200, height: 44,
      x: 100, y: 720, toJSON() { return {}; } });
    await user.click(trigger());
    const pop = screen.getByRole("listbox").closest(".popover") as HTMLElement;
    expect(pop.dataset.side).toBe("top");
    // natural 300px is capped to the 250px popover maximum
    expect(pop.style.maxHeight).toBe("250px");
    expect(parseFloat(pop.style.top) + 250).toBeLessThanOrEqual(720);
  });
});

describe("Select · text variant", () => {
  it("is outlined by default and borderless/transparent in text mode", () => {
    const { rerender } = render(
      <Select aria-label="v" value="a" items={[{ value: "a", label: "A" }]}
              onChange={() => {}} />);
    expect(screen.getByRole("combobox", { name: "v" }))
      .not.toHaveClass("select-trigger--text");
    rerender(<Select variant="text" aria-label="v" value="a"
                     items={[{ value: "a", label: "A" }]} onChange={() => {}} />);
    expect(screen.getByRole("combobox", { name: "v" }))
      .toHaveClass("select-trigger", "select-trigger--text");
  });

  it("still opens and selects like the outlined variant", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select variant="text" aria-label="v" value="a" onChange={onChange}
                   items={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />);
    await user.click(screen.getByRole("combobox", { name: "v" }));
    await user.click(screen.getByRole("option", { name: "B" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });
});

describe("Select · width", () => {
  it("follows the content by default and honours an explicit width", () => {
    const { rerender } = render(
      <Select aria-label="w" value="a" items={[{ value: "a", label: "A" }]}
              onChange={() => {}} />);
    const t = screen.getByRole("combobox", { name: "w" });
    expect(t.style.width).toBe("");
    rerender(<Select aria-label="w" width={240} value="a"
                     items={[{ value: "a", label: "A" }]} onChange={() => {}} />);
    expect(screen.getByRole("combobox", { name: "w" }).style.width).toBe("240px");
    rerender(<Select aria-label="w" width="100%" value="a"
                     items={[{ value: "a", label: "A" }]} onChange={() => {}} />);
    expect(screen.getByRole("combobox", { name: "w" }).style.width).toBe("100%");
  });
});

describe("Select · popover height", () => {
  it("caps the popover at 250px by default and lets the list scroll inside", async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(180);
    Object.defineProperty(window, "innerHeight", { value: 1200, configurable: true });
    const many = Array.from({ length: 30 }, (_, i) =>
      ({ value: String(i), label: `Item ${i}` }));
    render(<Harness items={many} />);
    await user.click(trigger());
    const pop = screen.getByRole("listbox").closest(".popover") as HTMLElement;
    expect(pop.style.maxHeight).toBe("250px");
    expect(screen.getByRole("listbox")).toHaveClass("select-list");
  });

  it("popoverMaxHeight overrides the cap", async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(180);
    Object.defineProperty(window, "innerHeight", { value: 1200, configurable: true });
    render(<Select aria-label="m" value="" popoverMaxHeight={320}
                   items={Array.from({ length: 30 }, (_, i) =>
                     ({ value: String(i), label: `Item ${i}` }))}
                   onChange={() => {}} />);
    await user.click(screen.getByRole("combobox", { name: "m" }));
    const pop = screen.getByRole("listbox").closest(".popover") as HTMLElement;
    expect(pop.style.maxHeight).toBe("320px");
  });
});

describe("Select · grouped", () => {
  it("renders labelled groups; keyboard crosses groups", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness items={GROUPS} onChange={onChange} />);
    await user.click(trigger());
    const groups = screen.getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["N1", "N2"]);
    expect(within(groups[0]!).getAllByRole("option")).toHaveLength(2);
    expect(within(groups[1]!).getAllByRole("option")).toHaveLength(1);
    // group headings are not options
    expect(screen.getAllByRole("option")).toHaveLength(3);
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("2024-12");
  });
});

describe("Select · searchable", () => {
  it("focuses the search box on open and filters case-insensitively", async () => {
    const user = userEvent.setup();
    render(<Harness searchable />);
    await user.click(trigger());
    const search = screen.getByRole("searchbox", { name: "搜索" });
    expect(search).toHaveFocus();
    await user.keyboard("AN");
    expect(screen.getAllByRole("option").map((o) => o.textContent))
      .toEqual(["Banana"]);
  });

  it("shows an empty state and selects nothing on Enter when no match", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness searchable onChange={onChange} />);
    await user.click(trigger());
    await user.keyboard("zzz{Enter}");
    expect(screen.getByText("无匹配项")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("arrows + Enter pick from the filtered list; query resets on close", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness searchable onChange={onChange} />);
    await user.click(trigger());
    await user.keyboard("a{ArrowDown}{Enter}");
    // matches: Apple, Banana, Date(a) → second is Banana
    expect(onChange).toHaveBeenCalledWith("banana");
    expect(trigger()).toHaveFocus();
    await user.click(trigger());
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("space types into the search box instead of selecting", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness searchable onChange={onChange} />);
    await user.click(trigger());
    await user.keyboard("a b");
    expect(screen.getByRole("searchbox")).toHaveValue("a b");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Enter during IME composition does not select", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness searchable onChange={onChange} />);
    await user.click(trigger());
    const search = screen.getByRole("searchbox");
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true,
      cancelable: true, isComposing: true });
    search.dispatchEvent(ev);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("Esc from the search box closes and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness searchable />);
    await user.click(trigger());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("grouped + searchable hides groups without matches", async () => {
    const user = userEvent.setup();
    render(<Harness items={GROUPS} searchable />);
    await user.click(trigger());
    await user.keyboard("2024");
    expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-label")))
      .toEqual(["N2"]);
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
});
