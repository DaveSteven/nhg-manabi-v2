import { Fragment } from "react";
import {
  parseRichText,
  RichTextChildrenSchema,
  type RichBlock,
} from "./schema";

const MAX_DEPTH = 32;

interface Diagnostics {
  onUnsupported?: (reason: string) => void;
}

/**
 * Safe whitelist renderer for jlptgo-richtext-v1. NEVER uses
 * dangerouslySetInnerHTML. Unknown/malformed nodes and over-deep nesting
 * render an explicit 不支持内容 state and report a diagnostic.
 *
 * Slot integrity is validated against the unit's slot_ids: duplicate slot
 * ids inside one document, or slots missing from the unit, render an
 * explicit error state — never guessed by visual order.
 */
export function RichText({ value, slotIds, onDiagnostic }: {
  value: unknown;
  slotIds?: string[];
  onDiagnostic?: (reason: string) => void;
}) {
  const parsed = parseRichText(value);
  if (!parsed.ok) {
    onDiagnostic?.(parsed.reason);
    return <UnsupportedContent detail={parsed.reason} />;
  }
  const doc = parsed.doc;

  // Slot integrity: collect slot ids in document order.
  const seen = new Set<string>();
  let slotError: string | null = null;
  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_DEPTH || slotError) return;
    if (Array.isArray(node)) {
      node.forEach((n) => walk(n, depth + 1));
      return;
    }
    if (node && typeof node === "object" && (node as { type?: unknown }).type === "slot") {
      const id = (node as { slot_id?: unknown }).slot_id;
      if (typeof id === "string") {
        if (seen.has(id)) {
          slotError = `重复的 slot：${id}`;
          return;
        }
        seen.add(id);
        if (slotIds && !slotIds.includes(id)) {
          slotError = `slot 不属于本题组：${id}`;
          return;
        }
      }
    }
    if (node && typeof node === "object") {
      Object.values(node as Record<string, unknown>).forEach((v) => {
        if (typeof v !== "string") walk(v, depth + 1);
      });
    }
  };
  walk(doc.blocks, 0);
  if (slotError) {
    onDiagnostic?.(slotError);
    return <SlotErrorState detail={slotError} />;
  }

  const diag: Diagnostics = { onUnsupported: onDiagnostic };
  return (
    <div className="richtext">
      {doc.blocks.map((block, i) => (
        <RichBlockView key={i} block={block} depth={0} diag={diag} />
      ))}
    </div>
  );
}

function UnsupportedContent({ detail }: { detail: string }) {
  return (
    <div className="richtext-unsupported" data-testid="richtext-unsupported"
         role="note">
      <p>⚠️ 此内容包含当前版本不支持的部分，已安全跳过。</p>
      {/* 诊断信息给开发通道，不展示给用户 */}<span className="sr-only">{detail}</span>
    </div>
  );
}

function SlotErrorState({ detail }: { detail: string }) {
  return (
    <div className="richtext-slot-error" data-testid="richtext-slot-error"
         role="alert">
      <p>题目填空数据异常，无法作答。请反馈此问题。</p>
      <span className="sr-only">{detail}</span>
    </div>
  );
}

function RichBlockView({ block, depth, diag }: {
  block: RichBlock;
  depth: number;
  diag: Diagnostics;
}) {
  if (depth > MAX_DEPTH) {
    diag.onUnsupported?.("nesting depth exceeded");
    return <UnsupportedContent detail="depth" />;
  }
  switch (block.type) {
    case "paragraph":
      return <p className="richtext-p"><ChildrenView children_={block.children} depth={depth} diag={diag} /></p>;
    case "heading": {
      const level = Math.min(Math.max(block.level ?? 3, 1), 6);
      return <Tag tag={`h${level}`} depth={depth} diag={diag} children_={block.children} />;
    }
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i}><ChildrenView children_={item.children} depth={depth + 1} diag={diag} /></li>
      ));
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case "table":
      return (
        <table className="richtext-table">
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {row.cells.map((cell, c) => <td key={c}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "image":
      // Real image delivery rides the media endpoint; until wired per-
      // asset rendering policy, images render as a labeled placeholder.
      return (
        <figure className="richtext-image-placeholder">
          <div aria-hidden="true">🖼</div>
          {block.alt ? <span>{block.alt}</span> : null}
          {block.caption ? <figcaption>{block.caption}</figcaption> : null}
        </figure>
      );
    default: {
      // Exhaustive per whitelist; a stray shape still lands safely.
      diag.onUnsupported?.(`unknown block ${(block as { type?: unknown }).type}`);
      return <UnsupportedContent detail="block" />;
    }
  }
}

function Tag({ tag: TagName, children_, depth, diag }: {
  tag: string;
  children_: readonly unknown[];
  depth: number;
  diag: Diagnostics;
}) {
  const Component = TagName as "h1";
  return (
    <Component>
      <ChildrenView children_={children_} depth={depth} diag={diag} />
    </Component>
  );
}

function ChildrenView({ children_, depth, diag }: {
  children_: readonly unknown[];
  depth: number;
  diag: Diagnostics;
}) {
  return (
    <>
      {children_.map((child, i) => (
        <ChildView key={i} child={child} depth={depth} diag={diag} />
      ))}
    </>
  );
}

function ChildView({ child, depth, diag }: {
  child: unknown;
  depth: number;
  diag: Diagnostics;
}) {
  if (depth > MAX_DEPTH) {
    diag.onUnsupported?.("nesting depth exceeded");
    return <UnsupportedContent detail="depth" />;
  }
  if (!child || typeof child !== "object") {
    diag.onUnsupported?.("non-object child");
    return <UnsupportedContent detail="child" />;
  }
  const node = child as { type?: string; text?: string; marks?: string[];
                           base?: string; ruby?: string; slot_id?: string;
                           children?: unknown[] };
  switch (node.type) {
    case "text": {
      if (typeof node.text !== "string") {
        diag.onUnsupported?.("text without string");
        return null;
      }
      const marks = node.marks ?? [];
      let out: React.ReactNode = node.text;
      if (marks.includes("underline")) out = <u>{out}</u>;
      if (marks.includes("bold")) out = <strong>{out}</strong>;
      if (marks.includes("italic")) out = <em>{out}</em>;
      return <Fragment>{out}</Fragment>;
    }
    case "ruby":
      if (typeof node.base !== "string" || typeof node.ruby !== "string") {
        diag.onUnsupported?.("malformed ruby");
        return <UnsupportedContent detail="ruby" />;
      }
      return (
        <ruby>
          {node.base}
          <rt>{node.ruby}</rt>
        </ruby>
      );
    case "slot":
      return (
        <span className="richtext-slot" data-slot-id={node.slot_id}>
          <ChildrenView children_={node.children ?? []} depth={depth + 1} diag={diag} />
        </span>
      );
    case "break":
      return <br />;
    default:
      diag.onUnsupported?.(`unknown child ${node.type}`);
      return <UnsupportedContent detail="child-node" />;
  }
}

/** Validate children against the whitelist without rendering (tests). */
export function validateChildren(children: unknown): boolean {
  return RichTextChildrenSchema.safeParse(children).success;
}
