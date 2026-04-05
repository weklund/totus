"use client";

import {
  Area,
  AreaChart,
  Line,
  LineChart,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { mockSleepScore, mockHrv, mockRhr } from "@/lib/mock-chart-data";

const metrics = [
  { label: "Sleep Score", active: true },
  { label: "HRV", active: true },
  { label: "Resting HR", active: true },
  { label: "Steps", active: false },
  { label: "Readiness", active: false },
];

const dateRanges = [
  { label: "7D", active: false },
  { label: "30D", active: true },
  { label: "90D", active: false },
  { label: "1Y", active: false },
];

export function DashboardPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--totus-mist)] bg-white shadow-[var(--totus-shadow-lg)] dark:border-[#2a3a4a] dark:bg-[#1a2332]">
      {/* Browser chrome */}
      <div className="flex items-center gap-2 border-b border-[var(--totus-mist)] px-4 py-2.5 dark:border-[#2a3a4a]">
        <div className="flex gap-1.5">
          <div className="size-2.5 rounded-full bg-[#ff5f57]" />
          <div className="size-2.5 rounded-full bg-[#febc2e]" />
          <div className="size-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="mx-auto flex items-center gap-1.5 rounded-md bg-[var(--totus-cloud)] px-3 py-1 dark:bg-[#0f1824]">
          <svg
            className="size-3 text-[var(--totus-slate)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <span className="text-[11px] text-[var(--totus-slate)]">
            totus.com/dashboard
          </span>
        </div>
      </div>

      {/* Dashboard content */}
      <div className="p-4 md:p-6">
        {/* Toolbar */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {metrics.map((m) => (
              <span
                key={m.label}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  m.active
                    ? "bg-[var(--totus-ocean)] text-white"
                    : "bg-[var(--totus-cloud)] text-[var(--totus-slate)] dark:bg-[#1e2d3d]"
                }`}
              >
                {m.label}
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            {dateRanges.map((d) => (
              <span
                key={d.label}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  d.active
                    ? "bg-[var(--totus-ocean-tint)] text-[var(--totus-ocean)]"
                    : "text-[var(--totus-slate)]"
                }`}
              >
                {d.label}
              </span>
            ))}
          </div>
        </div>

        {/* Charts grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {/* Sleep Score — Area chart */}
          <ChartCard title="Sleep Score" value="87" unit="" color="#2fa87b">
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={mockSleepScore.slice(-30)}>
                <defs>
                  <linearGradient id="d-sleep" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2fa87b" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#2fa87b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--totus-mist)"
                  vertical={false}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#2fa87b"
                  strokeWidth={2}
                  fill="url(#d-sleep)"
                  dot={false}
                  animationDuration={2000}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* HRV — Line chart */}
          <ChartCard title="HRV" value="42" unit="ms" color="#1e5b7b">
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={mockHrv.slice(-30)}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--totus-mist)"
                  vertical={false}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#1e5b7b"
                  strokeWidth={2}
                  dot={false}
                  animationDuration={2000}
                  animationBegin={300}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Resting HR — Area chart */}
          <ChartCard
            title="Resting Heart Rate"
            value="61"
            unit="bpm"
            color="#e8845a"
          >
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={mockRhr.slice(-30)}>
                <defs>
                  <linearGradient id="d-rhr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e8845a" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#e8845a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--totus-mist)"
                  vertical={false}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#e8845a"
                  strokeWidth={2}
                  fill="url(#d-rhr)"
                  dot={false}
                  animationDuration={2000}
                  animationBegin={600}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

function ChartCard({
  title,
  value,
  unit,
  color,
  children,
}: {
  title: string;
  value: string;
  unit: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--totus-mist)] bg-[var(--totus-cloud)] p-3 dark:border-[#2a3a4a] dark:bg-[#0f1824]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--totus-slate)]">
          {title}
        </span>
        <div className="flex items-baseline gap-0.5">
          <span className="text-lg font-bold" style={{ color }}>
            {value}
          </span>
          {unit && (
            <span className="text-xs text-[var(--totus-slate)]">{unit}</span>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
