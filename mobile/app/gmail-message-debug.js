import { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Share } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

function parsePayload(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function DebugSection({ title, body }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{body || '(empty)'}</Text>
    </View>
  );
}

export default function GmailMessageDebugScreen() {
  const params = useLocalSearchParams();
  const payload = useMemo(() => parsePayload(typeof params.payload === 'string' ? params.payload : null), [params.payload]);

  const shareText = useMemo(() => {
    if (!payload) return 'No Gmail debug payload loaded.';
    return [
      `Message ID: ${payload.message_id || ''}`,
      `Subject: ${payload.subject || ''}`,
      `From: ${payload.from || ''}`,
      `Chosen source: ${payload.chosen_source || 'unknown'}`,
      `Plain score: ${payload.plain_score ?? 'n/a'}`,
      `HTML score: ${payload.html_score ?? 'n/a'}`,
      `Parsed item count: ${payload.parser_debug?.parsed_item_count ?? 0}`,
      `Fallback item count: ${payload.parser_debug?.fallback_item_count ?? 0}`,
      '',
      '--- Parser Items Preview ---',
      JSON.stringify(payload.parser_debug?.parsed_items_preview || [], null, 2),
      '',
      '--- Fallback Items Preview ---',
      JSON.stringify(payload.parser_debug?.fallback_items_preview || [], null, 2),
      '',
      '--- Selected Body Preview ---',
      payload.selected_body_preview || '',
      '',
      '--- Plain Preview ---',
      payload.plain_preview || '',
      '',
      '--- HTML Preview ---',
      payload.html_preview || '',
    ].join('\n');
  }, [payload]);

  async function shareDebugPayload() {
    await Share.share({ message: shareText });
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Gmail Body Debug' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.headerCard}>
          <Text style={styles.metaLabel}>Message ID</Text>
          <Text style={styles.metaValue}>{payload?.message_id || 'Unknown'}</Text>
          <Text style={styles.metaSub}>
            {`Chosen source: ${payload?.chosen_source || 'unknown'}  •  Plain ${payload?.plain_score ?? 'n/a'}  •  HTML ${payload?.html_score ?? 'n/a'}`}
          </Text>
          <Text style={styles.metaSub}>
            {`Parser items ${payload?.parser_debug?.parsed_item_count ?? 0}  •  Fallback items ${payload?.parser_debug?.fallback_item_count ?? 0}`}
          </Text>
          <TouchableOpacity style={styles.shareButton} onPress={shareDebugPayload} activeOpacity={0.82}>
            <Text style={styles.shareButtonText}>Share debug text</Text>
          </TouchableOpacity>
        </View>

        <DebugSection
          title="Parser Items Preview"
          body={JSON.stringify(payload?.parser_debug?.parsed_items_preview || [], null, 2)}
        />
        <DebugSection
          title="Fallback Items Preview"
          body={JSON.stringify(payload?.parser_debug?.fallback_items_preview || [], null, 2)}
        />
        <DebugSection title="Selected Body Preview" body={payload?.selected_body_preview} />
        <DebugSection title="Plain Preview" body={payload?.plain_preview} />
        <DebugSection title="HTML Preview" body={payload?.html_preview} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 48, gap: 16 },
  headerCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 10,
    padding: 16,
  },
  metaLabel: { color: '#6f6f6f', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  metaValue: { color: '#f5f5f5', fontSize: 16, fontWeight: '600' },
  metaSub: { color: '#9aa5b1', fontSize: 12, lineHeight: 18, marginTop: 8 },
  shareButton: {
    marginTop: 14,
    alignSelf: 'flex-start',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  shareButtonText: { color: '#f5f5f5', fontSize: 13, fontWeight: '500' },
  section: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 10,
    padding: 16,
  },
  sectionTitle: { color: '#d5d5d5', fontSize: 13, fontWeight: '600', marginBottom: 10 },
  sectionBody: { color: '#b8b8b8', fontSize: 12, lineHeight: 18 },
});
