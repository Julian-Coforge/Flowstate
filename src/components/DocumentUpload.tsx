"use client";

import { useRef, useState } from "react";

const ACCEPT = ".txt,.md,.markdown,.csv,.pdf,.docx,text/plain,application/pdf";

type Props = {
  file: File | null;
  onChange: (file: File | null) => void;
  label?: string;
  className?: string;
};

export default function DocumentUpload({ file, onChange, label = "Attach a brief or plan", className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function pick(next: File | null) {
    onChange(next);
    if (!next && inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className={className ?? "mt-2"}>
      <div
        role="button"
        tabIndex={0}
        className={`file-drop w-full cursor-pointer text-left ${dragging ? "file-drop-active" : ""} ${file ? "file-drop-filled" : ""}`}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const next = event.dataTransfer.files?.[0] ?? null;
          if (next) pick(next);
        }}
        aria-label={file ? `Replace document ${file.name}` : label}
      >
        <span className="file-drop-icon" aria-hidden>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" strokeLinejoin="round" />
            <path d="M14 3v5h5M12 11v6M9 14l3-3 3 3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          {file ? (
            <>
              <span className="block truncate text-sm font-medium text-base-content">{file.name}</span>
              <span className="mt-0.5 block text-xs text-base-content/55">
                {(file.size / 1024).toFixed(file.size > 1024 * 100 ? 0 : 1)} KB · click or drop to replace
              </span>
            </>
          ) : (
            <>
              <span className="block text-sm font-medium text-base-content">{label}</span>
              <span className="mt-0.5 block text-xs text-base-content/55">PDF, Word, Markdown, text, or CSV</span>
            </>
          )}
        </span>
        {file ? (
          <button
            type="button"
            className="btn btn-ghost btn-xs shrink-0"
            onClick={(event) => {
              event.stopPropagation();
              pick(null);
            }}
          >
            Clear
          </button>
        ) : (
          <span className="btn btn-ghost btn-xs shrink-0 pointer-events-none">Browse</span>
        )}
      </div>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept={ACCEPT}
        onChange={(event) => pick(event.target.files?.[0] ?? null)}
      />
    </div>
  );
}
