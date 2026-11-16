import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "../../test/render";
import { MaterialDisplay } from "./MaterialDisplay";
import type { VmMaterial, VmUnit } from "./viewModel";

const unit: VmUnit = {
  releaseId: "r-1", id: "u-1", kind: "cloze", position: 1,
  label: "問題9", slotIds: ["s1"],
};

const base = { language: "ja-JP", content: null, imageAssetId: null,
               audio: null };

const passage: VmMaterial = {
  ...base, id: "m1", kind: "passage", role: "primary",
  content: { format: "jlptgo-richtext-v1", blocks: [
    { type: "paragraph", children: [
      { type: "text", text: "　今も昔も、子供たちに親しまれている折り紙。" },
    ] },
  ] },
};

const aDoc = (t: string): VmMaterial => ({
  ...base, id: t, kind: "passage", role: t,
  content: { format: "jlptgo-richtext-v1", blocks: [
    { type: "paragraph", children: [{ type: "text", text: `${t} の文章` }] },
  ] },
});

describe("MaterialDisplay", () => {
  it("renders the reading passage once with serif typography class", () => {
    renderWithQuery(<MaterialDisplay unit={unit} materials={[passage]} />);
    const article = screen.getByRole("article");
    expect(article).toHaveClass("reading-passage");
    expect(screen.getByText(/折り紙/)).toBeInTheDocument();
  });

  it("renders A/B comparison materials with labels", () => {
    renderWithQuery(<MaterialDisplay unit={unit}
      materials={[aDoc("comparison_a"), aDoc("comparison_b")]} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("comparison_a の文章")).toBeInTheDocument();
    expect(screen.getByText("comparison_b の文章")).toBeInTheDocument();
  });

  it("renders image materials as labeled placeholders with asset ids", () => {
    const image: VmMaterial = { ...base, id: "m-img", kind: "image",
      role: "illustration", imageAssetId: "as-img" };
    renderWithQuery(<MaterialDisplay unit={unit} materials={[image]} />);
    const placeholder = document.querySelector("[data-asset-id='as-img']");
    expect(placeholder).toBeInTheDocument();
  });

  it("audio materials without asset render explicit unavailable state", () => {
    const audio: VmMaterial = { ...base, id: "m-a", kind: "audio",
      role: "primary", audio: { kind: "unavailable", reason: "未关联资产" } };
    renderWithQuery(<MaterialDisplay unit={unit} materials={[audio]} />);
    expect(screen.getByText(/音频暂不可用/)).toBeInTheDocument();
  });

  it("audio materials with asset expose the resolved URL mount", () => {
    const audio: VmMaterial = { ...base, id: "m-a", kind: "audio",
      role: "primary",
      audio: { kind: "url", url: "/api/releases/r-1/assets/as-9" } };
    renderWithQuery(<MaterialDisplay unit={unit} materials={[audio]} />);
    expect(document.querySelector("[data-audio-url='/api/releases/r-1/assets/as-9']"))
      .toBeInTheDocument();
  });

  it("forwards richtext diagnostics", () => {
    const diag = vi.fn();
    const broken: VmMaterial = { ...passage,
      content: { format: "html", blocks: [] } };
    renderWithQuery(<MaterialDisplay unit={unit} materials={[broken]}
                                     onDiagnostic={diag} />);
    expect(screen.getByTestId("richtext-unsupported")).toBeInTheDocument();
    expect(diag).toHaveBeenCalled();
  });
});
