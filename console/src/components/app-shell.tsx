import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BookOpen, Briefcase, Database, FileText, Gauge, HardDrive, LogOut, MessageSquare, Network, Plus, Radio, Server, ShieldCheck, Trash2, Wifi } from "lucide-react";
import { toast } from "sonner";
import logo from "@/assets/nettap-logo.png";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  createInvestigation,
  deleteInvestigation,
  listInvestigations,
} from "@/lib/investigations.functions";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  const fetchInvestigations = useServerFn(listInvestigations);
  const createThread = useServerFn(createInvestigation);
  const removeThread = useServerFn(deleteInvestigation);

  const { data: investigations } = useQuery({
    queryKey: ["investigations"],
    queryFn: () => fetchInvestigations(),
  });

  const createMutation = useMutation({
    mutationFn: () => createThread({ data: {} }),
    onSuccess: async (thread) => {
      await queryClient.invalidateQueries({ queryKey: ["investigations"] });
      navigate({ to: "/investigations/$threadId", params: { threadId: thread.id } });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeThread({ data: { id } }),
    onSuccess: async (_result, id) => {
      await queryClient.invalidateQueries({ queryKey: ["investigations"] });
      if (pathname.includes(id)) navigate({ to: "/investigations" });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="flex w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex items-center gap-2.5 border-b border-sidebar-border px-4 py-3.5">
          <img src={logo} alt="NetTAP AI" width={28} height={28} className="h-7 w-7" />
          <div className="leading-tight">
            <p className="font-mono text-sm font-semibold tracking-tight text-sidebar-foreground">
              NetTAP<span className="text-primary">.AI</span>
            </p>
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Telemetry analyst
            </p>
          </div>
        </div>

        <div className="space-y-1 px-2 py-3">
          {[
            { to: "/datasets" as const, label: "Datasets", Icon: Database },
            { to: "/live" as const, label: "Live capture", Icon: Wifi },
            { to: "/topology" as const, label: "MATRIX topology", Icon: Network },
            { to: "/cases" as const, label: "Cases & evidence", Icon: Briefcase },
            { to: "/library" as const, label: "Doc library", Icon: BookOpen },
            { to: "/sources" as const, label: "Broker sources", Icon: Radio },
            { to: "/reports" as const, label: "Reports", Icon: FileText },
            { to: "/appliance" as const, label: "Appliance & LAN", Icon: Server },
            { to: "/capacity" as const, label: "Capacity & scaling", Icon: Gauge },
            { to: "/audit" as const, label: "Audit log", Icon: ShieldCheck },
            { to: "/admin" as const, label: "Retention admin", Icon: HardDrive },


          ].map(({ to, label, Icon }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
                pathname.startsWith(to)
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </div>


        <div className="flex items-center justify-between px-4 pb-2 pt-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Investigations
          </p>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            aria-label="New investigation"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1 px-2">
          <div className="space-y-0.5 pb-4">
            {(investigations ?? []).map((thread) => {
              const active = pathname.includes(thread.id);
              return (
                <div
                  key={thread.id}
                  className={cn(
                    "group flex items-center gap-1 rounded-md pr-1 transition-colors",
                    active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
                  )}
                >
                  <Link
                    to="/investigations/$threadId"
                    params={{ threadId: thread.id }}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-sm",
                      active ? "text-sidebar-accent-foreground" : "text-muted-foreground",
                    )}
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{thread.title}</span>
                  </Link>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label={`Delete ${thread.title}`}
                    onClick={() => deleteMutation.mutate(thread.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
            {(investigations ?? []).length === 0 && (
              <p className="px-2.5 py-2 text-xs text-muted-foreground">
                No investigations yet. Start one to query your telemetry.
              </p>
            )}
          </div>
        </ScrollArea>

        <div className="border-t border-sidebar-border p-2">
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground"
            onClick={handleSignOut}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
