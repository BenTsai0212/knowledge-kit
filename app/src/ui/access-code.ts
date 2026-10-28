// 邀請碼只存在 React state 與 sessionStorage（關閉分頁就清除），不放會保留到下次開啟的儲存、不放網址（#26 決定 3）。
const KEY = "kk.accessCode";

// sessionStorage 在私密瀏覽或被封鎖時可能拋錯；失敗時只存在記憶體
export interface CodeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const browserStorage = (): CodeStorage | null => (typeof sessionStorage === "undefined" ? null : sessionStorage);

export function loadAccessCode(storage = browserStorage()): string | null {
  try {
    return storage?.getItem(KEY) || null;
  } catch {
    return null;
  }
}

export function saveAccessCode(code: string, storage = browserStorage()): void {
  try {
    storage?.setItem(KEY, code);
  } catch {
    // 只存在記憶體
  }
}

// 收到 invalid_access_code 時清除，回到輸入畫面
export function clearAccessCode(storage = browserStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // 沒有可清除的
  }
}
