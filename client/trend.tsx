import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  Text,
  View,
} from "react-native";
import type { Option, Timeline, TimelineSeries } from "../shared/stats";
import {
  BUCKET_MS,
  axisLabelLeft,
  labelIndexes,
  niceCeil,
  peakIndex,
} from "./chart";
import {
  bucketLabel,
  bucketRange,
  compact as short,
  percent,
  usd,
  usdCompact,
} from "./format";
import type { Language, PlainKey, Translate } from "./i18n";
import { assignSlots, seriesColors } from "./palette";
import { TABULAR, cardStyle, sectionTitleStyle } from "./ui";

type Metric = "cost" | "tokens";
type Stack = "provider" | "model" | "none";

const METRICS: { id: Metric; label: PlainKey }[] = [
  { id: "cost", label: "trend.metric.cost" },
  { id: "tokens", label: "trend.metric.tokens" },
];
const STACKS: { id: Stack; label: PlainKey }[] = [
  { id: "provider", label: "trend.stack.provider" },
  { id: "model", label: "trend.stack.model" },
  { id: "none", label: "trend.stack.none" },
];
const BAR_MAX = 24;
const GAP = 2;
const AXIS_WIDTH = 48;
const LABEL_WIDTH = 76;
// Tick labels sit centred on their gridlines, so half a label hangs above the
// top line and below the baseline. These keep that clear of the summary above
// and the date labels below, with some air.
const TICK_LINE = 14;
const LABEL_GAP = 16;
const PLOT_TOP = 14;
const X_AXIS_GAP = 10;
const GROW_MS = 450;

interface Layer {
  key: string;
  label: string;
  color: string;
  values: number[];
  total: number;
}

export interface TrendChartProps {
  timeline: Timeline;
  options: { providers: readonly Option[]; models: readonly Option[] };
  onZoom(range: { from: number; to: number }): void;
  theme: PluginTheme;
  compact: boolean;
  language: Language;
  t: Translate;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => live && setReduced(value))
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

export function TrendChart({
  timeline,
  options,
  onZoom,
  theme,
  compact,
  language,
  t,
}: TrendChartProps) {
  const [chosen, setMetric] = useState<Metric>("cost");
  const [stack, setStack] = useState<Stack>("provider");
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const reducedMotion = useReducedMotion();
  const grow = useRef(new Animated.Value(1)).current;
  const plotHeight = compact ? 128 : 168;
  const count = timeline.starts.length;
  const firstStart = timeline.starts[0];
  // With nothing priced, cost is all zero; show tokens rather than an empty
  // chart, as the model table does.
  const unpriced =
    timeline.costUsd.every((value) => value === 0) &&
    timeline.tokens.some((value) => value > 0);
  const metric: Metric = unpriced ? "tokens" : chosen;

  // A new range or metric starts afresh and grows from the baseline.
  useEffect(() => {
    setSelected(null);
    setHovered(null);
    if (reducedMotion) {
      grow.setValue(1);
      return;
    }
    grow.setValue(0);
    const animation = Animated.timing(grow, {
      toValue: 1,
      duration: GROW_MS,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [firstStart, count, timeline.unit, metric, stack, reducedMotion, grow]);

  const pick = (series: TimelineSeries) =>
    metric === "cost" ? series.costUsd : series.tokens;
  const totals = metric === "cost" ? timeline.costUsd : timeline.tokens;
  const format = metric === "cost" ? usd : short;
  const formatAxis = metric === "cost" ? usdCompact : short;

  const layers = useMemo<Layer[]>(() => {
    const sum = (values: readonly number[]) =>
      values.reduce((a, b) => a + b, 0);
    if (stack === "none") {
      return [
        {
          key: "total",
          label: t("trend.stack.none"),
          color: theme.colors.accent,
          values: [...totals],
          total: sum(totals),
        },
      ];
    }
    const series =
      stack === "provider" ? timeline.byProvider : timeline.byModel;
    const order = (
      stack === "provider" ? options.providers : options.models
    ).map((option) => option.value);
    const named = series.filter((entry) => entry.key !== null);
    const slots = assignSlots(
      named.map((entry) => entry.key as string),
      order,
    );
    const palette = seriesColors(theme);
    const result = series.map((entry) => {
      const slot = entry.key === null ? -1 : (slots.get(entry.key) ?? -1);
      return {
        key: entry.key ?? "__other__",
        label: entry.key === null ? t("trend.other") : entry.label,
        color: slot >= 0 ? palette[slot] : theme.colors.foregroundMuted,
        values: pick(entry),
        total: sum(pick(entry)),
        slot: slot >= 0 ? slot : Number.MAX_SAFE_INTEGER,
      };
    });
    // Stack in slot order so a series keeps its place, with Other on top.
    result.sort((a, b) => a.slot - b.slot);
    return result.filter((layer) => layer.total > 0);
  }, [timeline, stack, metric, options, theme, t]);

  const max = niceCeil(Math.max(0, ...totals));
  const grandTotal = totals.reduce((a, b) => a + b, 0);
  const tokenTotal = timeline.tokens.reduce((a, b) => a + b, 0);
  const peak = peakIndex(totals);
  const active = hovered ?? selected;
  const ticks = max > 0 ? [max, max / 2, 0] : [];

  const styles = useMemo(
    () => ({
      card: cardStyle(theme, compact),
      header: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 8,
      },
      titleRow: {
        flexDirection: "row" as const,
        alignItems: "baseline" as const,
        gap: 8,
      },
      title: sectionTitleStyle(theme),
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      controls: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 8,
      },
      segment: {
        flexDirection: "row" as const,
        padding: 2,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      segmentItem: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
      },
      segmentActive: { backgroundColor: theme.colors.surface2 },
      segmentText: { color: theme.colors.foregroundMuted, fontSize: 12 },
      segmentTextActive: {
        color: theme.colors.foreground,
        fontWeight: "600" as const,
      },
      summary: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "baseline" as const,
        gap: 12,
      },
      total: {
        color: theme.colors.foreground,
        fontSize: 18,
        fontWeight: "600" as const,
        ...TABULAR,
      },
      chart: { paddingTop: PLOT_TOP },
      plot: { flexDirection: "row" as const, height: plotHeight },
      axis: { width: AXIS_WIDTH, height: plotHeight },
      tick: {
        position: "absolute" as const,
        left: 0,
        width: AXIS_WIDTH - 8,
        textAlign: "right" as const,
        height: TICK_LINE,
        lineHeight: TICK_LINE,
        color: theme.colors.foregroundMuted,
        fontSize: 10,
        ...TABULAR,
      },
      area: { flex: 1, height: plotHeight },
      grid: {
        position: "absolute" as const,
        left: 0,
        right: 0,
        height: 1,
        backgroundColor: theme.colors.border,
      },
      column: {
        flex: 1,
        height: plotHeight,
        alignItems: "center" as const,
        justifyContent: "flex-end" as const,
      },
      band: { backgroundColor: theme.colors.surface2, borderRadius: 4 },
      xAxis: {
        height: TICK_LINE,
        marginTop: X_AXIS_GAP,
        marginLeft: AXIS_WIDTH,
      },
      xLabel: {
        position: "absolute" as const,
        top: 0,
        width: LABEL_WIDTH,
        height: TICK_LINE,
        lineHeight: TICK_LINE,
        textAlign: "center" as const,
        color: theme.colors.foregroundMuted,
        fontSize: 10,
        ...TABULAR,
      },
      legend: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 12,
      },
      legendItem: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
      },
      swatch: { width: 10, height: 10, borderRadius: 3 },
      legendText: { color: theme.colors.foreground, fontSize: 12 },
      legendValue: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        ...TABULAR,
      },
      detail: {
        gap: 4,
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      detailHead: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 8,
      },
      detailTitle: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "600" as const,
      },
      detailRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
      },
      detailValue: {
        color: theme.colors.foreground,
        fontSize: 12,
        marginLeft: "auto" as const,
        ...TABULAR,
      },
      link: { color: theme.colors.accent, fontSize: 12 },
      empty: {
        color: theme.colors.foregroundMuted,
        fontSize: 13,
        paddingVertical: 24,
        textAlign: "center" as const,
      },
    }),
    [theme, compact, plotHeight],
  );

  const segmentControl = <Id extends string>(
    items: { id: Id; label: PlainKey }[],
    value: Id,
    onChange: (id: Id) => void,
    disabled: readonly Id[] = [],
  ) => (
    <View style={styles.segment} accessibilityRole="radiogroup">
      {items.map(({ id, label }) => {
        const on = id === value;
        return (
          <Pressable
            key={id}
            accessibilityRole="radio"
            accessibilityState={{
              checked: on,
              disabled: disabled.includes(id),
            }}
            disabled={disabled.includes(id)}
            onPress={() => onChange(id)}
            style={[
              styles.segmentItem,
              on ? styles.segmentActive : null,
              disabled.includes(id) ? { opacity: 0.4 } : null,
            ]}
          >
            <Text
              style={[styles.segmentText, on ? styles.segmentTextActive : null]}
            >
              {t(label)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const barWidth = (width: number) =>
    Math.max(2, Math.min(BAR_MAX, width * (count > 48 ? 0.8 : 0.6)));
  const [areaWidth, setAreaWidth] = useState(0);
  const columnWidth = count > 0 ? areaWidth / count : 0;
  // As many date labels as fit side by side, with a gap between them.
  const labels =
    areaWidth > 0
      ? labelIndexes(
          count,
          Math.max(2, Math.floor(areaWidth / (LABEL_WIDTH + LABEL_GAP))),
        )
      : [];
  const scale = (value: number) => (max > 0 ? (value / max) * plotHeight : 0);
  const visibleHeight = grow.interpolate({
    inputRange: [0, 1],
    outputRange: [0, plotHeight],
  });

  const detail =
    active !== null && active >= 0 && active < count ? active : null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{t("trend.title")}</Text>
          <Text style={styles.muted}>{t(`trend.bucket.${timeline.unit}`)}</Text>
        </View>
        <View style={styles.controls}>
          {segmentControl(METRICS, metric, setMetric, unpriced ? ["cost"] : [])}
          {segmentControl(STACKS, stack, setStack)}
        </View>
      </View>

      {tokenTotal <= 0 ? (
        <Text style={styles.empty}>{t("trend.empty")}</Text>
      ) : (
        <>
          <View style={styles.summary}>
            <Text style={styles.total}>
              {t("trend.total", { value: format(grandTotal) })}
            </Text>
            {peak >= 0 ? (
              <Text style={styles.muted}>
                {t("trend.peak", {
                  value: format(totals[peak]),
                  time: bucketRange(
                    timeline.starts[peak],
                    timeline.unit,
                    language,
                  ),
                })}
              </Text>
            ) : null}
          </View>

          <View style={styles.chart}>
            <View style={styles.plot}>
              <View style={styles.axis}>
                {ticks.map((tick) => (
                  <Text
                    key={tick}
                    style={[
                      styles.tick,
                      { top: plotHeight - scale(tick) - TICK_LINE / 2 },
                    ]}
                  >
                    {formatAxis(tick)}
                  </Text>
                ))}
              </View>
              <View
                style={styles.area}
                onLayout={(event) =>
                  setAreaWidth(event.nativeEvent.layout.width)
                }
              >
                {ticks.map((tick) => (
                  <View
                    key={tick}
                    pointerEvents="none"
                    style={[styles.grid, { top: plotHeight - scale(tick) }]}
                  />
                ))}
                {detail !== null && columnWidth > 0 ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.band,
                      {
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: detail * columnWidth,
                        width: columnWidth,
                        opacity: 0.6,
                      },
                    ]}
                  />
                ) : null}
                <Animated.View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: visibleHeight,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: 0,
                      height: plotHeight,
                      flexDirection: "row",
                    }}
                  >
                    {timeline.starts.map((start, index) => (
                      <View key={start} style={styles.column}>
                        <Stack
                          layers={layers}
                          index={index}
                          width={barWidth(columnWidth)}
                          scale={scale}
                          dim={detail !== null && detail !== index}
                        />
                      </View>
                    ))}
                  </View>
                </Animated.View>
                <View
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    bottom: 0,
                    flexDirection: "row",
                  }}
                >
                  {timeline.starts.map((start, index) => (
                    <Pressable
                      key={start}
                      accessibilityRole="button"
                      accessibilityLabel={t("trend.barLabel", {
                        time: bucketRange(start, timeline.unit, language),
                        value: format(totals[index]),
                      })}
                      accessibilityState={{ selected: selected === index }}
                      onPress={() =>
                        setSelected((current) =>
                          current === index ? null : index,
                        )
                      }
                      onHoverIn={() => setHovered(index)}
                      onHoverOut={() =>
                        setHovered((current) =>
                          current === index ? null : current,
                        )
                      }
                      style={{ flex: 1 }}
                    />
                  ))}
                </View>
              </View>
            </View>
            <View style={styles.xAxis}>
              {labels.map((index, position) => (
                <Text
                  key={timeline.starts[index]}
                  numberOfLines={1}
                  style={[
                    styles.xLabel,
                    {
                      left: axisLabelLeft(
                        index,
                        count,
                        areaWidth,
                        LABEL_WIDTH,
                        AXIS_WIDTH - 4,
                      ),
                    },
                  ]}
                >
                  {bucketLabel(
                    timeline.starts[index],
                    timeline.unit,
                    language,
                    position > 0 ? timeline.starts[labels[position - 1]] : null,
                  )}
                </Text>
              ))}
            </View>
          </View>

          {layers.length > 1 ? (
            <View style={styles.legend}>
              {layers.map((layer) => (
                <View key={layer.key} style={styles.legendItem}>
                  <View
                    style={[styles.swatch, { backgroundColor: layer.color }]}
                  />
                  <Text style={styles.legendText} numberOfLines={1}>
                    {layer.label}
                  </Text>
                  <Text style={styles.legendValue}>{format(layer.total)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {detail !== null ? (
            <View style={styles.detail}>
              <View style={styles.detailHead}>
                <Text style={styles.detailTitle}>
                  {bucketRange(
                    timeline.starts[detail],
                    timeline.unit,
                    language,
                  )}
                  {" · "}
                  {format(totals[detail])}
                </Text>
                {totals[detail] > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      onZoom({
                        from: timeline.starts[detail],
                        to: timeline.starts[detail] + BUCKET_MS[timeline.unit],
                      })
                    }
                  >
                    <Text style={styles.link}>{t("trend.zoom")}</Text>
                  </Pressable>
                ) : null}
              </View>
              {layers.length > 1
                ? layers
                    .filter((layer) => layer.values[detail] > 0)
                    .map((layer) => (
                      <View key={layer.key} style={styles.detailRow}>
                        <View
                          style={[
                            styles.swatch,
                            { backgroundColor: layer.color },
                          ]}
                        />
                        <Text style={styles.legendText} numberOfLines={1}>
                          {layer.label}
                        </Text>
                        <Text style={styles.detailValue}>
                          {format(layer.values[detail])} ·{" "}
                          {percent(layer.values[detail], totals[detail])}
                        </Text>
                      </View>
                    ))
                : null}
              <Text style={styles.muted}>
                {t("kpi.requests")} {short(timeline.requests[detail])}
              </Text>
            </View>
          ) : (
            <Text style={styles.muted}>{t("trend.hint")}</Text>
          )}
        </>
      )}
    </View>
  );
}

// One column: segments stacked from the baseline, separated by a 2px gap in
// the card colour, with a rounded top on the uppermost segment.
function Stack({
  layers,
  index,
  width,
  scale,
  dim,
}: {
  layers: readonly Layer[];
  index: number;
  width: number;
  scale(value: number): number;
  dim: boolean;
}) {
  const parts = layers
    .map((layer) => ({ layer, height: scale(layer.values[index]) }))
    .filter((part) => part.height > 0);
  return (
    <View
      style={{
        width,
        flexDirection: "column-reverse",
        opacity: dim ? 0.45 : 1,
      }}
    >
      {parts.map(({ layer, height }, i) => {
        const top = i === parts.length - 1;
        const gap = i > 0 ? GAP : 0;
        return (
          <View
            key={layer.key}
            style={{
              height: Math.max(1, height - gap),
              marginBottom: gap,
              backgroundColor: layer.color,
              borderTopLeftRadius: top ? Math.min(4, width / 2) : 0,
              borderTopRightRadius: top ? Math.min(4, width / 2) : 0,
            }}
          />
        );
      })}
    </View>
  );
}
