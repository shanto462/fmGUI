// Empty chat: a calm welcome with suggestions that show off the tools.

import { Calculator, Clock, FileSearch, Globe, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

const SUGGESTIONS: { text: string; hint: string; icon: ReactNode }[] = [
  { text: "What time is it?", hint: "Clock tool", icon: <Clock size={16} /> },
  { text: "What is 1234.5 × 987.25?", hint: "Calculator tool", icon: <Calculator size={16} /> },
  { text: "Summarize https://www.apple.com/newsroom/", hint: "Web page tool", icon: <Globe size={16} /> },
  { text: "Find PDF files about invoices on my Mac", hint: "Spotlight tool", icon: <FileSearch size={16} /> },
];

export function Welcome(props: { onPick: (text: string) => void; disabled?: boolean; toolsOff?: boolean }) {
  return (
    <div className="cv-welcome">
      <div className="cv-welcome__icon">
        <Sparkles size={26} />
      </div>
      <h1 className="cv-welcome__title">What can I help with?</h1>
      <p className="cv-welcome__text">
        The model runs on this Mac, so your chats stay private. With tools it can check the time, do math, read web
        pages and search your files.
      </p>
      <div className="cv-suggestions">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.text}
            type="button"
            className="cv-suggestion"
            disabled={props.disabled}
            onClick={() => props.onPick(s.text)}
          >
            <span className="cv-suggestion__icon">{s.icon}</span>
            <span className="cv-suggestion__body">
              <span className="cv-suggestion__text">{s.text}</span>
              <span className="cv-suggestion__hint">{s.hint}</span>
            </span>
          </button>
        ))}
      </div>
      {props.toolsOff && (
        <p className="xsmall muted" style={{ marginTop: 12 }}>
          Tools are off right now. Turn them on with the tools button at the top.
        </p>
      )}
    </div>
  );
}
