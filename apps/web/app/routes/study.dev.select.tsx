import { useState } from "react";
import { Select, type SelectGroup } from "../components/select";

/**
 * DEV-ONLY Select gallery (VITE_DEV_TOOLS=1) for visual review of the
 * select-spec.md variants. Not linked from navigation.
 */
const LEVELS = ["N5", "N4", "N3", "N2", "N1"].map((l) => ({ value: l, label: l }));
const GROUPED: SelectGroup[] = ["N1", "N2", "N3"].map((lv) => ({
  label: lv,
  options: [2025, 2024, 2023].map((y) => ({
    value: `${lv}-${y}`, label: `${y}年${lv}`, disabled: lv === "N3" && y === 2023,
  })),
}));
const MANY = Array.from({ length: 40 }, (_, i) => ({
  value: String(2026 - i), label: `${2026 - i} 年`,
}));

export default function SelectGallery() {
  const [a, setA] = useState("N2");
  const [b, setB] = useState("");
  const [c, setC] = useState("");
  const [d, setD] = useState("2020");
  const [e, setE] = useState("N5");
  if (import.meta.env.VITE_DEV_TOOLS !== "1") {
    return <p role="status">开发工具未启用（VITE_DEV_TOOLS）。</p>;
  }
  return (
    <section style={{ display: "grid", gap: 24, padding: "24px 0" }}>
      <h1>Select 组件</h1>
      <div className="select-field"><span id="g1">Single</span>
        <Select aria-labelledby="g1" value={a} items={LEVELS} onChange={setA} /></div>
      <div className="select-field"><span id="g2l">Large</span>
        <Select size="large" aria-labelledby="g2l" value={e} items={LEVELS}
                onChange={setE} /></div>
      <div className="select-field"><span id="g2t">Text</span>
        <Select variant="text" aria-labelledby="g2t" value={e} items={LEVELS}
                onChange={setE} /></div>
      <div className="select-field"><span id="g2">Compact</span>
        <Select size="compact" aria-labelledby="g2" value={e} items={LEVELS}
                onChange={setE} /></div>
      <div className="select-field"><span id="g3">Grouped</span>
        <Select aria-labelledby="g3" value={b} items={GROUPED}
                placeholder="选择试卷" onChange={setB} /></div>
      <div className="select-field"><span id="g4">Searchable</span>
        <Select searchable aria-labelledby="g4" value={d} items={MANY}
                onChange={setD} /></div>
      <div className="select-field"><span id="g5">Grouped + Searchable</span>
        <Select searchable aria-labelledby="g5" value={c} items={GROUPED}
                placeholder="搜索试卷" onChange={setC} /></div>
      <div className="select-field"><span id="g6">Disabled</span>
        <Select disabled aria-labelledby="g6" value="" items={LEVELS}
                placeholder="不可用" onChange={() => {}} /></div>
      <div style={{ overflow: "hidden", height: 80, border: "1px dashed #ccc",
                    padding: 8 }}>
        <div className="select-field"><span id="g7">在 overflow:hidden 容器内</span>
          <Select aria-labelledby="g7" value={a} items={LEVELS} onChange={setA} /></div>
      </div>
      <div style={{ height: 900 }} />
      <div className="select-field"><span id="g8">页面底部（应向上翻转）</span>
        <Select searchable aria-labelledby="g8" value={d} items={MANY}
                onChange={setD} /></div>
    </section>
  );
}
