import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useState } from 'react';
import { getCoords, getLocation } from '../services/locationService';
import { api } from '../services/api';

export function LocationPicker({ onLocation, locationData, merchant }) {
  const [loading, setLoading] = useState(false);

  async function handlePress() {
    setLoading(true);
    try {
      let result = null;
      if (merchant?.trim()) {
        const coords = await getCoords();
        if (coords) {
          const lookup = await api.get(
            `/places/search?q=${encodeURIComponent(merchant)}&lat=${coords.latitude}&lng=${coords.longitude}`
          );
          result = lookup?.result || null;
        }
      }
      if (!result) {
        result = await getLocation();
      }
      if (result) onLocation(result);
    } catch (e) {
      // silently fail — location is optional
    } finally {
      setLoading(false);
    }
  }

  if (locationData) {
    return (
      <View style={styles.container}>
        <View style={styles.row}>
          <Text style={styles.label}>LOCATION</Text>
          <TouchableOpacity onPress={() => onLocation(null)}>
            <Text style={styles.clear}>✕ clear</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.placeName}>{locationData.place_name}</Text>
        {locationData.address ? <Text style={styles.address}>{locationData.address}</Text> : null}
      </View>
    );
  }

  return (
    <TouchableOpacity style={styles.button} onPress={handlePress} disabled={loading}>
      {loading
        ? <ActivityIndicator color="#888" size="small" />
        : <Text style={styles.buttonText}>📍  Use current location</Text>
      }
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#1a1a1a', borderRadius: 8, padding: 12, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 1 },
  clear: { fontSize: 11, color: '#555' },
  placeName: { color: '#fff', fontSize: 14 },
  address: { color: '#666', fontSize: 12, marginTop: 2 },
  button: { backgroundColor: '#1a1a1a', borderRadius: 8, padding: 14, alignItems: 'center', marginBottom: 8 },
  buttonText: { color: '#888', fontSize: 13 },
});
