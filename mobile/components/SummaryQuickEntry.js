import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export function SummaryQuickEntry({
  styles,
  entryMode,
  setEntryMode,
  input,
  setInput,
  handlePrimaryEntry,
  loading,
  quickEntryProcessingMessage,
  onPressScan,
}) {
  return (
    <View style={styles.quickAdd}>
      <Text style={styles.sectionLabel}>Quick entry</Text>
      <View style={styles.entryModeToggle}>
        <TouchableOpacity
          style={[styles.entryModeChip, entryMode === 'add' && styles.entryModeChipActive]}
          onPress={() => setEntryMode('add')}
        >
          <Text style={[styles.entryModeChipText, entryMode === 'add' && styles.entryModeChipTextActive]}>Add</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.entryModeChip, entryMode === 'check' && styles.entryModeChipActive]}
          onPress={() => setEntryMode('check')}
        >
          <Text style={[styles.entryModeChipText, entryMode === 'check' && styles.entryModeChipTextActive]}>Plan</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.entryModeMeta}>
        {entryMode === 'check'
          ? 'Pressure-test a purchase against your current spending outlook.'
          : 'Tell me what you bought.'}
      </Text>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={entryMode === 'check'
            ? '180 running shoes · can i afford 240 air fryer?'
            : '84.50 trader joes · lunch 14 · gas 60 yesterday'}
          placeholderTextColor="#555"
          onSubmitEditing={handlePrimaryEntry}
          autoCorrect={false}
          returnKeyType={entryMode === 'check' ? 'go' : 'done'}
          editable={!loading}
        />
        <TouchableOpacity style={styles.addBtn} onPress={handlePrimaryEntry} disabled={loading || !input.trim()}>
          {loading
            ? <ActivityIndicator color="#000" size="small" />
            : <Ionicons name="arrow-forward" size={18} color="#000" />}
        </TouchableOpacity>
      </View>
      {quickEntryProcessingMessage ? (
        <View style={styles.quickEntryProcessing}>
          <ActivityIndicator color="#d4d4d4" size="small" />
          <Text style={styles.quickEntryProcessingText}>{quickEntryProcessingMessage}</Text>
        </View>
      ) : null}
      {entryMode === 'add' ? (
        <TouchableOpacity style={styles.scanLink} onPress={onPressScan}>
          <Ionicons name="camera-outline" size={14} color="#888" />
          <Text style={styles.scanLinkText}>scan a receipt</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.entryModeSpacer} />
      )}
    </View>
  );
}
