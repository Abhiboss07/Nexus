import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ResponsiveContainer, Treemap, Tooltip } from "recharts";
import {
  HardDrive,
  FolderOpen,
  Trash2,
  Trash,
  FileSearch,
  Copy,
  Layers,
  Boxes,
  ChevronRight,
  Home,
  RotateCw,
  Loader2,
  CheckSquare,
  Square,
  AlertTriangle,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { GlassCard } from "@/components/ui/glass";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Meter } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/states";
import {
  isTauri,
  storageRoots,
  storageTree,
  storageLargestFiles,
  storageDuplicates,
  storageSpaceByApp,
  trashFile,
  deleteFile,
  revealFile,
} from "@/lib/ipc";
import type { ScanRoot, TreeLevel, FileInfo, DupGroup, AppUsage, DupCategory } from "@/lib/storage-types";
import { formatBytes } from "@/lib/format";
import { stagger, fadeUp } from "@/lib/motion";
import { cn } from "@/lib/cn";

type Tab = "treemap" | "files" | "duplicates" | "apps";
type Status = { kind: "ok" | "error"; msg: string } | null;

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "treemap", label: "Treemap", icon: Layers },
  { id: "files", label: "Largest Files", icon: FileSearch },
  { id: "duplicates", label: "Duplicates", icon: Copy },
  { id: "apps", label: "By Application", icon: Boxes },
];

const DEMO_ROOTS: ScanRoot[] = [
  { id: "home", label: "Home", path: "/home/you", sizeBytes: 480_000_000_000 },
  { id: "downloads", label: "Downloads", path: "/home/you/Downloads", sizeBytes: 32_000_000_000 },
  { id: "steam", label: "Steam Library", path: "/home/you/.local/share/Steam/steamapps", sizeBytes: 148_000_000_000 },
];

export default function StorageAnalyzerPage() {
  const [roots, setRoots] = useState<ScanRoot[]>([]);
  const [root, setRoot] = useState<ScanRoot | null>(null);
  const [tab, setTab] = useState<Tab>("treemap");
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    if (isTauri()) storageRoots().then((r) => { setRoots(r); setRoot(r[0] ?? null); }).catch(() => { setRoots(DEMO_ROOTS); setRoot(DEMO_ROOTS[0]); });
    else { setRoots(DEMO_ROOTS); setRoot(DEMO_ROOTS[0]); }
  }, []);

  useEffect(() => { if (!status) return; const t = setTimeout(() => setStatus(null), 4500); return () => clearTimeout(t); }, [status]);

  return (
    <div>
      <PageHeader
        title="Storage Analyzer"
        description="WinDirStat-class disk insight — treemap, largest files, duplicates & per-app usage."
      />

      {status && (
        <div className={cn("mb-md flex items-center gap-sm rounded-lg border p-sm text-sm", status.kind === "error" ? "border-danger/30 bg-danger/10 text-danger" : "border-success/30 bg-success/10 text-success")}>
          {status.kind === "error" ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
          <span className="min-w-0 flex-1">{status.msg}</span>
        </div>
      )}

      {/* Scan target chips */}
      <div className="mb-lg flex flex-wrap gap-xs">
        {roots.map((r) => (
          <button key={r.id + r.path} onClick={() => setRoot(r)} className={cn("inline-flex items-center gap-xs rounded-full border px-sm py-2xs text-xs font-medium transition-all", root?.path === r.path ? "border-accent/60 bg-accent/10 text-accent-strong" : "border-border bg-surface-raised text-content-muted hover:text-content")}>
            <HardDrive className="h-3.5 w-3.5" /> {r.label} <span className="text-2xs text-content-subtle">{formatBytes(r.sizeBytes, 0)}</span>
          </button>
        ))}
        {roots.length === 0 && <span className="text-sm text-content-subtle">Detecting scan targets…</span>}
      </div>

      {/* Tabs */}
      <div className="mb-md flex gap-2xs rounded-lg border border-border bg-surface-sunken/40 p-2xs">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn("flex flex-1 items-center justify-center gap-xs rounded-md px-sm py-xs text-sm font-medium transition-colors", tab === t.id ? "bg-accent/15 text-accent-strong" : "text-content-muted hover:text-content")}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {root && tab === "treemap" && <TreemapTab root={root} setStatus={setStatus} />}
      {root && tab === "files" && <FilesTab root={root} setStatus={setStatus} />}
      {root && tab === "duplicates" && <DuplicatesTab root={root} setStatus={setStatus} />}
      {tab === "apps" && <AppsTab />}
    </div>
  );
}

/* -------------------------------- Treemap -------------------------------- */

const COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#ef4444", "#84cc16"];

function TreemapTab({ root, setStatus }: { root: ScanRoot; setStatus: (s: Status) => void }) {
  const [path, setPath] = useState(root.path);
  const [level, setLevel] = useState<TreeLevel | null>(null);
  const [loading, setLoading] = useState(true);
  const runId = useRef(0);

  useEffect(() => { setPath(root.path); }, [root.path]);

  const load = useCallback(async (p: string) => {
    const id = ++runId.current;
    setLoading(true);
    if (!isTauri()) {
      setLevel({ path: p, sizeBytes: root.sizeBytes, children: [
        { name: "Steam", path: p + "/Steam", sizeBytes: 148e9, isDir: true },
        { name: "Videos", path: p + "/Videos", sizeBytes: 54e9, isDir: true },
        { name: "Downloads", path: p + "/Downloads", sizeBytes: 32e9, isDir: true },
        { name: "Projects", path: p + "/Projects", sizeBytes: 18e9, isDir: true },
        { name: "big.iso", path: p + "/big.iso", sizeBytes: 4e9, isDir: false },
      ] });
      setLoading(false);
      return;
    }
    try { const l = await storageTree(p); if (id === runId.current) setLevel(l); }
    catch (e) { if (id === runId.current) setStatus({ kind: "error", msg: String(e) }); }
    finally { if (id === runId.current) setLoading(false); }
  }, [root.sizeBytes, setStatus]);

  useEffect(() => { load(path); }, [path, load]);

  const data = useMemo(() => (level?.children ?? []).filter((c) => c.sizeBytes > 0).map((c, i) => ({
    name: c.name, size: c.sizeBytes, path: c.path, isDir: c.isDir, fill: COLORS[i % COLORS.length],
  })), [level]);

  const crumbs = useMemo(() => {
    const rel = path.startsWith(root.path) ? path.slice(root.path.length) : path;
    const parts = rel.split("/").filter(Boolean);
    const acc: { label: string; path: string }[] = [{ label: root.label, path: root.path }];
    let cur = root.path;
    for (const p of parts) { cur += "/" + p; acc.push({ label: p, path: cur }); }
    return acc;
  }, [path, root]);

  return (
    <GlassCard padding="lg">
      <div className="mb-md flex items-center justify-between gap-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-2xs text-sm">
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex items-center gap-2xs">
              {i > 0 && <ChevronRight className="h-3 w-3 text-content-subtle" />}
              <button onClick={() => setPath(c.path)} className={cn("rounded px-xs py-2xs hover:bg-surface-raised", i === crumbs.length - 1 ? "font-semibold text-content" : "text-content-muted")}>
                {i === 0 ? <Home className="inline h-3.5 w-3.5" /> : c.label}
              </button>
            </span>
          ))}
        </div>
        <span className="shrink-0 text-sm font-semibold text-content">{formatBytes(level?.sizeBytes ?? 0, 1)}</span>
      </div>

      {loading ? (
        <div className="grid h-80 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>
      ) : data.length === 0 ? (
        <EmptyState icon={Layers} title="Empty" description="Nothing to visualize here." className="border-0" />
      ) : (
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <Treemap data={data} dataKey="size" stroke="rgb(var(--color-surface))" isAnimationActive={false}
              content={<TreemapCell onZoom={(p: string, isDir: boolean) => isDir && setPath(p)} />}>
              <Tooltip content={<TreemapTooltip />} />
            </Treemap>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-sm text-2xs text-content-subtle">Click a folder to zoom in · breadcrumb to go back · hover for size.</p>
    </GlassCard>
  );
}

function TreemapCell(props: any) {
  const { x, y, width, height, name, size, path, isDir, fill, onZoom } = props;
  if (width < 2 || height < 2) return null;
  return (
    <g onClick={() => onZoom?.(path, isDir)} style={{ cursor: isDir ? "pointer" : "default" }}>
      <rect x={x} y={y} width={width} height={height} fill={fill} fillOpacity={0.82} stroke="rgb(var(--color-surface))" strokeWidth={2} rx={4} />
      {width > 64 && height > 28 && (
        <>
          <text x={x + 6} y={y + 16} fill="#fff" fontSize={11} fontWeight={600} className="pointer-events-none">{name?.length > 18 ? name.slice(0, 17) + "…" : name}</text>
          <text x={x + 6} y={y + 30} fill="#ffffffcc" fontSize={10} className="pointer-events-none">{formatBytes(size, 1)}</text>
        </>
      )}
    </g>
  );
}

function TreemapTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-sm py-xs text-xs shadow-e3">
      <p className="font-semibold text-content">{d.name}</p>
      <p className="text-content-muted">{formatBytes(d.size, 1)}{d.isDir ? " · folder" : ""}</p>
    </div>
  );
}

/* ----------------------------- Largest files ----------------------------- */

type SortKey = "size" | "modified" | "type";

function FilesTab({ root, setStatus }: { root: ScanRoot; setStatus: (s: Status) => void }) {
  const [limit, setLimit] = useState(50);
  const [sort, setSort] = useState<SortKey>("size");
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const runId = useRef(0);

  const load = useCallback(async () => {
    const id = ++runId.current;
    setFiles(null); setSel(new Set());
    if (!isTauri()) {
      setFiles([
        { name: "ubuntu.iso", path: root.path + "/ubuntu.iso", sizeBytes: 4_700_000_000, modified: Date.now() / 1000 - 86400, ext: "iso" },
        { name: "movie.mkv", path: root.path + "/movie.mkv", sizeBytes: 2_100_000_000, modified: Date.now() / 1000 - 200000, ext: "mkv" },
      ]);
      return;
    }
    try { const fs = await storageLargestFiles(root.path, limit); if (id === runId.current) setFiles(fs); }
    catch (e) { if (id === runId.current) { setStatus({ kind: "error", msg: String(e) }); setFiles([]); } }
  }, [root.path, limit, setStatus]);

  useEffect(() => { load(); }, [load]);

  const sorted = useMemo(() => {
    const arr = [...(files ?? [])];
    arr.sort((a, b) => sort === "modified" ? b.modified - a.modified : sort === "type" ? a.ext.localeCompare(b.ext) || b.sizeBytes - a.sizeBytes : b.sizeBytes - a.sizeBytes);
    return arr;
  }, [files, sort]);

  const allSelected = sorted.length > 0 && sel.size === sorted.length;
  function toggle(p: string) { setSel((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; }); }
  function toggleAll() { setSel(allSelected ? new Set() : new Set(sorted.map((f) => f.path))); }

  async function bulk(action: "trash" | "delete") {
    const paths = [...sel];
    if (paths.length === 0) return;
    const verb = action === "trash" ? "move to Trash" : "permanently delete";
    if (!window.confirm(`${action === "trash" ? "Trash" : "Delete"} ${paths.length} file(s)? This will ${verb} them.`)) return;
    setBusy(true);
    let ok = 0; let lastErr = "";
    for (const p of paths) {
      try { if (isTauri()) await (action === "trash" ? trashFile(p) : deleteFile(p)); ok++; }
      catch (e) { lastErr = String(e); }
    }
    setBusy(false);
    setStatus({ kind: lastErr ? "error" : "ok", msg: lastErr ? `${ok} done · ${lastErr}` : `${action === "trash" ? "Trashed" : "Deleted"} ${ok} file(s).` });
    load();
  }

  return (
    <GlassCard padding="lg">
      <div className="mb-md flex flex-wrap items-center gap-sm">
        <Segment label="Top" value={limit} options={[10, 50, 100]} onChange={setLimit} fmt={(v) => `${v}`} />
        <Segment label="Sort" value={sort} options={["size", "modified", "type"] as SortKey[]} onChange={setSort} fmt={(v) => v} />
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={load}><RotateCw className="h-3.5 w-3.5" /> Rescan</Button>
      </div>

      {/* Bulk action bar */}
      {sel.size > 0 && (
        <div className="mb-sm flex items-center gap-sm rounded-lg border border-accent/30 bg-accent/8 p-sm text-sm">
          <span className="font-medium text-content">{sel.size} selected · {formatBytes(sorted.filter((f) => sel.has(f.path)).reduce((s, f) => s + f.sizeBytes, 0), 1)}</span>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => bulk("trash")}><Trash className="h-3.5 w-3.5" /> Trash</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => bulk("delete")}><Trash2 className="h-3.5 w-3.5 text-danger" /> Delete</Button>
        </div>
      )}

      {files === null ? (
        <div className="grid h-40 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>
      ) : sorted.length === 0 ? (
        <EmptyState icon={FileSearch} title="No files" description="No files found under this target." className="border-0" />
      ) : (
        <div className="max-h-[55vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-[1] bg-surface">
              <tr className="border-b border-border-subtle text-2xs uppercase tracking-wider text-content-subtle">
                <th className="w-8 py-xs pl-2"><button onClick={toggleAll}>{allSelected ? <CheckSquare className="h-4 w-4 text-accent" /> : <Square className="h-4 w-4 text-content-subtle" />}</button></th>
                <th className="py-xs text-left font-medium">Name</th>
                <th className="px-md text-left font-medium">Type</th>
                <th className="px-md text-right font-medium">Size</th>
                <th className="px-md text-right font-medium">Modified</th>
                <th className="px-md font-medium" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((file) => (
                <tr key={file.path} className={cn("border-b border-border-subtle transition-colors hover:bg-surface-raised", sel.has(file.path) && "bg-accent/5")}>
                  <td className="pl-2"><button onClick={() => toggle(file.path)}>{sel.has(file.path) ? <CheckSquare className="h-4 w-4 text-accent" /> : <Square className="h-4 w-4 text-content-subtle" />}</button></td>
                  <td className="py-xs"><span className="font-medium text-content">{file.name}</span><br /><span className="text-2xs text-content-subtle">{file.path}</span></td>
                  <td className="px-md text-content-subtle">{file.ext || "—"}</td>
                  <td className="px-md text-right font-semibold tabular-nums text-content">{formatBytes(file.sizeBytes, 1)}</td>
                  <td className="px-md text-right tabular-nums text-content-subtle">{file.modified ? new Date(file.modified * 1000).toLocaleDateString() : "—"}</td>
                  <td className="px-md"><div className="flex justify-end gap-2xs">
                    <IconBtn icon={FolderOpen} title="Reveal" onClick={() => isTauri() && revealFile(file.path)} />
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GlassCard>
  );
}

/* ----------------------------- Duplicates -------------------------------- */

const DUP_CATS: { id: DupCategory; label: string }[] = [
  { id: "generic", label: "All" },
  { id: "images", label: "Images" },
  { id: "videos", label: "Videos" },
  { id: "archives", label: "Archives" },
  { id: "isos", label: "ISOs" },
];

function DuplicatesTab({ root, setStatus }: { root: ScanRoot; setStatus: (s: Status) => void }) {
  const [cat, setCat] = useState<DupCategory>("generic");
  const [groups, setGroups] = useState<DupGroup[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const runId = useRef(0);

  const load = useCallback(async () => {
    const id = ++runId.current;
    setGroups(null); setSel(new Set());
    if (!isTauri()) {
      setGroups([{ sizeBytes: 2e9, wastedBytes: 2e9, files: [
        { name: "movie.mkv", path: root.path + "/a/movie.mkv", sizeBytes: 2e9, modified: 0, ext: "mkv" },
        { name: "movie copy.mkv", path: root.path + "/b/movie copy.mkv", sizeBytes: 2e9, modified: 0, ext: "mkv" },
      ] }]);
      return;
    }
    try { const g = await storageDuplicates(root.path, cat); if (id === runId.current) setGroups(g); }
    catch (e) { if (id === runId.current) { setStatus({ kind: "error", msg: String(e) }); setGroups([]); } }
  }, [root.path, cat, setStatus]);

  useEffect(() => { load(); }, [load]);

  const wasted = useMemo(() => (groups ?? []).reduce((s, g) => s + g.wastedBytes, 0), [groups]);
  function toggle(p: string) { setSel((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; }); }

  async function trashSelected() {
    const paths = [...sel];
    if (!paths.length) return;
    if (!window.confirm(`Move ${paths.length} duplicate(s) to Trash?`)) return;
    setBusy(true);
    let ok = 0; let lastErr = "";
    for (const p of paths) { try { if (isTauri()) await trashFile(p); ok++; } catch (e) { lastErr = String(e); } }
    setBusy(false);
    setStatus({ kind: lastErr ? "error" : "ok", msg: lastErr ? `${ok} trashed · ${lastErr}` : `Trashed ${ok} duplicate(s).` });
    load();
  }

  return (
    <GlassCard padding="lg">
      <div className="mb-md flex flex-wrap items-center gap-sm">
        <Segment label="Type" value={cat} options={DUP_CATS.map((c) => c.id)} onChange={setCat} fmt={(v) => DUP_CATS.find((c) => c.id === v)?.label ?? v} />
        <div className="flex-1" />
        {groups && groups.length > 0 && <Badge variant="warning">{formatBytes(wasted, 1)} reclaimable</Badge>}
        <Button variant="ghost" size="sm" onClick={load}><RotateCw className="h-3.5 w-3.5" /> Rescan</Button>
      </div>

      {sel.size > 0 && (
        <div className="mb-sm flex items-center gap-sm rounded-lg border border-accent/30 bg-accent/8 p-sm text-sm">
          <span className="font-medium text-content">{sel.size} selected</span>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" disabled={busy} onClick={trashSelected}><Trash className="h-3.5 w-3.5" /> Trash selected</Button>
        </div>
      )}

      {groups === null ? (
        <div className="grid h-40 place-items-center text-content-muted"><div className="flex items-center gap-sm"><Loader2 className="h-5 w-5 animate-spin" /> Hashing files…</div></div>
      ) : groups.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No duplicates" description="No duplicate files found for this category." className="border-0" />
      ) : (
        <div className="space-y-md">
          {groups.map((g, i) => (
            <div key={i} className="rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
              <div className="mb-sm flex items-center justify-between text-xs">
                <span className="font-medium text-content">{g.files.length} copies · {formatBytes(g.sizeBytes, 1)} each</span>
                <Badge size="sm" variant="warning">{formatBytes(g.wastedBytes, 1)} wasted</Badge>
              </div>
              <div className="space-y-2xs">
                {g.files.map((file, idx) => (
                  <label key={file.path} className="flex items-center gap-sm rounded-md px-sm py-2xs hover:bg-surface-raised">
                    <button onClick={() => toggle(file.path)}>{sel.has(file.path) ? <CheckSquare className="h-4 w-4 text-accent" /> : <Square className="h-4 w-4 text-content-subtle" />}</button>
                    <code className="min-w-0 flex-1 truncate text-2xs text-content-muted">{file.path}</code>
                    {idx === 0 && <Badge size="sm" variant="success">keep</Badge>}
                    <IconBtn icon={FolderOpen} title="Reveal" onClick={() => isTauri() && revealFile(file.path)} />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}

/* ----------------------------- Space by app ------------------------------ */

function AppsTab() {
  const [apps, setApps] = useState<AppUsage[] | null>(null);
  useEffect(() => {
    if (!isTauri()) { setApps([
      { app: "Steam", totalBytes: 148e9, configBytes: 0, cacheBytes: 2e9, dataBytes: 146e9, present: true },
      { app: "Chrome", totalBytes: 3.2e9, configBytes: 1.1e9, cacheBytes: 2.1e9, dataBytes: 0, present: true },
      { app: "Docker", totalBytes: 22e9, configBytes: 0, cacheBytes: 0, dataBytes: 22e9, present: true },
    ]); return; }
    storageSpaceByApp().then(setApps).catch(() => setApps([]));
  }, []);

  const max = useMemo(() => Math.max(1, ...(apps ?? []).map((a) => a.totalBytes)), [apps]);

  return (
    <GlassCard padding="lg">
      {apps === null ? (
        <div className="grid h-40 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>
      ) : apps.length === 0 ? (
        <EmptyState icon={Boxes} title="No app data" description="No known applications with measurable storage were found." className="border-0" />
      ) : (
        <motion.div variants={stagger(0.04)} initial="hidden" animate="show" className="space-y-md">
          {apps.map((a) => (
            <motion.div key={a.app} variants={fadeUp}>
              <div className="mb-2xs flex items-center justify-between">
                <span className="text-sm font-semibold text-content">{a.app}</span>
                <span className="text-sm font-semibold tabular-nums text-content">{formatBytes(a.totalBytes, 1)}</span>
              </div>
              <Meter value={(a.totalBytes / max) * 100} tone="accent" />
              <div className="mt-2xs flex gap-md text-2xs text-content-subtle">
                {a.dataBytes > 0 && <span>Data {formatBytes(a.dataBytes, 1)}</span>}
                {a.cacheBytes > 0 && <span>Cache {formatBytes(a.cacheBytes, 1)}</span>}
                {a.configBytes > 0 && <span>Config {formatBytes(a.configBytes, 1)}</span>}
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}
    </GlassCard>
  );
}

/* ------------------------------- helpers --------------------------------- */

function Segment<T extends string | number>({ label, value, options, onChange, fmt }: { label: string; value: T; options: T[]; onChange: (v: T) => void; fmt: (v: T) => string }) {
  return (
    <div className="flex items-center gap-xs">
      <span className="text-2xs uppercase tracking-wider text-content-subtle">{label}</span>
      <div className="flex rounded-md border border-border p-2xs">
        {options.map((o) => (
          <button key={String(o)} onClick={() => onChange(o)} className={cn("rounded px-sm py-2xs text-xs font-medium capitalize transition-colors", value === o ? "bg-accent/15 text-accent-strong" : "text-content-muted hover:text-content")}>{fmt(o)}</button>
        ))}
      </div>
    </div>
  );
}

function IconBtn({ icon: Icon, title, onClick }: { icon: LucideIcon; title: string; onClick: () => void }) {
  return <button title={title} onClick={onClick} className="rounded p-1 text-content-subtle hover:text-content"><Icon className="h-3.5 w-3.5" /></button>;
}
