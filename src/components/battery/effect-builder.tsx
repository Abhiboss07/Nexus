import { useState } from "react";
import { ArrowUp, ArrowDown, Trash2, Plus, X, RotateCcw } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { BatteryGlyph, type GlyphOverride } from "@/components/battery/battery-glyph";
import {
  useBatteryEventsStore,
  LAYER_TYPES,
  EASES,
  COLOR_TOKENS,
  type CustomEffect,
  type EffectLayer,
  type LayerType,
  type EaseId,
  type ColorToken,
} from "@/store/battery-events-store";

/**
 * Layered effect editor: add / reorder / tune composable animation layers and
 * watch the result on a live battery preview. Edits write straight to the store;
 * the preview remounts on every change so one-shot layers replay immediately.
 */
export function EffectBuilder({ effect, onDelete }: { effect: CustomEffect; onDelete: () => void }) {
  const renameEffect = useBatteryEventsStore((s) => s.renameEffect);
  const deleteEffect = useBatteryEventsStore((s) => s.deleteEffect);
  const addLayer = useBatteryEventsStore((s) => s.addLayer);
  const updateLayer = useBatteryEventsStore((s) => s.updateLayer);
  const removeLayer = useBatteryEventsStore((s) => s.removeLayer);
  const moveLayer = useBatteryEventsStore((s) => s.moveLayer);

  const [previewKey, setPreviewKey] = useState(0);
  const replay = () => setPreviewKey((n) => n + 1);

  const override: GlyphOverride = { anim: "none", kind: "continuous", nonce: 0, effect };

  return (
    <div className="space-y-md rounded-lg border border-accent/30 bg-surface-sunken/40 p-md">
      <div className="flex items-center gap-sm">
        <input
          value={effect.name}
          onChange={(e) => renameEffect(effect.id, e.target.value)}
          className="flex-1 rounded-md border border-border bg-surface-sunken px-sm py-1 text-sm font-medium text-content outline-none focus:border-accent/60"
        />
        <button
          onClick={() => {
            deleteEffect(effect.id);
            onDelete();
          }}
          className="inline-flex items-center gap-xs rounded-md border border-border px-sm py-1 text-2xs text-content-muted transition-colors hover:text-danger"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete effect
        </button>
      </div>

      <div className="grid grid-cols-1 gap-md sm:grid-cols-[auto_1fr]">
        {/* Live preview */}
        <div className="flex flex-col items-center justify-center gap-sm rounded-lg border border-border-subtle bg-canvas/40 px-lg py-md">
          <BatteryGlyph key={previewKey} level={72} charging override={override} />
          <button
            onClick={replay}
            className="inline-flex items-center gap-xs rounded-md border border-border px-sm py-1 text-2xs font-medium text-content-muted transition-colors hover:text-content"
          >
            <RotateCcw className="h-3 w-3" /> Replay
          </button>
        </div>

        {/* Layers */}
        <div className="space-y-sm">
          {effect.layers.length === 0 && (
            <p className="rounded-md border border-dashed border-border-subtle p-md text-center text-2xs text-content-subtle">
              No layers yet — add one below.
            </p>
          )}
          {effect.layers.map((layer, i) => (
            <LayerCard
              key={layer.id}
              layer={layer}
              first={i === 0}
              last={i === effect.layers.length - 1}
              onChange={(patch) => {
                updateLayer(effect.id, layer.id, patch);
                replay();
              }}
              onMove={(dir) => {
                moveLayer(effect.id, layer.id, dir);
                replay();
              }}
              onRemove={() => {
                removeLayer(effect.id, layer.id);
                replay();
              }}
            />
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              addLayer(effect.id, "glow");
              replay();
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add layer
          </Button>
        </div>
      </div>
    </div>
  );
}

function LayerCard({
  layer,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  layer: EffectLayer;
  first: boolean;
  last: boolean;
  onChange: (patch: Partial<EffectLayer>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-sm rounded-lg border border-border-subtle bg-surface-sunken/50 p-sm">
      <div className="flex items-center gap-xs">
        <Select value={layer.type} onChange={(v) => onChange({ type: v as LayerType })} options={LAYER_TYPES} />
        <div className="ml-auto flex items-center gap-1">
          <IconBtn disabled={first} onClick={() => onMove(-1)} title="Move up">
            <ArrowUp className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn disabled={last} onClick={() => onMove(1)} title="Move down">
            <ArrowDown className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn onClick={onRemove} title="Remove" danger>
            <X className="h-3.5 w-3.5" />
          </IconBtn>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-md gap-y-xs">
        <FieldLabel>Ease</FieldLabel>
        <Select value={layer.ease} onChange={(v) => onChange({ ease: v as EaseId })} options={EASES} />
        <FieldLabel>Color</FieldLabel>
        <Select value={layer.color} onChange={(v) => onChange({ color: v as ColorToken })} options={COLOR_TOKENS} />
        <label className="flex items-center gap-xs">
          <FieldLabel>Loop</FieldLabel>
          <Switch checked={layer.repeat} onCheckedChange={(v) => onChange({ repeat: v })} />
        </label>
      </div>

      <SliderRow label="Delay" value={layer.delay} min={0} max={3000} step={50} suffix="ms" onChange={(v) => onChange({ delay: v })} />
      <SliderRow label="Duration" value={layer.duration} min={100} max={4000} step={50} suffix="ms" onChange={(v) => onChange({ duration: v })} />
      <SliderRow
        label="Intensity"
        value={Math.round(layer.intensity * 100)}
        min={0}
        max={100}
        step={5}
        suffix="%"
        onChange={(v) => onChange({ intensity: v / 100 })}
      />
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-sm">
      <span className="w-16 text-2xs text-content-muted">{label}</span>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} className="flex-1" />
      <span className="w-12 text-right text-2xs tabular-nums text-content-subtle">
        {value}
        {suffix}
      </span>
    </div>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="rounded-md border border-border bg-surface-sunken px-sm py-1 text-2xs text-content outline-none focus:border-accent/60"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-2xs font-medium text-content-muted">{children}</span>;
}

function IconBtn({
  children,
  onClick,
  disabled,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={
        "rounded-md border border-border p-1 text-content-subtle transition-colors hover:text-content disabled:opacity-30 " +
        (danger ? "hover:text-danger" : "")
      }
    >
      {children}
    </button>
  );
}
