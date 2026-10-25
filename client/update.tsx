import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import {
  updateApplyRpc,
  updateCheckRpc,
  type UpdateStatus,
} from "../shared/update";
import { dateTime } from "./format";
import type { Language, Translate } from "./i18n";

const UPDATE_KEY = ["paseo-stats-update"];

export function useUpdate() {
  const check = useRpc(updateCheckRpc);
  const applyUpdate = useRpc(updateApplyRpc);
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: UPDATE_KEY,
    queryFn: () => check({}),
    staleTime: 5 * 60_000,
    refetchInterval: (query) => (query.state.data?.applying ? 2_000 : false),
  });
  const store = (data: UpdateStatus) =>
    queryClient.setQueryData(UPDATE_KEY, data);
  const refresh = useMutation({
    mutationFn: () => check({ refresh: true }),
    onSuccess: store,
  });
  const apply = useMutation({
    mutationFn: (tag: string) => applyUpdate({ tag }),
    onSuccess: store,
  });
  return { status: status.data ?? null, refresh, apply };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function UpdateBanner({
  theme,
  compact,
  t,
}: {
  theme: PluginTheme;
  compact: boolean;
  t: Translate;
}) {
  const { status, apply } = useUpdate();
  const styles = useMemo(
    () => ({
      banner: {
        flexDirection: compact ? ("column" as const) : ("row" as const),
        alignItems: compact ? ("stretch" as const) : ("center" as const),
        gap: 12,
        padding: compact ? 12 : 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.accent,
        backgroundColor: theme.colors.surface1,
      },
      text: { flex: compact ? undefined : 1, gap: 2 },
      title: {
        color: theme.colors.foreground,
        fontSize: 14,
        fontWeight: "600" as const,
      },
      detail: { color: theme.colors.foregroundMuted, fontSize: 12 },
      error: { color: theme.colors.statusDanger, fontSize: 12 },
      actions: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
      },
      link: { paddingHorizontal: 8, paddingVertical: 7 },
      linkText: { color: theme.colors.accent, fontSize: 13 },
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
    }),
    [theme, compact],
  );
  if (!status?.updateAvailable || status.blocked || !status.latestTag) {
    return null;
  }
  const tag = status.latestTag;
  const applying = status.applying || apply.isPending;
  const failure =
    status.applyError ?? (apply.error ? errorText(apply.error) : null);
  return (
    <View style={styles.banner}>
      <View style={styles.text}>
        <Text style={styles.title}>
          {t("update.available", { version: tag })}
        </Text>
        <Text style={styles.detail}>
          {applying
            ? t("update.applying")
            : t("update.availableDetail", {
                current: `v${status.currentVersion}`,
              })}
        </Text>
        {failure && !applying ? (
          <Text style={styles.error} numberOfLines={3}>
            {t("update.applyFailed", { error: failure })}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        {status.releaseUrl ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => void openExternalUrl(status.releaseUrl as string)}
            style={styles.link}
          >
            <Text style={styles.linkText}>{t("update.notes")}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("update.apply")}
          disabled={applying}
          onPress={() => apply.mutate(tag)}
          style={[styles.primary, applying ? { opacity: 0.6 } : null]}
        >
          {applying ? (
            <ActivityIndicator
              size="small"
              color={theme.colors.accentForeground}
            />
          ) : (
            <Text style={styles.primaryText}>{t("update.apply")}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

export interface UpdateSectionProps {
  autoUpdate: boolean;
  onAutoUpdateChange(value: boolean): void;
  saving: boolean;
  theme: PluginTheme;
  language: Language;
  t: Translate;
}

export function UpdateSection({
  autoUpdate,
  onAutoUpdateChange,
  saving,
  theme,
  language,
  t,
}: UpdateSectionProps) {
  const { status, refresh, apply } = useUpdate();
  const value = { color: theme.colors.foreground, fontSize: 13 };
  const muted = {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    paddingHorizontal: 12,
    paddingBottom: 12,
  };
  const latest = status?.latestTag ?? null;
  const applying = Boolean(status?.applying) || apply.isPending;
  const checkError =
    status?.error ?? (refresh.error ? errorText(refresh.error) : null);
  const failure =
    status?.applyError ?? (apply.error ? errorText(apply.error) : null);
  return (
    <SettingsSection title={t("update.section")}>
      <SettingsCard>
        <SettingsRow label={t("update.current")}>
          <Text style={value}>v{status?.currentVersion ?? "…"}</Text>
        </SettingsRow>
        <SettingsAction
          label={t("update.latest")}
          hint={
            checkError
              ? t("update.error", { error: checkError })
              : status?.checkedAt
                ? `${latest ?? t("update.none")} · ${t("update.checkedAt", {
                    time: dateTime(status.checkedAt, language),
                  })}`
                : undefined
          }
          actionLabel={
            refresh.isPending ? t("update.checking") : t("update.check")
          }
          disabled={refresh.isPending}
          onPress={() => refresh.mutate()}
        />
        {status?.updateAvailable && latest ? (
          <SettingsAction
            label={t("update.available", { version: latest })}
            hint={
              applying
                ? t("update.applying")
                : failure
                  ? t("update.applyFailed", { error: failure })
                  : status.blocked
                    ? t(`update.blocked.${status.blocked}`)
                    : t("update.availableDetail", {
                        current: `v${status.currentVersion}`,
                      })
            }
            actionLabel={t("update.apply")}
            disabled={applying || status.blocked !== null}
            onPress={() => apply.mutate(latest)}
          />
        ) : status?.checkedAt && !checkError ? (
          <SettingsRow label={t("update.upToDate")} />
        ) : null}
        <SettingsSwitch
          label={t("update.auto")}
          hint={t("update.autoHint")}
          value={autoUpdate}
          disabled={saving || status?.blocked !== null}
          onValueChange={onAutoUpdateChange}
        />
        {status?.blocked ? (
          <Text style={muted}>{t(`update.blocked.${status.blocked}`)}</Text>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}
