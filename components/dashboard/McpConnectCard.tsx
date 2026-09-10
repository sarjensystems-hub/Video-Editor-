"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Plug } from "lucide-react";
import { Button } from "@/components/ui/Button";
import Segmented from "@/components/ui/Segmented";

type Client = "chatgpt" | "claude";

const STEPS: Record<Client, string[]> = {
  chatgpt: [
    "Open ChatGPT settings and go to Connectors.",
    "Add a custom connector and paste the URL above.",
    "Authorise with this Studio account when prompted.",
    "In a project, ask it to create a Creative Studio project.",
  ],
  claude: [
    "Open Claude settings and go to Connectors.",
    "Add a custom connector and paste the URL above.",
    "Authorise with this Studio account when prompted.",
    "Start a chat and ask it to create a Creative Studio project.",
  ],
};

export default function McpConnectCard({ url }: { url: string }) {
  const [client, setClient] = useState<Client>("chatgpt");
  const [copied, setCopied] = useState(false);

  // The tick is feedback, not state worth keeping; it clears itself.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access is denied in some embedded browsers; the URL stays
      // selectable on screen either way, so this needs no error state.
    }
  };

  return (
    <section className="rounded-2xl border border-edge bg-panel p-4 sm:p-5">
      <div className="mb-1 flex items-center gap-2">
        <Plug className="h-4 w-4 text-fire" />
        <h2 className="text-sm font-bold text-ink">Connect your assistant</h2>
      </div>
      <p className="mb-4 max-w-2xl text-xs leading-relaxed text-ink-muted">
        ChatGPT or Claude does the concept, copy, imagery and design. Studio keeps the project,
        validates every edit, renders exact frames and exports the final video.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <code className="min-w-0 flex-1 select-all overflow-x-auto rounded-xl border border-edge bg-canvas-subtle px-3 py-2.5 font-mono text-xs text-ink-muted">
          {url}
        </code>
        <Button variant="primary" onClick={copy} className="shrink-0">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy URL"}
        </Button>
      </div>

      <Segmented
        className="mt-4 max-w-xs"
        label="Assistant"
        value={client}
        onChange={setClient}
        options={[
          { value: "chatgpt", label: "ChatGPT" },
          { value: "claude", label: "Claude" },
        ]}
      />

      <ol className="mt-3 grid gap-2">
        {STEPS[client].map((step, index) => (
          <li key={step} className="flex gap-2.5 text-xs leading-relaxed text-ink-muted">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-canvas-muted text-[10px] font-bold tabular-nums text-ink-faint">
              {index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
    </section>
  );
}
