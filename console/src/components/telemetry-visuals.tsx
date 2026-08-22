import { MessageResponse } from "@/components/ai-elements/message";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReportVisual } from "@/lib/reports.functions";

function shortLabel(label: string) {
  const iso = label.match(/^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/);
  return iso ? iso[1]! : label.length > 14 ? `${label.slice(0, 13)}…` : label;
}

export function ChartBlock({
  title,
  chartType,
  points,
  yLabel,
}: {
  title: string;
  chartType: string;
  points: { label: string; value: number }[];
  yLabel?: string | null;
}) {
  const data = points.map((point) => ({ ...point, short: shortLabel(point.label) }));
  const axis = { stroke: "hsl(var(--muted-foreground))", fontSize: 10 } as const;

  return (
    <figure className="my-3 rounded-lg border border-border bg-card p-3">
      <figcaption className="mb-2 font-mono text-xs text-muted-foreground">
        {title}
        {yLabel ? ` · ${yLabel}` : ""}
      </figcaption>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === "bar" ? (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="short" tick={axis} interval="preserveStartEnd" />
              <YAxis tick={axis} width={54} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="value" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
            </BarChart>
          ) : chartType === "area" ? (
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="short" tick={axis} interval="preserveStartEnd" />
              <YAxis tick={axis} width={54} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Area
                dataKey="value"
                stroke="hsl(var(--primary))"
                fill="hsl(var(--primary))"
                fillOpacity={0.18}
              />
            </AreaChart>
          ) : (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="short" tick={axis} interval="preserveStartEnd" />
              <YAxis tick={axis} width={54} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Line dataKey="value" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export function DiagramBlock({ title, mermaid }: { title: string; mermaid: string }) {
  return (
    <figure className="my-3 rounded-lg border border-border bg-card p-3">
      <figcaption className="mb-2 font-mono text-xs text-muted-foreground">{title}</figcaption>
      <MessageResponse>{`\`\`\`mermaid\n${mermaid}\n\`\`\``}</MessageResponse>
    </figure>
  );
}

export function VisualBlock({ visual }: { visual: ReportVisual }) {
  if (visual.type === "diagram") return <DiagramBlock title={visual.title} mermaid={visual.mermaid} />;
  return <ChartBlock title={visual.title} chartType={visual.chartType} points={visual.points} />;
}
