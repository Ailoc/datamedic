import { memo } from "react";
import { Activity, BarChart3 } from "lucide-react";

const examples = [
  "展示 2025 年骨科出院人次趋势",
  "比较心内科与心外科手术人次",
  "找出门诊人次下降最明显的科室",
  "分析住院收入与出院人次的关系",
];

export const Welcome = memo(function Welcome({
  onPickExample,
}: {
  onPickExample: (example: string) => void;
}) {
  return (
    <div className="welcome">
      <div className="welcome-mark" aria-hidden="true">
        <Activity size={28} />
      </div>
      <h2>今天想看哪组指标？</h2>
      <div className="example-grid">
        {examples.map((example) => (
          <button key={example} onClick={() => onPickExample(example)}>
            <span>{example}</span>
            <BarChart3 size={17} />
          </button>
        ))}
      </div>
    </div>
  );
});
