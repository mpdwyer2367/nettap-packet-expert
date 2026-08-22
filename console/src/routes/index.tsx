import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Database, Search, ShieldCheck, Waypoints } from "lucide-react";
import logo from "@/assets/nettap-logo.png";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NetTAP AI — Ask your packet-broker telemetry" },
      {
        name: "description",
        content:
          "Upload IPFIX/NetFlow, packet-broker exports and device logs, then investigate incidents by chatting with your telemetry. Every answer cites the flows and log lines behind it.",
      },
      { property: "og:title", content: "NetTAP AI — Ask your packet-broker telemetry" },
      {
        property: "og:description",
        content:
          "Upload IPFIX/NetFlow, packet-broker exports and device logs, then investigate incidents by chatting with your telemetry. Every answer cites the flows and log lines behind it.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const capabilities = [
  {
    icon: Database,
    title: "Ingest what the brokers see",
    body: "IPFIX and NetFlow exports, packet-capture summaries and device syslog land in one indexed dataset.",
  },
  {
    icon: Search,
    title: "Hybrid retrieval",
    body: "Structured aggregation for top talkers and port scans, semantic RAG search for fuzzy behavioural questions.",
  },
  {
    icon: ShieldCheck,
    title: "Evidence, not vibes",
    body: "Every claim cites the flow records and log lines it came from, so you can verify before you escalate.",
  },
  {
    icon: Waypoints,
    title: "Threaded investigations",
    body: "Each incident keeps its own conversation, dataset binding and history you can return to.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2.5">
          <img src={logo} alt="NetTAP AI" width={30} height={30} className="h-[30px] w-[30px]" />
          <span className="font-mono text-sm font-semibold tracking-tight">
            NetTAP<span className="text-primary">.AI</span>
          </span>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/auth">Sign in</Link>
        </Button>
      </header>

      <section className="relative overflow-hidden border-y border-border">
        <div className="grid-backdrop absolute inset-0 opacity-40" aria-hidden />
        <div className="relative mx-auto max-w-5xl px-6 py-20">
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-primary">
            Network telemetry copilot
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            Ask the packets instead of running another three-hour investigation.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
            NetTAP AI indexes your packet-broker telemetry — flows, IPFIX/NetFlow records and device
            logs — then answers operator questions in plain language with the exact records that
            justify each answer.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/auth">
                Start investigating
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/datasets">Load a dataset</Link>
            </Button>
          </div>

          <div className="mt-12 rounded-lg border border-border bg-card/70 p-4 font-mono text-xs text-muted-foreground">
            <p className="text-primary">
              &gt; which host pushed the most bytes out of tap DC1-EDGE last night?
            </p>
            <p className="mt-2">
              10.24.8.117 moved 41.2 GB across 2,318 flows to 203.0.113.44:443 between 22:10 and
              02:40 (flow #8821, flow #8874) — 6x its 7-day baseline.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-6 py-16 sm:grid-cols-2">
        {capabilities.map((capability) => (
          <div key={capability.title} className="rounded-lg border border-border bg-card p-5">
            <capability.icon className="h-5 w-5 text-primary" />
            <h2 className="mt-3 text-sm font-semibold tracking-tight">{capability.title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {capability.body}
            </p>
          </div>
        ))}
      </section>

      <footer className="border-t border-border px-6 py-6 text-xs text-muted-foreground">
        NetTAP AI — evidence-driven network visibility.
      </footer>
    </div>
  );
}
