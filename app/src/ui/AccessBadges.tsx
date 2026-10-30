// 可見等級與專案的標籤（#48）：等級用 access.json 的 color（淡色背景＋該顏色的邊框，文字用一般文字色，所以都清楚可讀）；
// 專案用中性色。
import type { CSSProperties } from "react";
import { clientConfig } from "../client/load";

export function LevelBadge({ visibility, language }: { visibility: string; language: string }) {
  const level = clientConfig.access.visibilityLevels.find((l) => l.id === visibility);
  return (
    <span className="access-badge level" style={{ "--level-color": level?.color ?? "var(--color-graphFallback)" } as CSSProperties}>
      {level?.label[language] ?? visibility}
    </span>
  );
}

export function ProjectBadge({ project, language }: { project: string; language: string }) {
  return <span className="access-badge project">{clientConfig.access.projects.find((p) => p.id === project)?.label[language] ?? project}</span>;
}

// 文件的等級與專案（沒有專案時只顯示等級）
export function AccessBadges({ visibility, project, language }: { visibility: string; project: string | null; language: string }) {
  return (
    <span className="access-badges">
      <LevelBadge visibility={visibility} language={language} />
      {project !== null && <ProjectBadge project={project} language={language} />}
    </span>
  );
}
