import type { PluginTheme } from "@getpaseo/plugin";
import { Modal, copyText, useToast } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  csvBreakdown,
  markdownReport,
  mermaidTopology,
  seecodeTopology,
  seecodeTrend,
  type ExportContext,
} from "./export";
import type { PlainKey, Translate } from "./i18n";

type Dimension = "model" | "provider";

interface Item {
  id: string;
  title: PlainKey;
  hint: PlainKey;
  build(context: ExportContext, dimension: Dimension): string | null;
}

const ITEMS: Item[] = [
  {
    id: "markdown",
    title: "export.markdown",
    hint: "export.markdownHint",
    build: (context) => markdownReport(context),
  },
  {
    id: "csv",
    title: "export.csv",
    hint: "export.csvHint",
    build: (context) => csvBreakdown(context.data, context.t),
  },
  {
    id: "mermaid",
    title: "export.mermaid",
    hint: "export.mermaidHint",
    build: (context, dimension) =>
      mermaidTopology(context.data.collaboration, dimension, context.t),
  },
  {
    id: "seecode-topology",
    title: "export.seecodeTopology",
    hint: "export.seecodeTopologyHint",
    build: (context, dimension) => seecodeTopology(context, dimension),
  },
  {
    id: "seecode-trend",
    title: "export.seecodeTrend",
    hint: "export.seecodeTrendHint",
    build: (context) => seecodeTrend(context),
  },
];

export interface ExportMenuProps {
  context: ExportContext;
  open: boolean;
  onOpenChange(open: boolean): void;
  theme: PluginTheme;
  t: Translate;
}

export function ExportMenu({
  context,
  open,
  onOpenChange,
  theme,
  t,
}: ExportMenuProps) {
  const toast = useToast();
  const [dimension, setDimension] = useState<Dimension>("model");
  const outputs = useMemo(
    () =>
      open
        ? new Map(
            ITEMS.map((item) => [item.id, item.build(context, dimension)]),
          )
        : new Map<string, string | null>(),
    [open, context, dimension],
  );
  const styles = useMemo(
    () => ({
      intro: { color: theme.colors.foregroundMuted, fontSize: 13 },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 12,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      text: { flex: 1, minWidth: 0, gap: 2 },
      title: {
        color: theme.colors.foreground,
        fontSize: 14,
        fontWeight: "600" as const,
      },
      hint: { color: theme.colors.foregroundMuted, fontSize: 12 },
      button: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        backgroundColor: theme.colors.accent,
      },
      buttonText: {
        color: theme.colors.accentForeground,
        fontSize: 13,
        fontWeight: "600" as const,
      },
      tabs: {
        flexDirection: "row" as const,
        gap: 4,
        alignItems: "center" as const,
      },
      tab: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
      tabActive: { backgroundColor: theme.colors.surface2 },
      tabText: { color: theme.colors.foregroundMuted, fontSize: 12 },
      tabTextActive: {
        color: theme.colors.foreground,
        fontWeight: "600" as const,
      },
    }),
    [theme],
  );

  const copy = async (item: Item) => {
    const text = outputs.get(item.id);
    if (!text) return;
    try {
      await copyText(text);
      toast.show(t("export.copied", { name: t(item.title) }), {
        variant: "success",
      });
    } catch (error) {
      toast.error(
        t("export.failed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  return (
    <Modal title={t("export.title")} open={open} onOpenChange={onOpenChange}>
      <Modal.Content>
        <Text style={styles.intro}>{t("export.intro")}</Text>
        <View style={styles.tabs} accessibilityRole="radiogroup">
          <Text style={styles.hint}>{t("collab.topology")}</Text>
          {(["model", "provider"] as const).map((id) => {
            const active = id === dimension;
            return (
              <Pressable
                key={id}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                onPress={() => setDimension(id)}
                style={[styles.tab, active ? styles.tabActive : null]}
              >
                <Text
                  style={[styles.tabText, active ? styles.tabTextActive : null]}
                >
                  {t(`collab.pairsBy.${id}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View>
          {ITEMS.map((item) => {
            const available = Boolean(outputs.get(item.id));
            return (
              <View key={item.id} style={styles.row}>
                <View style={styles.text}>
                  <Text style={styles.title}>{t(item.title)}</Text>
                  <Text style={styles.hint}>
                    {available ? t(item.hint) : t("export.unavailable")}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t("export.copy")} ${t(item.title)}`}
                  accessibilityState={{ disabled: !available }}
                  disabled={!available}
                  onPress={() => void copy(item)}
                  style={[styles.button, { opacity: available ? 1 : 0.4 }]}
                >
                  <Text style={styles.buttonText}>{t("export.copy")}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      </Modal.Content>
    </Modal>
  );
}
