import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePendingExpenses } from '../../hooks/usePendingExpenses';

function FeedIcon({ focused }) {
  const { expenses } = usePendingExpenses();
  const count = expenses?.length ?? 0;
  return (
    <View>
      <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={22} color={focused ? '#f5f5f5' : '#444'} />
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

export default function TabLayout() {
  return (
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
            <Ionicons name={focused ? 'home' : 'home-outline'} size={22} color={focused ? '#f5f5f5' : '#444'} />
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
            <Ionicons name={focused ? 'settings' : 'settings-outline'} size={22} color={focused ? '#f5f5f5' : '#444'} />
          ),
        }}
      />
    </Tabs>
  );
}
