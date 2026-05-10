import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ActionRow } from '../components/ui/Buttons';
import { EmptyState, SectionHeader } from '../components/ui/States';
import { StatusChip } from '../components/ui/StatusChip';
import { INTERNAL_TOOLS_ENABLED } from '../services/internalTools';
import { colors, spacing, typography } from '../theme/tokens';

export default function DiagnosticsHubScreen() {
  const router = useRouter();

  if (!INTERNAL_TOOLS_ENABLED) {
    return (
      <>
        <Stack.Screen options={{ title: 'Diagnostics' }} />
        <View style={styles.container}>
          <EmptyState
            title="Internal tools are disabled"
            body="Diagnostics are hidden in this build."
            icon="lock-closed-outline"
          />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Diagnostics' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.eyebrow}>Internal tools</Text>
            <StatusChip label="Private build" tone="info" />
          </View>
          <Text style={styles.title}>Find where signals fall out.</Text>
          <Text style={styles.body}>
            Health checks, import coverage, and insight surfacing live here so debugging does not spill across Settings.
          </Text>
        </View>

        <View style={styles.section}>
          <SectionHeader
            eyebrow="Systems"
            title="Operational checks"
            body="Use these when an email, insight, or sync result does not line up with what you expect."
          />
          <View style={styles.stack}>
            <ActionRow
              icon="mail-unread-outline"
              title="Email import health"
              body="Check Gmail coverage, unlogged inbox messages, skipped receipts, and failed imports."
              onPress={() => router.push('/email-import-health')}
            />
            <ActionRow
              icon="analytics-outline"
              title="Insight diagnostics"
              body="See raw insight candidates, suppression gates, dismissed signals, and surfaced cards."
              onPress={() => router.push('/insight-diagnostics')}
            />
            <ActionRow
              icon="sync-outline"
              title="Gmail import control"
              body="Manage connection, run sync, retry failures, and inspect sender learning."
              onPress={() => router.push('/gmail-import')}
            />
          </View>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingBottom: 48, gap: 28 },
  hero: { gap: spacing.sm },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  eyebrow: { color: colors.textSubtle, ...typography.eyebrow },
  title: { color: colors.text, ...typography.screenTitle },
  body: { color: colors.textMuted, ...typography.body },
  section: { gap: spacing.lg },
  stack: { gap: spacing.md },
});
