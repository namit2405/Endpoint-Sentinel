import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

export interface MetricsChartProps {
  title: string;
  data: Array<Record<string, string | number>>;
  endpoints: string[];
  colorPalette?: string[];
}

const CHART_COLORS = [
  "oklch(var(--chart-1))",
  "oklch(var(--chart-2))",
  "oklch(var(--chart-3))",
  "oklch(var(--chart-4))",
  "oklch(var(--chart-5))",
];

/**
 * Reusable line chart plotting one line per endpoint over a shared time axis.
 * X-axis shows time in 5-minute intervals; Y-axis is fixed to 0-100%.
 */
export function MetricsChart({
  title,
  data,
  endpoints,
  colorPalette = CHART_COLORS,
}: MetricsChartProps) {
  return (
    <div
      role="img"
      aria-label={`${title} usage for the top ${endpoints.length} endpoints over the last 60 minutes`}
      className="h-64 w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="oklch(var(--border))"
            vertical={false}
          />
          <XAxis
            dataKey="time"
            tickLine={false}
            axisLine={false}
            tick={{
              fill: "oklch(var(--muted-foreground))",
              fontSize: 12,
            }}
            dy={6}
          />
          <YAxis
            domain={[0, 100]}
            tickLine={false}
            axisLine={false}
            tick={{
              fill: "oklch(var(--muted-foreground))",
              fontSize: 12,
            }}
          />
          <RechartsTooltip
            cursor={{ stroke: "oklch(var(--border))" }}
            contentStyle={{
              borderRadius: 12,
              border: "1px solid oklch(var(--border))",
              background: "oklch(var(--card))",
              fontSize: 12,
            }}
            formatter={(value: number, name: string) => [
              `${Math.round(value)}%`,
              name,
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            iconType="plainline"
          />
          {endpoints.map((hostname, i) => (
            <Line
              key={hostname}
              type="monotone"
              dataKey={hostname}
              stroke={colorPalette[i % colorPalette.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
