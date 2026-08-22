import { useState } from "react";
import { CircleAlert, CircleCheck, Cpu, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DEFAULT_OLLAMA_SETTINGS,
  testOllamaConnection,
  type OllamaSettings,
} from "@/lib/ollama";

/** Read-only status for the appliance-managed NetTAP model. */
export function OllamaSettingsButton({ settings }: { settings: OllamaSettings }) {
  const [status, setStatus] = useState<"unknown" | "ok" | "error">("unknown");
  const [statusMessage, setStatusMessage] = useState("Connection not tested.");
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    try {
      const result = await testOllamaConnection(settings, { verifyLoad: true });
      setStatus(result.ok ? "ok" : "error");
      setStatusMessage(result.message);
      toast[result.ok ? "success" : "error"](result.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not test the managed model.";
      setStatus("error");
      setStatusMessage(message);
      toast.error(message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 font-mono text-xs"
          title={`Appliance managed · ${settings.model}`}
        >
          <Cpu
            className={
              status === "error"
                ? "h-3.5 w-3.5 text-destructive"
                : status === "ok"
                  ? "h-3.5 w-3.5 text-primary"
                  : "h-3.5 w-3.5 text-muted-foreground"
            }
          />
          <span className="max-w-[180px] truncate">{settings.model}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 space-y-4">
        <div>
          <p className="text-sm font-semibold">Managed NetTAP model</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Inference is routed through this authenticated application to Ollama on the appliance
            network. Browsers cannot select another endpoint or model.
          </p>
        </div>
        <div className="space-y-2 rounded border border-border bg-muted p-3 font-mono text-xs">
          <div>
            <p className="text-[10px] uppercase text-muted-foreground">Model contract</p>
            <p>{settings.model}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase text-muted-foreground">Transport</p>
            <p>authenticated same-origin proxy</p>
          </div>
        </div>
        <Button size="sm" className="w-full" disabled={checking} onClick={() => void check()}>
          <RefreshCw className={checking ? "mr-2 h-3.5 w-3.5 animate-spin" : "mr-2 h-3.5 w-3.5"} />
          Test managed model
        </Button>
        <div
          className={`flex gap-2 border px-3 py-2 text-xs ${
            status === "ok"
              ? "border-primary/40 bg-primary/10 text-foreground"
              : status === "error"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-border bg-muted text-muted-foreground"
          }`}
        >
          {status === "ok" ? (
            <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span className="leading-relaxed">{statusMessage}</span>
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Model identity and Ollama routing are deployment controls. Change them through the
          signed appliance configuration, not browser storage.
        </p>
      </PopoverContent>
    </Popover>
  );
}

export function useOllamaSettings() {
  return [DEFAULT_OLLAMA_SETTINGS] as const;
}
