"use client";

import { useRef, useState } from "react";
import {
  FileAttachment,
  MISSION_MODES,
  MissionMode,
  WORKER_ROLES,
} from "@/lib/types";

interface InputPanelProps {
  onSubmit: (
    prompt: string,
    files: FileAttachment[],
    mode: MissionMode,
    role: string,
  ) => void;
  onStop: () => void;
  isRunning: boolean;
}

export default function InputPanel({ onSubmit, onStop, isRunning }: InputPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [mode, setMode] = useState<MissionMode>("generalist");
  const [role, setRole] = useState<string>("none");
  const fileRef = useRef<HTMLInputElement>(null);
  const currentMode = MISSION_MODES.find((m) => m.id === mode);
  const currentRole = WORKER_ROLES.find((r) => r.id === role);

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const fl = e.target.files;
    if (!fl || fl.length === 0) return;

    const readers = Array.from(fl).map(
      (f) =>
        new Promise<FileAttachment>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = (reader.result as string).split(",")[1];
            resolve({ data: base64, mediaType: f.type, name: f.name });
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(f);
        }),
    );

    Promise.all(readers).then((newFiles) => {
      setFiles((prev) => [...prev, ...newFiles]);
    });
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() && files.length === 0) return;
    onSubmit(prompt, files, mode, role);
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto">
      <div className="flex flex-col gap-3">
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Give the Brain a task... or upload files and let it loose"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 resize-none text-sm"
            rows={3}
            disabled={isRunning}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                handleSubmit(e);
              }
            }}
          />
        </div>

        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {files.map((f, i) => (
              <span
                key={`${f.name}-${i}`}
                className="flex items-center gap-1.5 px-2 py-1 bg-purple-500/15 border border-purple-500/30 rounded-md text-xs text-purple-200"
              >
                <span className="max-w-[200px] truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  disabled={isRunning}
                  className="text-purple-300/60 hover:text-red-300 disabled:opacity-30"
                  aria-label="remove"
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={fileRef}
            type="file"
            multiple
            onChange={handleFiles}
            accept="image/*,.pdf"
            className="hidden"
          />

          <div className="relative">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as MissionMode)}
              disabled={isRunning}
              title={currentMode?.description}
              className="appearance-none cursor-pointer pl-7 pr-7 py-2 bg-white/5 border border-white/10 rounded-lg text-white/70 hover:text-white hover:border-white/20 focus:outline-none focus:border-purple-500/40 transition-all text-xs disabled:opacity-30"
            >
              {MISSION_MODES.map((m) => (
                <option key={m.id} value={m.id} className="bg-zinc-900">
                  {m.label}
                </option>
              ))}
            </select>
            <span className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none text-sm">
              {currentMode?.emoji}
            </span>
            <svg
              className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none w-3 h-3 text-white/40"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>

          <div className="relative">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={isRunning}
              title="Compare AI cost to this worker's hourly rate"
              className="appearance-none cursor-pointer pl-7 pr-7 py-2 bg-emerald-500/5 border border-emerald-500/20 rounded-lg text-emerald-200/80 hover:text-emerald-100 hover:border-emerald-500/40 focus:outline-none focus:border-emerald-500/60 transition-all text-xs disabled:opacity-30"
            >
              {WORKER_ROLES.map((r) => (
                <option key={r.id} value={r.id} className="bg-zinc-900">
                  vs. {r.label}
                  {r.hourlyRate > 0 ? ` ($${r.hourlyRate}/hr)` : ""}
                </option>
              ))}
            </select>
            <span className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none text-sm">
              {currentRole?.emoji}
            </span>
            <svg
              className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none w-3 h-3 text-emerald-500/40"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={isRunning}
            className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white/50 hover:text-white/80 hover:border-white/20 transition-all text-xs disabled:opacity-30"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
              />
            </svg>
            {files.length > 1
              ? `${files.length} files`
              : files.length === 1
                ? files[0].name
                : "Attach files"}
          </button>

          <div className="flex-1" />

          <span className="text-white/20 text-xs hidden md:inline">
            {isRunning ? "" : "Cmd+Enter"}
          </span>

          {isRunning ? (
            <button
              type="button"
              onClick={onStop}
              className="px-5 py-2 bg-red-600 hover:bg-red-500 text-white font-medium rounded-lg transition-all text-sm flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <rect x="4" y="4" width="12" height="12" rx="2" />
              </svg>
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!prompt.trim() && files.length === 0}
              className="px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-white/5 disabled:text-white/20 text-white font-medium rounded-lg transition-all text-sm"
            >
              Unleash
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
