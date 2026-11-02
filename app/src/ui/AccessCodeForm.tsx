import { useState } from "react";
import { errorMessage, strings } from "../client/i18n";
import { onlineDemo } from "./online-demo";

interface Props {
  language: string;
  // 上一個碼被拒（invalid_access_code）時顯示原因
  rejected: boolean;
  onSubmit(code: string): void;
}

export function AccessCodeForm({ language, rejected, onSubmit }: Props) {
  const s = strings(language);
  // 線上 demo 預先填入公開試用碼，訪客只要按送出（#100 決定 2）；碼被拒時不再填入，讓訪客輸入其他碼
  const prefilled = rejected ? "" : onlineDemo.publicAccessCode;
  const [code, setCode] = useState(prefilled);
  return (
    <form
      className="card access-code"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim() !== "") onSubmit(code.trim());
      }}
    >
      <h2>{s.accessCodeTitle}</h2>
      {rejected && <p className="error">{errorMessage(language, "invalid_access_code")}</p>}
      <label>
        {s.accessCodeLabel}
        <input type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      {prefilled !== "" && <p className="muted">{s.demoAccessCodeHint}</p>}
      <p className="muted">{s.accessCodeHint}</p>
      <button type="submit" disabled={code.trim() === ""}>
        {s.accessCodeSubmit}
      </button>
    </form>
  );
}
