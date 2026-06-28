"use client";

import { useState } from "react";
import { ProposedAction } from "@/lib/types";

interface ActionsPanelProps {
  actions: ProposedAction[];
}

// Format an ISO datetime as a compact Google Calendar timestamp:
// YYYYMMDDTHHmmssZ (UTC). Falls back to "now" if the input is unparseable.
function toGCalStamp(iso: string): string {
  const d = new Date(iso);
  const safe = isNaN(d.getTime()) ? new Date() : d;
  return safe.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function buildCalendarUrl(
  action: Extract<ProposedAction, { kind: "calendar" }>,
): string {
  const start = new Date(action.whenISO);
  const safeStart = isNaN(start.getTime()) ? new Date() : start;
  const durationMins = action.durationMins ?? 60;
  const end = new Date(safeStart.getTime() + durationMins * 60_000);
  const text = encodeURIComponent(action.title);
  const dates = `${toGCalStamp(safeStart.toISOString())}/${toGCalStamp(end.toISOString())}`;
  const details = action.notes ? `&details=${encodeURIComponent(action.notes)}` : "";
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${dates}${details}`;
}

function buildMailtoUrl(
  action: Extract<ProposedAction, { kind: "email" }>,
): string {
  const subject = encodeURIComponent(action.subject);
  const body = encodeURIComponent(action.body);
  const to = action.to ? encodeURIComponent(action.to) : "";
  return `mailto:${to}?subject=${subject}&body=${body}`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function actionAsText(action: ProposedAction): string {
  if (action.kind === "calendar") {
    const lines = [
      `Calendar: ${action.title}`,
      `When: ${formatWhen(action.whenISO)}`,
    ];
    if (action.durationMins) lines.push(`Duration: ${action.durationMins} min`);
    if (action.notes) lines.push(`Notes: ${action.notes}`);
    return lines.join("\n");
  }
  const lines = [`Email: ${action.subject}`];
  if (action.to) lines.push(`To: ${action.to}`);
  lines.push("", action.body);
  return lines.join("\n");
}

function ActionCard({
  action,
  index,
}: {
  action: ProposedAction;
  index: number;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(actionAsText(action));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (action.kind === "calendar") {
    const url = buildCalendarUrl(action);
    return (
      <div
        className="group bg-gradient-to-br from-purple-950/40 to-fuchsia-950/30 border border-purple-500/30 rounded-xl p-4 transition-all hover:border-purple-400/50 hover:shadow-lg hover:shadow-purple-500/10"
        style={{ animationDelay: `${index * 60}ms` }}
      >
        <div className="flex items-start gap-3 mb-3">
          <div className="text-2xl leading-none mt-0.5">{"\u{1F4C5}"}</div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-widest font-bold text-purple-300/70 mb-0.5">
              Calendar Event
            </div>
            <div className="text-white font-semibold text-sm leading-tight truncate">
              {action.title}
            </div>
            <div className="text-white/60 text-xs mt-1 font-mono">
              {formatWhen(action.whenISO)}
              {action.durationMins ? (
                <span className="text-white/30">
                  {" "}
                  · {action.durationMins}min
                </span>
              ) : null}
            </div>
            {action.notes && (
              <div className="text-white/50 text-xs mt-1.5 line-clamp-2 italic">
                {action.notes}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-all shadow-sm shadow-purple-500/20"
          >
            Add to Google Calendar
          </a>
          <button
            onClick={handleCopy}
            title="Copy as text"
            className="text-white/40 hover:text-white text-xs bg-white/5 hover:bg-white/10 px-2.5 py-2 rounded-lg transition-all border border-white/10"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
    );
  }

  // email
  const url = buildMailtoUrl(action);
  return (
    <div
      className="group bg-gradient-to-br from-fuchsia-950/40 to-purple-950/30 border border-fuchsia-500/30 rounded-xl p-4 transition-all hover:border-fuchsia-400/50 hover:shadow-lg hover:shadow-fuchsia-500/10"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="text-2xl leading-none mt-0.5">{"\u{2709}\u{FE0F}"}</div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest font-bold text-fuchsia-300/70 mb-0.5">
            Email Draft
            {action.to && (
              <span className="ml-2 text-white/40 normal-case tracking-normal font-normal">
                to {action.to}
              </span>
            )}
          </div>
          <div className="text-white font-semibold text-sm leading-tight truncate">
            {action.subject}
          </div>
          <div className="text-white/50 text-xs mt-1.5 line-clamp-3 whitespace-pre-wrap">
            {action.body}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-center bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-all shadow-sm shadow-fuchsia-500/20"
        >
          Open in Mail
        </a>
        <button
          onClick={handleCopy}
          title="Copy as text"
          className="text-white/40 hover:text-white text-xs bg-white/5 hover:bg-white/10 px-2.5 py-2 rounded-lg transition-all border border-white/10"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export default function ActionsPanel({ actions }: ActionsPanelProps) {
  if (!actions.length) return null;

  return (
    <div className="mb-6 p-4 bg-gradient-to-br from-purple-950/30 to-fuchsia-950/20 border border-purple-500/20 rounded-xl">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-fuchsia-400 animate-pulse" />
        <div className="text-purple-300 text-[10px] uppercase tracking-widest font-bold">
          Proposed Actions
        </div>
        <div className="text-white/30 text-[10px]">
          {actions.length} ready to fire
        </div>
      </div>
      <div className="space-y-2.5">
        {actions.map((action, i) => (
          <ActionCard
            key={`${action.kind}-${i}`}
            action={action}
            index={i}
          />
        ))}
      </div>
    </div>
  );
}
