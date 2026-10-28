// 主畫面：PGlite 在瀏覽器中載入並匯入資料集；身分與語言切換；問答（需要邀請碼）、圖譜、時間軸（後兩者不呼叫模型）三個頁籤；引用跳回原文。
import { useEffect, useMemo, useRef, useState } from "react";
import { clientConfig } from "./client/load";
import { dataset } from "./dataset/load";
import { seedDataset } from "./dataset/seed";
import { openDatabase, type Database } from "./db/database";
import { ask } from "./qa/answer";
import { apiTransport } from "./qa/api";
import { openRetriever } from "./retrieval/retrieve";
import { readSource, type SourceDocument } from "./sources/source";
import { clearAccessCode, loadAccessCode, saveAccessCode } from "./ui/access-code";
import { AccessCodeForm } from "./ui/AccessCodeForm";
import { AnswerView, type AnswerState } from "./ui/AnswerView";
import { GraphPage } from "./ui/GraphPage";
import { QuestionPanel } from "./ui/QuestionPanel";
import { createRequestGate } from "./ui/requests";
import { SourcePanel } from "./ui/SourcePanel";
import { strings } from "./ui/strings";
import { TimelinePage } from "./ui/TimelinePage";
import { Toolbar } from "./ui/Toolbar";

const { client, access } = clientConfig;

type View = "qa" | "graph" | "timeline";

export function App() {
  const [view, setView] = useState<View>("qa");
  const [language, setLanguage] = useState(client.defaultLanguage);
  const [identity, setIdentity] = useState(access.roles[0].id);
  const [accessCode, setAccessCode] = useState(loadAccessCode);
  const [codeRejected, setCodeRejected] = useState(false);
  const [db, setDb] = useState<Database | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [answer, setAnswer] = useState<AnswerState | null>(null);
  const [source, setSource] = useState<SourceDocument | null>(null);
  // 同時只有一個有效的提問與原文讀取；切換身分或語言時捨棄進行中的
  const questions = useRef(createRequestGate());
  const sources = useRef(createRequestGate());
  const s = strings(language);

  useEffect(() => {
    // StrictMode 在開發時會執行兩次；先結束的那次關閉自己開的資料庫
    let cancelled = false;
    let opened: Database | undefined;
    openDatabase(clientConfig, { seed: (pg) => seedDataset(pg, clientConfig, dataset) }).then(
      (database) => (cancelled ? void database.close() : setDb((opened = database))),
      () => !cancelled && setLoadFailed(true),
    );
    return () => {
      cancelled = true;
      void opened?.close();
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = client.displayName[language];
  }, [language]);

  const retriever = useMemo(() => (db === null ? null : openRetriever(db, client.retrieval)), [db]);

  // 切換身分或語言：清掉回答與原文，之後才到的結果一律忽略
  function discard() {
    questions.current.cancel();
    sources.current.cancel();
    setAnswer(null);
    setSource(null);
  }

  async function onAsk(question: string) {
    if (retriever === null || accessCode === null) return;
    sources.current.cancel();
    setSource(null);
    // 以送出當下的身分與語言提問
    const ticket = questions.current.begin();
    setAnswer({ question, streaming: "" });
    const ctx = { retriever, transport: apiTransport({ accessCode }), model: client.model, displayName: client.displayName };
    const result = await ask(
      ctx,
      { identityId: identity, text: question, language },
      (streaming) => ticket.isCurrent() && setAnswer({ question, streaming }),
      ticket.signal,
    );
    if (!ticket.isCurrent()) return;
    if (result.kind === "error" && result.error === "invalid_access_code") {
      // 清除被拒的碼，回到輸入畫面（#26 決定 3）
      clearAccessCode();
      setAccessCode(null);
      setCodeRejected(true);
      setAnswer(null);
      return;
    }
    setAnswer({ question, streaming: "", answer: result });
  }

  async function onOpenSource(passageId: string) {
    if (db === null) return;
    const ticket = sources.current.begin();
    const document = await readSource(db, identity, passageId);
    if (ticket.isCurrent()) setSource(document);
  }

  return (
    <div className="app">
      <Toolbar
        language={language}
        identity={identity}
        onIdentity={(id) => (discard(), setIdentity(id))}
        onLanguage={(code) => (discard(), setLanguage(code))}
        onChangeAccessCode={
          accessCode === null
            ? undefined
            : () => {
                discard();
                clearAccessCode();
                setAccessCode(null);
                setCodeRejected(false);
              }
        }
      />
      <nav className="tabs" aria-label={s.views}>
        {(
          [
            ["qa", s.tabQa],
            ["graph", s.tabGraph],
            ["timeline", s.tabTimeline],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </nav>
      {loadFailed ? (
        <p className="card error">{s.loadFailed}</p>
      ) : view !== "qa" ? (
        <main>
          {db === null ? (
            <p className="card muted">{s.loading}</p>
          ) : view === "graph" ? (
            <GraphPage db={db} identity={identity} language={language} onOpenSource={onOpenSource} />
          ) : (
            <TimelinePage db={db} identity={identity} language={language} onOpenSource={onOpenSource} />
          )}
          {source !== null && <SourcePanel language={language} source={source} onClose={() => (sources.current.cancel(), setSource(null))} />}
        </main>
      ) : accessCode === null ? (
        <AccessCodeForm
          language={language}
          rejected={codeRejected}
          onSubmit={(code) => {
            saveAccessCode(code);
            setAccessCode(code);
            setCodeRejected(false);
          }}
        />
      ) : (
        <main>
          {db === null && <p className="card muted">{s.loading}</p>}
          <QuestionPanel language={language} disabled={retriever === null} onAsk={onAsk} />
          <AnswerView language={language} state={answer} onOpenSource={onOpenSource} />
          {source !== null && <SourcePanel language={language} source={source} onClose={() => (sources.current.cancel(), setSource(null))} />}
        </main>
      )}
    </div>
  );
}
