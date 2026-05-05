import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useHousehold } from '../hooks/useHousehold';
import { useMonth, currentPeriod } from '../contexts/MonthContext';
import { invalidateCache, invalidateCacheByPrefix } from '../services/cache';
import { saveCurrentUserCache } from '../services/currentUserCache';

const DAY_OPTIONS = Array.from({ length: 28 }, (_, i) => i + 1);

function ordinal(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export default function BudgetPeriodScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useCurrentUser();
  const { household, memberCount, refresh: refreshHousehold } = useHousehold();
  const { setStartDay, setSelectedMonth } = useMonth();

  const [periodType, setPeriodType] = useState('calendar');
  const [customDay, setCustomDay] = useState(1);
  const [periodSaving, setPeriodSaving] = useState(false);
  const [showDayPicker, setShowDayPicker] = useState(false);

  const [householdPeriodType, setHouseholdPeriodType] = useState('calendar');
  const [householdCustomDay, setHouseholdCustomDay] = useState(1);
  const [householdPeriodSaving, setHouseholdPeriodSaving] = useState(false);
  const [showHouseholdDayPicker, setShowHouseholdDayPicker] = useState(false);

  useEffect(() => {
    if (user) {
      const day = user.budget_start_day || 1;
      setPeriodType(day === 1 ? 'calendar' : 'custom');
      setCustomDay(day === 1 ? 15 : day);
    }
  }, [user?.budget_start_day]);

  useEffect(() => {
    if (household) {
      const day = household.budget_start_day || 1;
      setHouseholdPeriodType(day === 1 ? 'calendar' : 'custom');
      setHouseholdCustomDay(day === 1 ? 15 : day);
    }
  }, [household?.budget_start_day]);

  async function savePeriod() {
    const day = periodType === 'calendar' ? 1 : customDay;
    setPeriodSaving(true);
    try {
      const updatedUser = await api.patch('/users/settings', { budget_start_day: day });
      setStartDay(day);
      setSelectedMonth(currentPeriod(day));
      await saveCurrentUserCache(updatedUser);
      await invalidateCacheByPrefix('cache:budget:');
      await invalidateCacheByPrefix('cache:expenses:');
    } catch {
      // silent
    } finally {
      setPeriodSaving(false);
    }
  }

  async function saveHouseholdPeriod() {
    const day = householdPeriodType === 'calendar' ? 1 : householdCustomDay;
    setHouseholdPeriodSaving(true);
    try {
      await api.patch('/households/me', { budget_start_day: day });
      await invalidateCache('cache:household');
      await invalidateCacheByPrefix('cache:budget:');
      await invalidateCacheByPrefix('cache:household-expenses:');
      refreshHousehold();
    } catch {
      // silent
    } finally {
      setHouseholdPeriodSaving(false);
    }
  }

  const currentDay = user?.budget_start_day || 1;
  const pendingDay = periodType === 'calendar' ? 1 : customDay;
  const periodChanged = pendingDay !== currentDay;

  const currentHouseholdDay = household?.budget_start_day || 1;
  const pendingHouseholdDay = householdPeriodType === 'calendar' ? 1 : householdCustomDay;
  const householdPeriodChanged = pendingHouseholdDay !== currentHouseholdDay;

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>MY BUDGET PERIOD</Text>
        <Text style={styles.subText}>When does your personal budget reset each month?</Text>

        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => { setPeriodType('calendar'); setShowDayPicker(false); }}
          activeOpacity={0.7}
        >
          <View style={[styles.radio, periodType === 'calendar' && styles.radioActive]} />
          <Text style={styles.optionLabel}>Calendar month</Text>
          <Text style={styles.optionSub}>1st of each month</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => { setPeriodType('custom'); setShowDayPicker(true); }}
          activeOpacity={0.7}
        >
          <View style={[styles.radio, periodType === 'custom' && styles.radioActive]} />
          <Text style={styles.optionLabel}>Custom day</Text>
          {periodType === 'custom' ? (
            <TouchableOpacity onPress={() => setShowDayPicker(s => !s)} style={styles.dayChip}>
              <Text style={styles.dayChipText}>{ordinal(customDay)}</Text>
              <Ionicons name={showDayPicker ? 'chevron-up' : 'chevron-down'} size={12} color="#888" />
            </TouchableOpacity>
          ) : (
            <Text style={styles.optionSub}>pick a day</Text>
          )}
        </TouchableOpacity>

        {periodType === 'custom' && showDayPicker && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayPickerRow} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
            {DAY_OPTIONS.map(d => (
              <TouchableOpacity
                key={d}
                style={[styles.dayOption, customDay === d && styles.dayOptionActive]}
                onPress={() => { setCustomDay(d); setShowDayPicker(false); }}
              >
                <Text style={[styles.dayOptionText, customDay === d && styles.dayOptionTextActive]}>{d}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {periodChanged && (
          <TouchableOpacity style={[styles.button, periodSaving && styles.buttonDisabled]} onPress={savePeriod} disabled={periodSaving}>
            <Text style={styles.buttonText}>{periodSaving ? 'Saving...' : 'Save Personal Period'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {memberCount > 1 && household ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>HOUSEHOLD BUDGET PERIOD</Text>
          <Text style={styles.subText}>Shared reset day for the household budget bar.</Text>

          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => { setHouseholdPeriodType('calendar'); setShowHouseholdDayPicker(false); }}
            activeOpacity={0.7}
          >
            <View style={[styles.radio, householdPeriodType === 'calendar' && styles.radioActive]} />
            <Text style={styles.optionLabel}>Calendar month</Text>
            <Text style={styles.optionSub}>1st of each month</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => { setHouseholdPeriodType('custom'); setShowHouseholdDayPicker(true); }}
            activeOpacity={0.7}
          >
            <View style={[styles.radio, householdPeriodType === 'custom' && styles.radioActive]} />
            <Text style={styles.optionLabel}>Custom day</Text>
            {householdPeriodType === 'custom' ? (
              <TouchableOpacity onPress={() => setShowHouseholdDayPicker(s => !s)} style={styles.dayChip}>
                <Text style={styles.dayChipText}>{ordinal(householdCustomDay)}</Text>
                <Ionicons name={showHouseholdDayPicker ? 'chevron-up' : 'chevron-down'} size={12} color="#888" />
              </TouchableOpacity>
            ) : (
              <Text style={styles.optionSub}>pick a day</Text>
            )}
          </TouchableOpacity>

          {householdPeriodType === 'custom' && showHouseholdDayPicker && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayPickerRow} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
              {DAY_OPTIONS.map(d => (
                <TouchableOpacity
                  key={d}
                  style={[styles.dayOption, householdCustomDay === d && styles.dayOptionActive]}
                  onPress={() => { setHouseholdCustomDay(d); setShowHouseholdDayPicker(false); }}
                >
                  <Text style={[styles.dayOptionText, householdCustomDay === d && styles.dayOptionTextActive]}>{d}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {householdPeriodChanged && (
            <TouchableOpacity style={[styles.button, householdPeriodSaving && styles.buttonDisabled]} onPress={saveHouseholdPeriod} disabled={householdPeriodSaving}>
              <Text style={styles.buttonText}>{householdPeriodSaving ? 'Saving...' : 'Save Household Period'}</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 40 },
  section: { marginBottom: 32, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', paddingBottom: 24 },
  sectionTitle: { fontSize: 12, color: '#999', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  subText: { color: '#666', fontSize: 13, marginBottom: 12 },
  optionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: '#111' },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#444' },
  radioActive: { borderColor: '#f5f5f5', backgroundColor: '#f5f5f5' },
  optionLabel: { fontSize: 15, color: '#f5f5f5', flex: 1 },
  optionSub: { fontSize: 13, color: '#555' },
  dayChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1a1a1a', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  dayChipText: { fontSize: 13, color: '#f5f5f5', fontWeight: '500' },
  dayPickerRow: { marginTop: 8 },
  dayOption: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#222' },
  dayOptionActive: { backgroundColor: '#f5f5f5', borderColor: '#f5f5f5' },
  dayOptionText: { fontSize: 13, color: '#888' },
  dayOptionTextActive: { color: '#000', fontWeight: '600' },
  button: { backgroundColor: '#fff', borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 14 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#0a0a0a', fontWeight: '600', fontSize: 15 },
});
