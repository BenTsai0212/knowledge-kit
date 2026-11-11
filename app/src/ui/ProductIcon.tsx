// 產品 icon（K 晶格，#226）：形狀固定，顏色只讀主題 token（docs/design.md「產品 icon（K 晶格）」）。
// 線條與交點讀 text、下方節點讀 primary（換客戶時跟著變）、證據節點讀 mark（客戶不能改）；顏色在 app.css 的 .product-icon__*。
// 路徑與尺寸與 docs/images/icon/ 的 SVG 相同（product-icon.test.ts 檢查）。

// 網格 48；書背與兩條分支
export const ICON_PATH = "M17 12v24M17 24 32 13.5M17 24l15 10.5";
// 32px 以下改用簡化版（knowledge-kit-16.svg）：線加粗、去掉交點與下方節點、證據節點不描邊
export const SIMPLIFIED_MAX_SIZE = 32;

interface Props {
  // 顯示尺寸（px）
  size: number;
}

// 裝飾用：旁邊一定有文字（字標），所以 aria-hidden
export function ProductIcon({ size }: Props) {
  const simplified = size <= SIMPLIFIED_MAX_SIZE;
  return (
    <svg
      className={simplified ? "product-icon product-icon--simplified" : "product-icon"}
      viewBox="0 0 48 48"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <rect className="product-icon__tile" width="48" height="48" rx="11" strokeWidth={simplified ? 2 : 0.5} />
      <path className="product-icon__line" d={ICON_PATH} strokeWidth={simplified ? 5.5 : 3.5} />
      {!simplified && <circle className="product-icon__joint" cx="17" cy="24" r="3.5" />}
      {!simplified && <circle className="product-icon__primary" cx="32" cy="34.5" r="4.5" />}
      <circle className="product-icon__evidence" cx="32" cy="13.5" r={simplified ? 5.5 : 4.5} strokeWidth={simplified ? 0 : 1.5} />
    </svg>
  );
}
