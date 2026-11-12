// 切換語言、Light／Dark 的原地交叉淡換（#246，docs/design.md「全互動對照表」的「全域 · 切換語言／主題」）：
// 以 View Transitions 拍下舊畫面，舊的 kFadeOut（fast）、新的 kFade（base，延後 60ms），不滑動、不做圓形擴散（app.css 的 ::view-transition-*(root)）。
// 減少動態效果或瀏覽器不支援時直接套用。update 必須同步更新畫面（React 的狀態以 flushSync 包起來）。
import { prefersReducedMotion } from "./motion";

interface Transition {
  ready: Promise<unknown>;
}

export interface TransitionDocument {
  startViewTransition?: (update: () => void) => Transition;
}

export function crossFade(update: () => void, reduced: boolean = prefersReducedMotion(), doc: TransitionDocument = document): void {
  if (reduced || typeof doc.startViewTransition !== "function") return update();
  // 被下一次切換取代時 ready 會 reject；畫面已直接套用，不需要處理
  doc.startViewTransition(update).ready.catch(() => {});
}
