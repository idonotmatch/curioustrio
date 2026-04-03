import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { usePendingExpenses } from '../../hooks/usePendingExpenses';
import { useMonth, currentPeriod } from '../../contexts/MonthContext';
import { useCurrentUser } from '../../hooks/useCurrentUser';

function FeedIcon({ focused }) {
  const { expenses, refresh } = usePendingExpenses();
  const count = expenses?.length ?? 0;

  useEffect(() => {
    if (focused) refresh();
  }, [focused]);
  return (
    <View>
      <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={22} color={focused ? '#6366f1' : '#555'} />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute', top: -4, right: -8,
    backgroundColor: '#ef4444', borderRadius: 8,
    minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
});

// Syncs the user's budget_start_day into MonthContext once user data loads.
function StartDaySyncer() {
  const { user } = useCurrentUser();
  const { setStartDay, setSelectedMonth } = useMonth();
  useEffect(() => {
    const day = user?.budget_start_day || 1;
    setStartDay(day);
    setSelectedMonth(currentPeriod(day));
  }, [user?.budget_start_day]);
  return null;
}

export default function TabLayout() {
  return (
    <>
      <StartDaySyncer />
      <Tabs initialRouteName="summary" screenOptions={{
        tabBarStyle: {
          backgroundColor: '#0a0a0a',
          borderTopColor: '#111',
          height: 60,
          paddingBottom: 8,
        },
        headerShown: false,
        tabBarShowLabel: false,
      }}>
        <Tabs.Screen
          name="summary"
          options={{
            tabBarIcon: ({ focused }) => (
              <Ionicons name={focused ? 'home' : 'home-outline'} size={22} color={focused ? '#6366f1' : '#555'} />
            ),
          }}
        />
        <Tabs.Screen
          name="index"
          options={{ tabBarIcon: ({ focused }) => <FeedIcon focused={focused} /> }}
        />
        <Tabs.Screen name="household" options={{ href: null }} />
        <Tabs.Screen name="pending" options={{ href: null }} />
        <Tabs.Screen name="add" options={{ href: null }} />
        <Tabs.Screen
          name="settings"
          options={{
            tabBarIcon: ({ focused }) => (
              <Ionicons name={focused ? 'settings' : 'settings-outline'} size={22} color={focused ? '#6366f1' : '#555'} />
            ),
          }}
        />
      </Tabs>
    </>
  );
}
