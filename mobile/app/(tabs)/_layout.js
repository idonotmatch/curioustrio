import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      tabBarStyle: { backgroundColor: '#0a0a0a', borderTopColor: '#222' },
      tabBarActiveTintColor: '#fff',
      tabBarInactiveTintColor: '#555',
      headerStyle: { backgroundColor: '#0a0a0a' },
      headerTintColor: '#fff',
    }}>
      <Tabs.Screen name="summary" options={{ title: 'Summary', tabBarLabel: 'Summary' }} />
      <Tabs.Screen name="index" options={{ title: 'My Feed', tabBarLabel: 'Feed' }} />
      <Tabs.Screen name="household" options={{ title: 'Household', tabBarLabel: 'Household' }} />
      <Tabs.Screen name="pending" options={{ title: 'Pending', tabBarLabel: 'Pending' }} />
      <Tabs.Screen name="add" options={{ title: 'Add Expense', tabBarLabel: 'Add' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarLabel: 'Settings' }} />
    </Tabs>
  );
}
