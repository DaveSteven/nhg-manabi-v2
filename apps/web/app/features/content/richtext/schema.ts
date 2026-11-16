import { z } from "zod";

/**
 * jlptgo-richtext-v1 whitelist (docs/architecture/canonical-schema-v2.0.md §5).
 * Parsing is strict: unknown node types or shapes fail parsing and render
 * a safe "不支持内容" state with a diagnostic — never raw HTML.
 *
 * Blocks: paragraph / heading / list / table / image.
 * Children: text(marks) / ruby / slot / break.
 * The ruby node shape is provisional (absent from current sample data);
 * extending node types requires a richtext version bump per the spec.
 */
export const FORMAT = "jlptgo-richtext-v1";

const MarksSchema = z.array(z.enum(["underline", "bold", "italic"]));

const TextChild = z.strictObject({
  type: z.literal("text"),
  text: z.string(),
  marks: MarksSchema.optional(),
});

const RubyChild = z.strictObject({
  type: z.literal("ruby"),
  base: z.string(),
  ruby: z.string(),
});

const BreakChild = z.strictObject({ type: z.literal("break") });

export type RichChild =
  | z.infer<typeof TextChild>
  | z.infer<typeof RubyChild>
  | z.infer<typeof BreakChild>
  | { type: "slot"; slot_id: string; children: RichChild[] };

export const SlotChild: z.ZodType<RichChild & { type: "slot" }> = z.lazy(
  () =>
    z.strictObject({
      type: z.literal("slot"),
      slot_id: z.string().min(1),
      children: z.array(Child),
    }),
) as z.ZodType<RichChild & { type: "slot" }>;

const Child: z.ZodType<RichChild> = z.lazy(() =>
  z.union([TextChild, RubyChild, BreakChild, SlotChild]),
) as z.ZodType<RichChild>;

export const RichTextChildrenSchema = z.array(Child);

const ParagraphBlock = z.strictObject({
  type: z.literal("paragraph"),
  children: RichTextChildrenSchema,
});

const HeadingBlock = z.strictObject({
  type: z.literal("heading"),
  children: RichTextChildrenSchema,
  level: z.number().int().min(1).max(6).optional(),
});

const ListItem = z.strictObject({ children: RichTextChildrenSchema });

const ListBlock = z.strictObject({
  type: z.literal("list"),
  ordered: z.boolean().optional(),
  items: z.array(ListItem).min(1),
});

const TableBlock = z.strictObject({
  type: z.literal("table"),
  rows: z.array(z.object({ cells: z.array(z.string()).min(1) })).min(1),
});

const ImageBlock = z.strictObject({
  type: z.literal("image"),
  asset_id: z.string().min(1),
  alt: z.string().optional(),
  caption: z.string().optional(),
});

export const RichBlockSchema = z.union([
  ParagraphBlock,
  HeadingBlock,
  ListBlock,
  TableBlock,
  ImageBlock,
]);

export type RichBlock = z.infer<typeof RichBlockSchema>;

export const RichTextSchema = z.strictObject({
  format: z.literal(FORMAT),
  blocks: z.array(RichBlockSchema),
});

export type RichTextDoc = z.infer<typeof RichTextSchema>;

export function parseRichText(value: unknown):
  { ok: true; doc: RichTextDoc } | { ok: false; reason: string } {
  const result = RichTextSchema.safeParse(value);
  if (result.success) return { ok: true, doc: result.data };
  const issue = result.error.issues[0];
  const path = issue ? issue.path.map(String).join(".") : "";
  return {
    ok: false,
    reason: issue ? `${path}: ${issue.message}` : "invalid richtext",
  };
}
