import { useState } from "react";
import { errorMessage, strings } from "../client/i18n";

interface Props {
  language: string;
  // 上一個碼被拒（invalid_access_code）時顯示原因
  rejected: boolean;
  onSubmit(code: string): void;
}

export function AccessCodeForm({ language, rejected, onSubmit }: Props) {
  const s = strings(language);
  const [code, setCode] = useState("");
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
      <p className="muted">{s.accessCodeHint}</p>
      <button type="submit" disabled={code.trim() === ""}>
        {s.accessCodeSubmit}
      </button>
    </form>
  );
}
