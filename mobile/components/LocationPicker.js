import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, TextInput } from 'react-native';
import { useState, useEffect } from 'react';
import { getCoords, getLocation } from '../services/locationService';
import { api } from '../services/api';

export function LocationPicker({ onLocation, locationData, merchant }) {
  const [loading, setLoading] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);

  useEffect(() => {
    if (!searchMode) return undefined;
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearching(false);
      return undefined;
    }

    let cancelled = false;
    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        let coords = null;
        try {
          coords = await getCoords();
        } catch {
          coords = null;
        }
        const params = new URLSearchParams({ q: trimmed });
        if (coords) {
          params.set('lat', String(coords.latitude));
          params.set('lng', String(coords.longitude));
        }
        const lookup = await api.get(`/places/search?${params.toString()}`);
        if (!cancelled) setSearchResults(Array.isArray(lookup?.results) ? lookup.results : (lookup?.result ? [lookup.result] : []));
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, searchMode]);

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
        <TouchableOpacity onPress={() => { setSearchMode(true); setQuery(locationData.place_name || ''); }} style={styles.secondaryAction}>
          <Text style={styles.secondaryActionText}>Search for a different place</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.button} onPress={handlePress} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#888" size="small" />
            : <Text style={styles.buttonText}>Use current location</Text>
          }
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.searchToggle, searchMode && styles.searchToggleActive]}
          onPress={() => {
            setSearchMode(v => !v);
            if (!searchMode) setQuery(merchant || '');
            if (searchMode) setSearchResults([]);
          }}
        >
          <Text style={[styles.searchToggleText, searchMode && styles.searchToggleTextActive]}>Search place</Text>
        </TouchableOpacity>
      </View>

      {searchMode ? (
        <View style={styles.searchPanel}>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search for a place"
            placeholderTextColor="#444"
            autoCorrect={false}
          />
          {searching ? (
            <ActivityIndicator color="#888" size="small" style={{ marginTop: 10 }} />
          ) : query.trim() ? (
            searchResults.length ? (
              <View style={styles.resultsList}>
                {searchResults.map((result) => {
                  const key = result.mapkit_stable_id || `${result.place_name}:${result.address}`;
                  return (
                    <TouchableOpacity key={key} style={styles.resultCard} onPress={() => onLocation(result)}>
                      <Text style={styles.placeName}>{result.place_name}</Text>
                      {result.address ? <Text style={styles.address}>{result.address}</Text> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.emptySearch}>No place match found yet.</Text>
            )
          ) : (
            <Text style={styles.emptySearch}>Start typing to search for a place.</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#1a1a1a', borderRadius: 8, padding: 12, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  actionRow: { flexDirection: 'row', gap: 8 },
  label: { fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 1 },
  clear: { fontSize: 11, color: '#555' },
  placeName: { color: '#fff', fontSize: 14 },
  address: { color: '#666', fontSize: 12, marginTop: 2 },
  button: { flex: 1, backgroundColor: '#111', borderRadius: 8, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#2a2a2a' },
  buttonText: { color: '#888', fontSize: 13 },
  searchToggle: { paddingHorizontal: 12, justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#111' },
  searchToggleActive: { backgroundColor: '#f5f5f5', borderColor: '#f5f5f5' },
  searchToggleText: { color: '#888', fontSize: 13, fontWeight: '500' },
  searchToggleTextActive: { color: '#000' },
  searchPanel: { marginTop: 10 },
  searchInput: { backgroundColor: '#111', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: '#f5f5f5', fontSize: 14, borderWidth: 1, borderColor: '#2a2a2a' },
  resultCard: { marginTop: 10, backgroundColor: '#111', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#2a2a2a' },
  resultsList: { marginTop: 10, gap: 8 },
  emptySearch: { marginTop: 10, color: '#666', fontSize: 12 },
  secondaryAction: { marginTop: 10 },
  secondaryActionText: { color: '#777', fontSize: 12 },
});
