import type { PluginTheme } from "@getpaseo/plugin";
import {
  Icon,
  ScrollView,
  TextInput,
} from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Option } from "../shared/stats";
import type { Translate } from "./i18n";

export interface MultiSelectProps {
  label: string;
  options: readonly Option[];
  selected: readonly string[];
  onChange(selected: string[]): void;
  open: boolean;
  onOpenChange(open: boolean): void;
  labelOf?: (option: Option) => string;
  theme: PluginTheme;
  compact: boolean;
  t: Translate;
}

export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  open,
  onOpenChange,
  labelOf = (option) => option.label,
  theme,
  compact,
  t,
}: MultiSelectProps) {
  const [search, setSearch] = useState("");
  const styles = useMemo(
    () => ({
      root: {
        position: "relative" as const,
        zIndex: open ? 30 : 1,
        width: compact ? ("100%" as const) : undefined,
      },
      trigger: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 8,
        borderWidth: 1,
        borderColor:
          open || selected.length > 0
            ? theme.colors.accent
            : theme.colors.border,
        backgroundColor: theme.colors.surface1,
        maxWidth: compact ? undefined : 260,
      },
      triggerLabel: { color: theme.colors.foregroundMuted, fontSize: 13 },
      triggerValue: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "600" as const,
        flexShrink: 1,
      },
      panel: {
        position: "absolute" as const,
        top: "100%" as const,
        left: 0,
        marginTop: 4,
        width: compact ? ("100%" as const) : 320,
        maxHeight: 380,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        padding: 8,
        gap: 6,
        shadowColor: "#000",
        shadowOpacity: 0.18,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
        elevation: 12,
      },
      search: {
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface0,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 6,
        paddingHorizontal: 10,
        paddingVertical: 7,
        fontSize: 13,
      },
      actions: {
        flexDirection: "row" as const,
        justifyContent: "space-between" as const,
      },
      action: { paddingHorizontal: 6, paddingVertical: 4 },
      actionText: {
        color: theme.colors.accent,
        fontSize: 12,
        fontWeight: "600" as const,
      },
      list: { maxHeight: 280 },
      option: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: 6,
        paddingVertical: 7,
        borderRadius: 6,
      },
      optionActive: { backgroundColor: theme.colors.surface2 },
      check: {
        width: 16,
        height: 16,
        borderRadius: 4,
        borderWidth: 1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      optionText: { flex: 1, minWidth: 0 },
      optionLabel: { color: theme.colors.foreground, fontSize: 13 },
      optionHint: { color: theme.colors.foregroundMuted, fontSize: 11 },
      empty: { color: theme.colors.foregroundMuted, fontSize: 12, padding: 8 },
    }),
    [theme, compact, open, selected.length],
  );

  const chosen = new Set(selected);
  const query = search.trim().toLowerCase();
  const visible = query
    ? options.filter((option) =>
        [labelOf(option), option.value, option.hint ?? ""].some((text) =>
          text.toLowerCase().includes(query),
        ),
      )
    : options;

  const summary =
    selected.length === 0
      ? t("filter.all")
      : selected.length === 1
        ? labelOf(
            options.find((option) => option.value === selected[0]) ?? {
              value: selected[0],
              label: selected[0],
              hint: null,
            },
          )
        : t("filter.count", { count: selected.length });

  const toggle = (value: string) => {
    onChange(
      chosen.has(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value],
    );
  };

  const close = () => {
    setSearch("");
    onOpenChange(false);
  };

  return (
    <View style={styles.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${summary}`}
        accessibilityState={{ expanded: open }}
        onPress={() => (open ? close() : onOpenChange(true))}
        style={styles.trigger}
      >
        <Text style={styles.triggerLabel}>{label}</Text>
        <Text style={styles.triggerValue} numberOfLines={1}>
          {summary}
        </Text>
        <Icon
          name={open ? "ChevronUp" : "ChevronDown"}
          size={14}
          color={theme.colors.foregroundMuted}
        />
      </Pressable>
      {open ? (
        <View style={styles.panel}>
          <TextInput
            autoFocus
            value={search}
            onChangeText={setSearch}
            placeholder={t("filter.search", { label })}
            placeholderTextColor={theme.colors.foregroundMuted}
            onKeyPress={(event) => {
              if (event.nativeEvent.key === "Escape") close();
            }}
            style={styles.search}
          />
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => onChange([])}
              style={styles.action}
            >
              <Text style={styles.actionText}>{t("filter.clear")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={close}
              style={styles.action}
            >
              <Text style={styles.actionText}>{t("filter.done")}</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {visible.length === 0 ? (
              <Text style={styles.empty}>{t("filter.empty")}</Text>
            ) : (
              visible.map((option) => {
                const active = chosen.has(option.value);
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="checkbox"
                    accessibilityLabel={labelOf(option)}
                    accessibilityState={{ checked: active }}
                    onPress={() => toggle(option.value)}
                    style={[styles.option, active ? styles.optionActive : null]}
                  >
                    <View
                      style={[
                        styles.check,
                        {
                          borderColor: active
                            ? theme.colors.accent
                            : theme.colors.border,
                          backgroundColor: active
                            ? theme.colors.accent
                            : "transparent",
                        },
                      ]}
                    >
                      {active ? (
                        <Icon
                          name="Check"
                          size={12}
                          color={theme.colors.accentForeground}
                        />
                      ) : null}
                    </View>
                    <View style={styles.optionText}>
                      <Text style={styles.optionLabel} numberOfLines={1}>
                        {labelOf(option)}
                      </Text>
                      {option.hint ? (
                        <Text style={styles.optionHint} numberOfLines={1}>
                          {option.hint}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
