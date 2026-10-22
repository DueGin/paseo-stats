import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import {
  Icon,
  ScrollView,
  TextInput,
} from "@getpaseo/plugin/client/react-native";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { NO_PROJECT_KEY, statsQueryRpc, type Option } from "../shared/stats";
import { Breakdown, type Dimension, type SortKey } from "./breakdown";
import { CollaborationSection } from "./collaboration";
import { CoverageNote } from "./coverage";
import { dateTime, parseInputValue, toInputValue } from "./format";
import { useI18n } from "./i18n";
import { MultiSelect } from "./multi-select";
import { Summary } from "./summary";
import { UpdateBanner } from "./update";
import {
  RANGE_PRESETS,
  presetRange,
  type RangePreset,
  type TimeRange,
} from "./time-range";

type Filters = Record<Dimension, string[]>;

const EMPTY_FILTERS: Filters = { provider: [], model: [], project: [] };

export function StatsScreen({ theme, layout, navigation }: PluginScreenProps) {
  const { compact } = layout;
  const { language, t } = useI18n();
  const runQuery = useRpc(statsQueryRpc);

  const [preset, setPreset] = useState<RangePreset>("24h");
  const [custom, setCustom] = useState<TimeRange | null>(null);
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [customError, setCustomError] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [openSelect, setOpenSelect] = useState<Dimension | null>(null);
  const [dimension, setDimension] = useState<Dimension>("provider");
  const [sort, setSort] = useState<SortKey>("cost");
  const forceRefresh = useRef(false);

  const stats = useQuery({
    queryKey: ["paseo-stats", preset, custom?.from, custom?.to, filters],
    enabled: preset !== "custom" || custom !== null,
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.coverage.syncing ? 2_000 : 60_000,
    queryFn: () => {
      const range =
        preset !== "custom" ? presetRange(preset, Date.now()) : custom;
      if (!range) throw new Error("custom range is not set");
      const refresh = forceRefresh.current;
      forceRefresh.current = false;
      return runQuery({
        ...range,
        providers: filters.provider,
        models: filters.model,
        projects: filters.project,
        refresh,
      });
    },
  });
  const data = stats.data;

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      toolbar: {
        paddingHorizontal: compact ? 12 : 24,
        paddingTop: compact ? 12 : 20,
        paddingBottom: 12,
        gap: 10,
        zIndex: 20,
        elevation: openSelect ? 20 : 0,
        backgroundColor: theme.colors.surface0,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      titleRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
      },
      title: {
        color: theme.colors.foreground,
        fontSize: compact ? 18 : 20,
        fontWeight: "600" as const,
        flexShrink: 1,
      },
      status: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        flex: 1,
      },
      statusText: { color: theme.colors.foregroundMuted, fontSize: 12 },
      iconButton: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      buttonText: { color: theme.colors.foreground, fontSize: 13 },
      filterRow: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 8,
      },
      segment: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        maxWidth: "100%" as const,
        padding: 2,
        borderRadius: 8,
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      segmentItem: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 6,
      },
      segmentActive: { backgroundColor: theme.colors.accent },
      segmentText: { color: theme.colors.foregroundMuted, fontSize: 13 },
      segmentTextActive: {
        color: theme.colors.accentForeground,
        fontWeight: "600" as const,
      },
      customRow: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 8,
      },
      customLabel: { color: theme.colors.foregroundMuted, fontSize: 13 },
      input: {
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: customError
          ? theme.colors.statusDanger
          : theme.colors.border,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        fontSize: 13,
        minWidth: 150,
        ...(compact ? { flexGrow: 1 } : null),
      },
      primary: {
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 8,
        backgroundColor: theme.colors.accent,
      },
      primaryText: {
        color: theme.colors.accentForeground,
        fontSize: 13,
        fontWeight: "600" as const,
      },
      link: { paddingHorizontal: 6, paddingVertical: 6 },
      linkText: { color: theme.colors.accent, fontSize: 13 },
      error: { color: theme.colors.statusDanger, fontSize: 12 },
      backdrop: {
        position: "absolute" as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10,
      },
      body: {
        padding: compact ? 12 : 24,
        gap: compact ? 12 : 16,
        paddingBottom: 48,
      },
      centered: {
        paddingVertical: 48,
        alignItems: "center" as const,
        gap: 12,
      },
      muted: { color: theme.colors.foregroundMuted, fontSize: 13 },
    }),
    [theme, compact, openSelect, customError],
  );

  const choosePreset = (next: RangePreset) => {
    setPreset(next);
    if (next === "custom" && !custom) {
      const range = presetRange("24h", Date.now());
      setDraftFrom(toInputValue(range.from));
      setDraftTo(toInputValue(range.to));
      setCustom(range);
    }
  };

  const applyCustom = () => {
    const from = parseInputValue(draftFrom);
    const to = parseInputValue(draftTo);
    if (from === null || to === null || from >= to) {
      setCustomError(true);
      return;
    }
    setCustomError(false);
    setCustom({ from, to });
  };

  const setFilter = (key: Dimension, values: string[]) =>
    setFilters((current) => ({ ...current, [key]: values }));

  const pick = (key: Dimension, value: string) =>
    setFilters((current) => ({
      ...current,
      [key]:
        current[key].length === 1 && current[key][0] === value ? [] : [value],
    }));

  const refresh = () => {
    forceRefresh.current = true;
    void stats.refetch();
  };

  const projectLabel = (option: Option) =>
    option.value === NO_PROJECT_KEY
      ? t("noProject")
      : option.label || option.value;
  const providerLabel = (provider: string) =>
    data?.options.providers.find((option) => option.value === provider)
      ?.label ?? provider;
  const hasFilters =
    filters.provider.length + filters.model.length + filters.project.length > 0;
  const syncing = stats.isFetching || data?.coverage.syncing;

  const selectProps = (key: Dimension) => ({
    selected: filters[key],
    onChange: (values: string[]) => setFilter(key, values),
    open: openSelect === key,
    onOpenChange: (open: boolean) => setOpenSelect(open ? key : null),
    theme,
    compact,
    t,
  });

  const rows =
    dimension === "provider"
      ? data?.byProvider
      : dimension === "model"
        ? data?.byModel
        : data?.byProject;

  return (
    <View style={styles.screen}>
      <View style={styles.toolbar}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{t("app.title")}</Text>
          <View style={styles.status}>
            {syncing ? (
              <ActivityIndicator
                size="small"
                color={theme.colors.foregroundMuted}
              />
            ) : null}
            <Text style={styles.statusText} numberOfLines={1}>
              {data?.coverage.syncing
                ? t("status.syncing")
                : data
                  ? t("status.updated", {
                      time: dateTime(data.generatedAt, language),
                    })
                  : ""}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("status.refresh")}
            onPress={refresh}
            style={styles.iconButton}
          >
            <Icon name="RefreshCw" size={14} color={theme.colors.foreground} />
            {compact ? null : (
              <Text style={styles.buttonText}>{t("status.refresh")}</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.filterRow}>
          <View style={styles.segment} accessibilityRole="radiogroup">
            {RANGE_PRESETS.map((id) => {
              const active = id === preset;
              return (
                <Pressable
                  key={id}
                  accessibilityRole="radio"
                  accessibilityLabel={t(`range.${id}`)}
                  accessibilityState={{ checked: active }}
                  onPress={() => choosePreset(id)}
                  style={[
                    styles.segmentItem,
                    active ? styles.segmentActive : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      active ? styles.segmentTextActive : null,
                    ]}
                  >
                    {t(`range.${id}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <MultiSelect
            label={t("filter.provider")}
            options={data?.options.providers ?? []}
            {...selectProps("provider")}
          />
          <MultiSelect
            label={t("filter.model")}
            options={data?.options.models ?? []}
            {...selectProps("model")}
          />
          <MultiSelect
            label={t("filter.project")}
            options={data?.options.projects ?? []}
            labelOf={projectLabel}
            {...selectProps("project")}
          />
          {hasFilters ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setFilters(EMPTY_FILTERS)}
              style={styles.link}
            >
              <Text style={styles.linkText}>{t("filter.reset")}</Text>
            </Pressable>
          ) : null}
        </View>

        {preset === "custom" ? (
          <View style={{ gap: 4 }}>
            <View style={styles.customRow}>
              <Text style={styles.customLabel}>{t("custom.from")}</Text>
              <TextInput
                value={draftFrom}
                onChangeText={setDraftFrom}
                onSubmitEditing={applyCustom}
                placeholder="YYYY-MM-DD HH:mm"
                placeholderTextColor={theme.colors.foregroundMuted}
                style={styles.input}
              />
              <Text style={styles.customLabel}>{t("custom.to")}</Text>
              <TextInput
                value={draftTo}
                onChangeText={setDraftTo}
                onSubmitEditing={applyCustom}
                placeholder="YYYY-MM-DD HH:mm"
                placeholderTextColor={theme.colors.foregroundMuted}
                style={styles.input}
              />
              <Pressable
                accessibilityRole="button"
                onPress={applyCustom}
                style={styles.primary}
              >
                <Text style={styles.primaryText}>{t("custom.apply")}</Text>
              </Pressable>
            </View>
            {customError ? (
              <Text style={styles.error}>{t("custom.invalid")}</Text>
            ) : null}
          </View>
        ) : null}
      </View>

      {openSelect ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("filter.done")}
          onPress={() => setOpenSelect(null)}
          style={styles.backdrop}
        />
      ) : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}>
        <UpdateBanner theme={theme} compact={compact} t={t} />
        {!data ? (
          <View style={styles.centered}>
            {stats.isError ? (
              <>
                <Text style={styles.error}>
                  {t("status.error", {
                    error: String(stats.error?.message ?? stats.error),
                  })}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={refresh}
                  style={styles.primary}
                >
                  <Text style={styles.primaryText}>{t("status.retry")}</Text>
                </Pressable>
              </>
            ) : (
              <>
                <ActivityIndicator color={theme.colors.foregroundMuted} />
                <Text style={styles.muted}>{t("status.loading")}</Text>
              </>
            )}
          </View>
        ) : (
          <>
            {stats.isError ? (
              <Text style={styles.error}>
                {t("status.error", {
                  error: String(stats.error?.message ?? stats.error),
                })}
              </Text>
            ) : null}
            <Summary
              totals={data.totals}
              theme={theme}
              compact={compact}
              t={t}
            />
            <Breakdown
              rows={rows ?? []}
              dimension={dimension}
              onDimensionChange={setDimension}
              sort={sort}
              onSortChange={setSort}
              onPick={pick}
              theme={theme}
              compact={compact}
              t={t}
            />
            <CollaborationSection
              collaboration={data.collaboration}
              totalCostUsd={data.totals.costUsd}
              onPickModel={(model) => pick("model", model)}
              navigation={navigation}
              theme={theme}
              compact={compact}
              t={t}
            />
            <CoverageNote
              coverage={data.coverage}
              providerLabel={providerLabel}
              theme={theme}
              compact={compact}
              language={language}
              t={t}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}
