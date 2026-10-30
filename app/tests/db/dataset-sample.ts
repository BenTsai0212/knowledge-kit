// 參考資料集（client/data/）轉成 oracle.ts 的輸入形狀；轉換在 app/src/evals/oracle.ts（#62 決定 B）。
import { dataset } from "../../src/dataset/load";
import { datasetSample as toSample, type Sample } from "../../src/evals/oracle";

export const datasetSample: Sample = toSample(dataset);
