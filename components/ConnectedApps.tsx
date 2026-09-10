"use client";

import { useCallback, useEffect, useState } from "react";
import { Plug, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface Connection {
  id: string;
  clientName: string;
  createdAt: string | null;
  lastUsedAt: string | null;
}

function when(value: string | null): string {
  if (!value) return "never used";
  const minutes = Math.round((Date.now() - Date.parse(value)) / 60_000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Lists the assistants holding an MCP token, and lets the user cut them off. */
export default function ConnectedApps() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/oauth/tokens", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      setConnections(payload.connections ?? []);
    } catch {
      // The rest of Settings must stay usable if this one panel cannot load.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (id: string) => {
    setBusyId(id);
    try {
      await fetch(`/api/oauth/tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      {!loaded ? (
        <p className="text-sm text-ink-faint">Loading&hellip;</p>
      ) : connections.length === 0 ? (
        <p className="text-sm leading-relaxed text-ink-faint">
          Nothing connected yet. Add the Studio connector in ChatGPT or Claude and it will
          appear here.
        </p>
      ) : (
        <ul className="grid gap-2">
          {connections.map((connection) => (
            <li
              key={connection.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-edge bg-canvas-subtle px-3 py-2.5"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Plug className="h-4 w-4 shrink-0 text-fire" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">
                    {connection.clientName}
                  </span>
                  <span className="block text-[11px] text-ink-faint">
                    Connected {when(connection.createdAt)} · last used {when(connection.lastUsedAt)}
                  </span>
                </span>
              </span>
              <Button
                size="sm"
                variant="danger"
                disabled={busyId === connection.id}
                onClick={() => revoke(connection.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {busyId === connection.id ? "Revoking" : "Revoke"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
