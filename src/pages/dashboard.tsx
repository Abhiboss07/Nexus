import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Cpu,
  CircuitBoard,
  MemoryStick,
  HardDrive,
  BatteryCharging,
  Wifi,
  Thermometer,
  Zap,
  ShieldCheck,
  Wand2,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { MetricCard } from "@/components/cards/metric-card";
import { HealthCard } from "@/components/cards/health-card";
import { StatusCard } from "@/components/cards/status-card";
import { AnalyticsCard } from "@/components/cards/analytics-card";
import { ActionCard } from "@/components/cards/action-card";
import { Button } from "@/components/ui/button";
import { Badge, StatusDot } from "@/components/ui/badge";
import { stagger, fadeUp } from "@/lib/motion";
import { formatBytes, formatRate } from "@/lib/format";
import {
  useCpu,
  useGpu,
  useMemory,
  useStorage,
  useBattery,
  useNetwork,
  useThermals,
  useHistory,
} from "@/hooks/use-telemetry";

function trend(series: number[]): number {
  if (series.length < 6) return 0;
  const recent = series.slice(-5);
  const prev = series.slice(-10, -5);
  const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  return Math.round(avg(recent) - avg(prev));
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const cpu = useCpu();
  const gpu = useGpu();
  const mem = useMemory();
  const storage = useStorage();
  const battery = useBattery();
  const net = useNetwork();
  const thermals = useThermals();
  const history = useHistory();

  const cpuSeries = history.map((p) => p.cpuUsage);
  const gpuSeries = history.map((p) => p.gpuUsage);
  const memSeries = history.map((p) => p.memUsage);
  const tempSeries = history.map((p) => p.cpuTemp);

  const rootDisk = storage.find((s) => s.mountPoint === "/") ?? storage[0];
  const analytics = history.slice(-24).map((p) => ({
    t: new Date(p.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    a: Math.round(p.cpuUsage),
    b: Math.round(p.gpuUsage),
  }));

  // Health score: penalize high temps and pressure.
  const cpuTemp = thermals?.cpuC ?? cpu?.temperatureC ?? 0;
  const health = Math.max(
    0,
    Math.min(100, Math.round(100 - Math.max(0, cpuTemp - 60) * 0.8 - (mem?.usage ?? 0) * 0.12)),
  );

  return (
    <div>
      <PageHeader
        title="Command Center"
        description="Welcome back — here's your system at a glance."
        actions={
          <>
            <Badge variant={health > 80 ? "success" : "warning"} size="md">
              <StatusDot tone={health > 80 ? "success" : "warning"} pulse={false} />
              {health > 80 ? "All systems nominal" : "Attention advised"}
            </Badge>
            <Button variant="primary" size="md">
              <Zap className="h-4 w-4" /> Boost
            </Button>
          </>
        }
      />

      <motion.div variants={stagger(0.05)} initial="hidden" animate="show">
        {/* Primary telemetry row */}
        <motion.div
          variants={fadeUp}
          className="grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-4"
        >
          <MetricCard
            icon={Cpu}
            label="CPU"
            value={cpu ? cpu.usage.toFixed(0) : "—"}
            unit="%"
            trend={trend(cpuSeries)}
            tone="accent"
            series={cpuSeries}
            footer={cpu ? `${cpu.model.split(" ").slice(0, 3).join(" ")} · ${(cpu.frequencyMhz / 1000).toFixed(1)} GHz` : "Detecting…"}
          />
          <MetricCard
            icon={CircuitBoard}
            label="GPU"
            value={gpu ? gpu.usage.toFixed(0) : "—"}
            unit="%"
            trend={trend(gpuSeries)}
            tone="info"
            series={gpuSeries}
            footer={gpu ? `${gpu.name.replace("NVIDIA GeForce ", "")} · ${gpu.temperatureC?.toFixed(0) ?? "—"}°C` : "No GPU"}
          />
          <MetricCard
            icon={MemoryStick}
            label="Memory"
            value={mem ? formatBytes(mem.usedBytes, 1).replace(" GB", "") : "—"}
            unit={mem ? `/ ${formatBytes(mem.totalBytes, 0)}` : ""}
            trend={trend(memSeries)}
            tone="success"
            series={memSeries}
            footer={mem ? `${mem.usage.toFixed(0)}% used` : "Detecting…"}
          />
          <MetricCard
            icon={Thermometer}
            label="CPU Thermals"
            value={cpuTemp ? cpuTemp.toFixed(0) : "—"}
            unit="°C"
            trend={trend(tempSeries)}
            tone={cpuTemp > 80 ? "danger" : cpuTemp > 70 ? "warning" : "success"}
            series={tempSeries}
            footer={`Package temperature`}
          />
        </motion.div>

        {/* Analytics + health */}
        <div className="mt-md grid grid-cols-1 gap-md lg:grid-cols-3">
          <motion.div variants={fadeUp} className="lg:col-span-2">
            <AnalyticsCard
              title="System Load"
              subtitle="Live · CPU vs GPU utilization"
              data={analytics}
              seriesA="CPU"
              seriesB="GPU"
            />
          </motion.div>
          <motion.div variants={fadeUp}>
            <HealthCard
              title="System Health"
              value={health}
              centerLabel={`${health}`}
              sublabel="Score"
              tone={health > 80 ? "success" : health > 60 ? "warning" : "danger"}
              stats={[
                { label: "CPU Temp", value: `${cpuTemp.toFixed(0)}°C` },
                { label: "GPU Temp", value: `${thermals?.gpuC?.toFixed(0) ?? "—"}°C` },
                { label: "Memory", value: `${mem?.usage.toFixed(0) ?? "—"}%` },
                { label: "Battery", value: battery ? `${battery.chargePercent.toFixed(0)}%` : "—" },
              ]}
            />
          </motion.div>
        </div>

        {/* Status rail — live system state */}
        <motion.div
          variants={fadeUp}
          className="mt-md grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-4"
        >
          <StatusCard
            icon={HardDrive}
            title="Storage"
            status={rootDisk ? `${formatBytes(rootDisk.totalBytes - rootDisk.usedBytes, 0)} free of ${formatBytes(rootDisk.totalBytes, 0)}` : "—"}
            tone="info"
            detail={rootDisk ? `${rootDisk.usage.toFixed(0)}%` : ""}
          />
          <StatusCard
            icon={BatteryCharging}
            title="Battery"
            status={battery ? `${battery.status} · ${battery.chargePercent.toFixed(0)}%` : "No battery"}
            tone={battery && battery.chargePercent < 20 ? "warning" : "success"}
            detail={battery ? `${battery.healthPercent.toFixed(0)}%` : ""}
          />
          <StatusCard
            icon={Wifi}
            title="Network"
            status={net ? `${net.interface} · ↓ ${formatRate(net.downloadBytesSec)}` : "Offline"}
            tone="success"
            detail={net ? `↑ ${formatRate(net.uploadBytesSec)}` : ""}
          />
          <ActionCard
            icon={ShieldCheck}
            title="Run System Doctor"
            description="Deep scan — runs automatically on open"
            tone="warning"
            onClick={() => navigate("/doctor")}
          />
          <ActionCard
            icon={Wand2}
            title="Linux Optimizer"
            description="Reclaim memory, disk & prune startup"
            tone="info"
            onClick={() => navigate("/optimizer")}
          />
        </motion.div>
      </motion.div>
    </div>
  );
}
