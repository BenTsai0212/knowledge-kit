import { useId, useState, type ReactNode, type Ref } from "react";
import { errorMessage, strings } from "../client/i18n";
import { onlineDemo } from "./online-demo";

interface Props {
  language: string;
  // 上一個碼被拒（invalid_access_code）時是被拒的碼：顯示原因，輸入框保留這個碼（#246）；沒有被拒時為 null
  rejected: string | null;
  onSubmit(code: string): void;
  // 登入面板從帳號登入切換過來時，焦點移到標題（#334）
  titleRef?: Ref<HTMLHeadingElement>;
  // 手機的語意模型下載進度列（#355），放在「開始使用」上方
  progress?: ReactNode;
}

export function AccessCodeForm({ language, rejected, onSubmit, titleRef, progress }: Props) {
  const s = strings(language);
  const errorId = useId();
  // 線上 demo 預先填入公開試用碼，訪客只要按送出（#100 決定 2）；碼被拒時保留已輸入的內容，不清空（#246）
  const [code, setCode] = useState(rejected ?? onlineDemo.publicAccessCode);
  const invalid = rejected !== null;
  return (
    <form
      className="card access-code"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim() !== "") onSubmit(code.trim());
      }}
    >
      <p className="entry-eyebrow" aria-hidden="true">
        {s.accessCodeEyebrow}
      </p>
      <h2 ref={titleRef} tabIndex={-1}>
        {s.accessCodeTitle}
      </h2>
      <label>
        <span className="access-code__label">{s.accessCodeLabel}</span>
        <input
          type="password"
          className="entry-code"
          autoComplete="off"
          value={code}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      {/* 錯誤：輸入框邊線換成 danger、說明往下展開（kDrop）；不搖晃、不閃紅（docs/design.md「全互動對照表」的「進入」） */}
      {invalid && (
        <div className="access-code__error">
          <p id={errorId} className="error">
            {errorMessage(language, "invalid_access_code")}
          </p>
        </div>
      )}
      {!invalid && onlineDemo.publicAccessCode !== "" && <p className="muted">{s.demoAccessCodeHint}</p>}
      <p className="muted">{s.accessCodeHint}</p>
      {progress}
      <button type="submit" className="entry-primary" disabled={code.trim() === ""}>
        {s.accessCodeSubmit}
      </button>
    </form>
  );
}
