// 查不到時的下一步（#192，docs/qa.md「拒答」）：拒答下方固定的「可以試試」清單。
// 只看目前身分能不能上傳，不讀問題、檢索結果或拒答原因：「資料沒寫」與「沒有權限」的清單永遠相同，不透露是哪一種
export type RefusalStep = "rephrase" | "askPerson" | "upload";

export function refusalNextSteps({ canUpload }: { canUpload: boolean }): RefusalStep[] {
  return canUpload ? ["rephrase", "askPerson", "upload"] : ["rephrase", "askPerson"];
}
