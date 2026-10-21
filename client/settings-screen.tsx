import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import {
  SettingsAction,
  SettingsCard,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { statsSettings, type PriceOverride } from "../shared/settings";
import { useI18n, type MessageKey, type Translate } from "./i18n";
import { UpdateSection } from "./update";

interface DraftRow {
  id: number;
  model: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
}

const PRICE_FIELDS: {
  key: Exclude<keyof DraftRow, "id" | "model">;
  label: MessageKey;
}[] = [
  { key: "input", label: "settings.input" },
  { key: "output", label: "settings.output" },
  { key: "cacheRead", label: "settings.cacheRead" },
  { key: "cacheWrite", label: "settings.cacheWrite" },
];

let nextRowId = 0;

function toDraft(override: PriceOverride): DraftRow {
  const text = (value: number | null) => (value === null ? "" : String(value));
  return {
    id: nextRowId++,
    model: override.model,
    input: text(override.input),
    output: text(override.output),
    cacheRead: text(override.cacheRead),
    cacheWrite: text(override.cacheWrite),
  };
}

export function parseDraft(
  rows: readonly Omit<DraftRow, "id">[],
  t: Translate,
): { overrides: PriceOverride[] } | { error: string } {
  const overrides: PriceOverride[] = [];
  for (const [index, row] of rows.entries()) {
    const fields = [
      row.model,
      row.input,
      row.output,
      row.cacheRead,
      row.cacheWrite,
    ];
    if (fields.every((field) => field.trim() === "")) continue;
    const price = (text: string) => {
      if (text.trim() === "") return null;
      const value = Number(text);
      return Number.isFinite(value) && value >= 0 ? value : Number.NaN;
    };
    const input = price(row.input);
    const output = price(row.output);
    const cacheRead = price(row.cacheRead);
    const cacheWrite = price(row.cacheWrite);
    const invalid =
      row.model.trim() === "" ||
      input === null ||
      output === null ||
      [input, output, cacheRead, cacheWrite].some((value) =>
        Number.isNaN(value),
      );
    if (invalid) return { error: t("settings.invalid", { row: index + 1 }) };
    overrides.push({
      model: row.model.trim(),
      input: input as number,
      output: output as number,
      cacheRead,
      cacheWrite,
    });
  }
  return { overrides };
}

export function StatsSettingsScreen({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(statsSettings);
  const { language, t } = useI18n();
  const [draft, setDraft] = useState<DraftRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const styles = useMemo(
    () => ({
      screen: { gap: 16 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 13, padding: 12 },
      error: {
        color: theme.colors.statusDanger,
        fontSize: 12,
        paddingHorizontal: 12,
      },
      rows: { padding: 12, gap: 10 },
      row: {
        flexDirection: layout.compact ? ("column" as const) : ("row" as const),
        alignItems: layout.compact ? ("stretch" as const) : ("center" as const),
        gap: 8,
      },
      prices: {
        flexDirection: "row" as const,
        gap: 8,
        flex: layout.compact ? undefined : 4,
      },
      field: { flex: 1, gap: 4, minWidth: 0 },
      modelField: { flex: layout.compact ? undefined : 2.4, gap: 4 },
      label: { color: theme.colors.foregroundMuted, fontSize: 11 },
      input: {
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface0,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 6,
        fontSize: 13,
      },
      remove: { padding: 6, alignSelf: "flex-end" as const },
      footer: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 12,
        padding: 12,
      },
      button: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      buttonText: { color: theme.colors.foreground, fontSize: 13 },
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
      status: { color: theme.colors.foregroundMuted, fontSize: 12 },
    }),
    [theme, layout.compact],
  );

  if (settings.status === "loading") {
    return <Text style={styles.muted}>{t("settings.loading")}</Text>;
  }
  if (settings.status === "error" || settings.status === "invalid") {
    return (
      <View style={styles.screen}>
        <Text style={styles.error}>
          {t("settings.loadError", { error: settings.error })}
        </Text>
        {settings.status === "invalid" ? (
          <SettingsCard>
            <SettingsAction
              label={t("settings.overrides")}
              actionLabel={t("settings.reset")}
              onPress={() => void settings.reset()}
            />
          </SettingsCard>
        ) : null}
      </View>
    );
  }

  const { values, revision } = settings;
  const rows = draft ?? values.priceOverrides.map(toDraft);
  const edit = (next: DraftRow[]) => {
    setDraft(next);
    setSaved(false);
    setError(null);
  };
  const update = (id: number, key: keyof DraftRow, text: string) =>
    edit(rows.map((row) => (row.id === id ? { ...row, [key]: text } : row)));

  const save = async () => {
    const parsed = parseDraft(rows, t);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    const ok = await settings.save(
      { ...values, priceOverrides: parsed.overrides },
      revision,
    );
    if (ok) {
      setDraft(null);
      setSaved(true);
    }
  };

  return (
    <View style={styles.screen}>
      <UpdateSection
        autoUpdate={values.autoUpdate}
        onAutoUpdateChange={(autoUpdate) =>
          void settings.save({ ...values, autoUpdate }, revision)
        }
        saving={settings.saving}
        theme={theme}
        language={language}
        t={t}
      />
      <SettingsSection title={t("settings.pricing")}>
        <SettingsCard>
          <SettingsSwitch
            label={t("settings.online")}
            hint={t("settings.onlineHint")}
            value={values.onlinePricing}
            disabled={settings.saving}
            onValueChange={(onlinePricing) =>
              void settings.save({ ...values, onlinePricing }, revision)
            }
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t("settings.overrides")}
        info={t("settings.overridesInfo")}
      >
        <SettingsCard>
          <View style={styles.rows}>
            {rows.length === 0 ? (
              <Text style={styles.status}>{t("settings.empty")}</Text>
            ) : null}
            {rows.map((row) => (
              <View key={row.id} style={styles.row}>
                <View style={styles.modelField}>
                  <Text style={styles.label}>{t("settings.model")}</Text>
                  <TextInput
                    value={row.model}
                    onChangeText={(text) => update(row.id, "model", text)}
                    placeholder="kimi-k3"
                    placeholderTextColor={theme.colors.foregroundMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                  />
                </View>
                <View style={styles.prices}>
                  {PRICE_FIELDS.map((field) => (
                    <View key={field.key} style={styles.field}>
                      <Text style={styles.label} numberOfLines={1}>
                        {t(field.label)}
                      </Text>
                      <TextInput
                        value={row[field.key]}
                        onChangeText={(text) => update(row.id, field.key, text)}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={theme.colors.foregroundMuted}
                        style={styles.input}
                      />
                    </View>
                  ))}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t("settings.remove")} ${row.model}`}
                  onPress={() =>
                    edit(rows.filter((item) => item.id !== row.id))
                  }
                  style={styles.remove}
                >
                  <Icon
                    name="Trash2"
                    size={16}
                    color={theme.colors.foregroundMuted}
                  />
                </Pressable>
              </View>
            ))}
          </View>
          {error || settings.saveError ? (
            <Text style={styles.error}>{error ?? settings.saveError}</Text>
          ) : null}
          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                edit([
                  ...rows,
                  {
                    id: nextRowId++,
                    model: "",
                    input: "",
                    output: "",
                    cacheRead: "",
                    cacheWrite: "",
                  },
                ])
              }
              style={styles.button}
            >
              <Icon name="Plus" size={14} color={theme.colors.foreground} />
              <Text style={styles.buttonText}>{t("settings.add")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={settings.saving}
              onPress={() => void save()}
              style={styles.primary}
            >
              <Text style={styles.primaryText}>
                {settings.saving ? t("settings.saving") : t("settings.save")}
              </Text>
            </Pressable>
            {saved ? (
              <Text style={styles.status}>{t("settings.saved")}</Text>
            ) : null}
          </View>
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
