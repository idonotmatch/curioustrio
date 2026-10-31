import { Tabs, useRouter } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { useEffect, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { usePendingExpenseCount } from '../../hooks/usePendingExpenseCount';
import { useMonth, currentPeriod } from '../../contexts/MonthContext';
import { useAdaptiveLayout } from '../../contexts/AdaptiveLayoutContext';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { GlobalAddLauncher } from '../../components/GlobalAddLauncher';
import { subscribeGlobalAddLauncher } from '../../services/globalAddLauncherBus';
import { colors } from '../../theme/tokens';

function ActivityIcon({ focused }) {
  return (
    <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={22} color={focused ? colors.accent : colors.textDisabled} />
  );
}

function PendingIcon({ focused }) {
  const { count } = usePendingExpenseCount();
  return (
    <View>
      <Ionicons name={focused ? 'time' : 'time-outline'} size={22} color={focused ? colors.accent : colors.textDisabled} />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  addDock: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.background,
  },
  addDockFocused: {
    backgroundColor: colors.accentPressed,
  },
  badge: {
    position: 'absolute', top: -4, right: -8,
    backgroundColor: colors.danger, borderRadius: 8,
    minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  badgeText: { color: colors.text, fontSize: 9, fontWeight: '700' },
  tabLabel: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
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
  const router = useRouter();
  const layout = useAdaptiveLayout();
  const addLauncherRef = useRef(null);
  const visualTabBarHeight = layout.isWide ? 60 : 52;

  useEffect(() => subscribeGlobalAddLauncher(() => {
    addLauncherRef.current?.open?.();
  }), []);

  return (
    <>
      <StartDaySyncer />
      <Tabs initialRouteName="summary" screenOptions={{
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.surface,
          height: visualTabBarHeight + layout.insets.bottom,
          paddingTop: 6,
          paddingBottom: Math.max(layout.insets.bottom, 8),
          paddingLeft: layout.insets.left,
          paddingRight: layout.insets.right,
        },
        headerShown: false,
        tabBarShowLabel: layout.isWide,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: {
          paddingVertical: 0,
        },
      }}>
        <Tabs.Screen
          name="summary"
          options={{
            title: 'Summary',
            tabBarIcon: ({ focused }) => (
              <Ionicons name={focused ? 'home' : 'home-outline'} size={22} color={focused ? colors.accent : colors.textDisabled} />
            ),
          }}
        />
        <Tabs.Screen
          name="index"
          options={{
            title: 'Activity',
            tabBarIcon: ({ focused }) => <ActivityIcon focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="add"
          listeners={{
            tabPress: (event) => {
              event.preventDefault();
              addLauncherRef.current?.open?.();
            },
          }}
          options={{
            title: 'Add',
            tabBarIcon: ({ focused }) => (
              <View style={[styles.addDock, focused && styles.addDockFocused]}>
                <Ionicons name="add" size={24} color={colors.textInverse} />
              </View>
            ),
            tabBarAccessibilityLabel: 'Add expense options',
          }}
        />
        <Tabs.Screen name="household" options={{ href: null }} />
        <Tabs.Screen
          name="pending"
          options={{
            title: 'Actions',
            tabBarIcon: ({ focused }) => <PendingIcon focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: ({ focused }) => (
              <Ionicons name={focused ? 'settings' : 'settings-outline'} size={22} color={focused ? colors.accent : colors.textDisabled} />
            ),
          }}
        />
      </Tabs>
      <GlobalAddLauncher ref={addLauncherRef} router={router} />
    </>
  );
}
