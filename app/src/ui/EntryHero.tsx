// 入口頁主視覺（#228，docs/design.md「入口頁主視覺」）：客戶自己的圖譜（client/data/ 的實體與關係），沒有文字。
// 版面是 entry-hero.ts 的純函式，動態全部是 app.css 的 CSS 動畫（不用 JS 計時器，不阻擋表單）；減少動態時是靜止的完整網路。
// 裝飾用，對輔助技術隱藏。
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { clientConfig } from "../client/load";
import { dataset } from "../dataset/load";
import { heroScene, isLowEnd, type HeroLink, type HeroNode, type Point } from "./entry-hero";

const { entityTypes } = clientConfig.knowledgeModel;
const typeColor = new Map(entityTypes.map((t) => [t.id, t.color]));
// 流動的光點最多幾條線；第一條是證據色
const TRAVEL_LIMIT = 6;

const vars = (values: Record<string, string | number>) => values as CSSProperties;

function Lines({ points, links, className }: { points: readonly Point[]; links: readonly HeroLink[]; className: string }) {
  return (
    <>
      {links.map((l, i) => (
        <line
          key={`${l.from}-${l.to}`}
          className={className}
          x1={points[l.from].x}
          y1={points[l.from].y}
          x2={points[l.to].x}
          y2={points[l.to].y}
          pathLength={1}
          style={vars({ "--i": i })}
        />
      ))}
    </>
  );
}

function Shape({ node }: { node: HeroNode }) {
  if (node.shape === "circle") return <circle className="hero__shape" cx={node.x} cy={node.y} r={2.2} />;
  const size = node.shape === "block" ? 4.6 : 3.6;
  const radius = node.shape === "block" ? 1.2 : 0.6;
  return <rect className="hero__shape" x={node.x - size / 2} y={node.y - size / 2} width={size} height={size} rx={radius} />;
}

function Layer({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className={`hero__layer hero__layer--${name}`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" focusable="false">
        {children}
      </svg>
    </div>
  );
}

export function EntryHero() {
  // 表單先畫出來，下一個畫格才畫主視覺；低階裝置在此時判斷
  const [lite, setLite] = useState<boolean | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setLite(isLowEnd(navigator as Navigator & { deviceMemory?: number })));
    return () => cancelAnimationFrame(frame);
  }, []);
  const scene = useMemo(
    () => (lite === null ? null : heroScene({ entities: dataset.entities.entities, relations: dataset.relations.relations, types: entityTypes }, lite)),
    [lite],
  );
  if (scene === null) return <div className="hero" aria-hidden="true" />;
  const step = Math.max(1, Math.ceil(scene.links.length / TRAVEL_LIMIT));
  const travel = scene.links.filter((_, i) => i % step === 0).slice(0, TRAVEL_LIMIT);
  return (
    <div className={lite ? "hero hero--lite" : "hero"} aria-hidden="true">
      <div className="hero__scene">
        <Layer name="far">
          <Lines points={scene.far} links={scene.farLinks} className="hero__link" />
          {scene.far.map((p, i) => (
            <circle key={i} className="hero__dot" cx={p.x} cy={p.y} r={0.7} style={vars({ "--i": i })} />
          ))}
        </Layer>
        <Layer name="mid">
          <Lines points={scene.mid} links={scene.midLinks} className="hero__link" />
          {scene.mid.map((p, i) => (
            <circle key={i} className="hero__ghost" cx={p.x} cy={p.y} r={1.4} style={vars({ "--i": i })} />
          ))}
        </Layer>
        <Layer name="front">
          <Lines points={scene.front} links={scene.links} className="hero__link hero__link--front" />
          <Lines points={scene.front} links={scene.forming} className="hero__form" />
          {travel.map((l, i) => (
            <line
              key={`travel-${l.from}-${l.to}`}
              className={i === 0 ? "hero__travel hero__travel--evidence" : "hero__travel"}
              x1={scene.front[l.from].x}
              y1={scene.front[l.from].y}
              x2={scene.front[l.to].x}
              y2={scene.front[l.to].y}
              pathLength={1}
              style={vars({ "--i": i })}
            />
          ))}
          {scene.front.map((node, i) => (
            <g key={node.id} className="hero__float" style={vars({ "--i": i, "--type-color": typeColor.get(node.type) ?? "var(--color-graphFallback)" })}>
              {node.core && <circle className="hero__glow" cx={node.x} cy={node.y} r={5} />}
              <g className="hero__node">
                <Shape node={node} />
              </g>
            </g>
          ))}
        </Layer>
      </div>
    </div>
  );
}
