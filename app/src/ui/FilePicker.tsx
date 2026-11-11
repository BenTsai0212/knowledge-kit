// 檔案選擇（#239）：原生 <input type="file"> 的按鈕與「No file chosen」由瀏覽器繪製，不跟主題、不翻譯。
// 原生 input 視覺上隱藏（仍可聚焦、以鍵盤開啟選檔），旁邊是自訂的按鈕外觀與已選檔名；文字由呼叫端從 client/i18n/ 傳入。
import type { InputHTMLAttributes, ReactNode, Ref } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & {
  // 按鈕前的說明文字（選填）；按鈕文字與說明一起成為 input 的名稱
  label?: ReactNode;
  button: ReactNode;
  // 按鈕旁的狀態：已選的檔名，或尚未選檔的說明
  status: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
};

export function FilePicker({ label, button, status, inputRef, ...input }: Props) {
  return (
    <div className="file-picker">
      <label>
        {label}
        <input ref={inputRef} type="file" className="visually-hidden" {...input} />
        <span className="file-picker__button">{button}</span>
      </label>
      <span className="file-picker__status">{status}</span>
    </div>
  );
}
