import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { yaml } from "@codemirror/lang-yaml";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { jsonStr } from "../lib/format";
import { useTheme } from "./theme";

export type Lang = "json" | "markdown" | "python" | "yaml" | "text";

export function CodeEditor({
  value,
  onChange,
  lang = "json",
  height = "220px",
  readOnly,
  className,
  autoFocusRef,
}: {
  value: string;
  onChange?: (v: string) => void;
  lang?: Lang;
  height?: string;
  readOnly?: boolean;
  className?: string;
  autoFocusRef?: (v: EditorView | null) => void;
}) {
  const { dark } = useTheme();
  const ext = useMemo(() => {
    const l = lang === "json" ? [json()] : lang === "markdown" ? [markdown()] : lang === "python" ? [python()] : lang === "yaml" ? [yaml()] : [];
    return [...l, EditorView.lineWrapping];
  }, [lang]);
  return (
    <div className={clsx("cm-wrap", className)}>
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={ext}
        height={height}
        theme={dark ? "dark" : "light"}
        readOnly={readOnly}
        editable={!readOnly}
        basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly, autocompletion: false }}
        onCreateEditor={(v) => autoFocusRef?.(v)}
      />
    </div>
  );
}

/** Ô JSON: giữ văn bản cục bộ, báo lỗi cú pháp, chỉ gọi onChange khi JSON hợp lệ. */
export function JsonEditor({
  value,
  onChange,
  height = "180px",
  readOnly,
  onValidity,
  resetKey,
}: {
  value: unknown;
  onChange?: (v: unknown) => void;
  height?: string;
  readOnly?: boolean;
  onValidity?: (ok: boolean) => void;
  resetKey?: unknown;
}) {
  const [text, setText] = useState(() => jsonStr(value));
  const [err, setErr] = useState<string | null>(null);
  // nạp lại khi giá trị bên ngoài đổi khác với văn bản hiện tại
  useEffect(() => {
    let same = false;
    try {
      same = JSON.stringify(JSON.parse(text)) === JSON.stringify(value);
    } catch {
      same = false;
    }
    if (!same) {
      setText(jsonStr(value));
      setErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, resetKey]);
  return (
    <div>
      <CodeEditor
        value={text}
        readOnly={readOnly}
        height={height}
        lang="json"
        onChange={(t) => {
          setText(t);
          try {
            const v = t.trim() === "" ? null : JSON.parse(t);
            setErr(null);
            onValidity?.(true);
            onChange?.(v);
          } catch (e) {
            setErr((e as Error).message);
            onValidity?.(false);
          }
        }}
      />
      {err && <div className="mt-1 text-xs text-red-600 dark:text-red-400">JSON không hợp lệ: {err}</div>}
    </div>
  );
}
