import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, TextInput } from 'react-native';
import { useState, useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { getCoords, getLocation } from '../services/locationService';
import { api } from '../services/api';
import { colors } from '../theme/tokens';
import { locationStatusPresentation } from '../services/provenancePresentation';
import { normalizeLocationData } from '../services/locationData';

export function LocationPicker({ onLocation, locationData, merchant }) {
  const [loading, setLoading] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState('');
  const [status, setStatus] = useState(locationStatusPresentation(locationData || {}));

  useEffect(() => {
    setStatus(locationStatusPresentation(locationData || {}));
  }, [locationData]);

  useEffect(() => {
    if (!searchMode) return undefined;
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearching(false);
      setSearchError('');
      return undefined;
    }

    let cancelled = false;
    const timeout = setTimeout(async () => {
      setSearching(true);
      setSearchError('');
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
        params.set('intent', 'manual');
        const lookup = await api.get(`/places/search?${params.toString()}`);
        if (!cancelled) {
          setSearchResults(Array.isArray(lookup?.results) ? lookup.results : (lookup?.result ? [lookup.result] : []));
          setSearchError('');
        }
      } catch (error) {
        if (!cancelled) {
          setSearchResults([]);
          setSearchError(error?.message || 'Place search temporarily unavailable');
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, searchMode]);

  function beginSearch(nextQuery = '') {
    setSearchMode(true);
    setQuery(nextQuery);
    setSearchError('');
  }

  function endSearch() {
    setSearchMode(false);
    setSearchResults([]);
    setSearchError('');
  }

  function selectLocation(result) {
    onLocation(normalizeLocationData({
      ...result,
      source: result.source || (result.search_strategy === 'user_history' ? 'history' : 'search'),
      status: 'enriched',
      confidence: result.confidence ?? 1,
      location_user_owned: true,
    }));
    setStatus(locationStatusPresentation({ source: result.search_strategy === 'user_history' ? 'history' : 'search' }));
    endSearch();
  }

  function useEnteredLocation() {
    const placeName = query.trim();
    if (!placeName) return;
    const result = normalizeLocationData({
      place_name: placeName,
      provider: 'manual',
      source: 'manual_text',
      status: 'user_entered',
      confidence: 1,
      location_user_owned: true,
      search_strategy: 'manual_text',
    });
    onLocation(result);
    setStatus(locationStatusPresentation(result));
    endSearch();
  }

  async function handlePress() {
    setLoading(true);
    setStatus(locationStatusPresentation({ status: 'deferred' }));
    try {
      const result = await getLocation({ requestIfNeeded: true, throwOnDenied: true, throwOnFailure: true });
      if (result) {
        onLocation(result);
        setStatus(locationStatusPresentation(result));
      } else {
        setStatus(locationStatusPresentation({ status: 'no_match' }));
      }
    } catch (e) {
      setStatus(locationStatusPresentation({ status: e?.code || 'lookup_failed' }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      {locationData ? (
        <>
          <View style={styles.row}>
            <Text style={styles.label}>LOCATION</Text>
            <TouchableOpacity onPress={() => onLocation(null)} accessibilityRole="button" accessibilityLabel="Clear location">
              <Ionicons name="close" size={16} color={colors.textDisabled} />
            </TouchableOpacity>
          </View>
          <Text style={styles.placeName}>{locationData.place_name}</Text>
          {locationData.address ? <Text style={styles.address}>{locationData.address}</Text> : null}
          <Text style={styles.statusText}>{locationStatusPresentation(locationData).label}</Text>
          <TouchableOpacity onPress={() => beginSearch(locationData.place_name || merchant || '')} style={styles.secondaryAction}>
            <Text style={styles.secondaryActionText}>Search for a different place</Text>
          </TouchableOpacity>
        </>
      ) : (
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.button} onPress={handlePress} disabled={loading}>
            {loading
              ? <ActivityIndicator color={colors.textSubtle} size="small" />
              : <Text style={styles.buttonText}>Use current location</Text>
            }
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.searchToggle, searchMode && styles.searchToggleActive]}
            onPress={() => {
              if (searchMode) {
                endSearch();
              } else {
                beginSearch(merchant || '');
              }
            }}
          >
            <Text style={[styles.searchToggleText, searchMode && styles.searchToggleTextActive]}>Search place</Text>
          </TouchableOpacity>
        </View>
      )}
      {!locationData ? (
        <Text style={styles.statusText}>{status.detail}</Text>
      ) : null}

      {searchMode ? (
        <View style={styles.searchPanel}>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search for a place"
            placeholderTextColor={colors.textDisabled}
            autoCorrect={false}
          />
          {locationData ? (
            <TouchableOpacity style={styles.searchCancel} onPress={endSearch}>
              <Text style={styles.searchCancelText}>Cancel search</Text>
            </TouchableOpacity>
          ) : null}
          {searching ? (
            <ActivityIndicator color={colors.textSubtle} size="small" style={{ marginTop: 10 }} />
          ) : query.trim() ? (
            searchResults.length ? (
              <View style={styles.resultsList}>
                {searchResults.map((result) => {
                  const key = result.mapkit_stable_id || `${result.place_name}:${result.address}`;
                  return (
                    <TouchableOpacity key={key} style={styles.resultCard} onPress={() => selectLocation(result)}>
                      <Text style={styles.placeName}>{result.place_name}</Text>
                      {result.address ? <Text style={styles.address}>{result.address}</Text> : null}
                      <Text style={styles.statusText}>{result.search_strategy === 'user_history' ? 'Used by you before' : 'Place search result'}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <View>
                <Text style={styles.emptySearch}>
                  {searchError || 'No place match found yet.'}
                </Text>
                <TouchableOpacity
                  style={styles.manualResult}
                  onPress={useEnteredLocation}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${query.trim()} as entered`}
                >
                  <Ionicons name="create-outline" size={16} color={colors.textSubtle} />
                  <Text style={styles.manualResultText} numberOfLines={1}>
                    Use "{query.trim()}" as entered
                  </Text>
                </TouchableOpacity>
              </View>
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
  container: { backgroundColor: colors.borderSubtle, borderRadius: 8, padding: 12, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  actionRow: { flexDirection: 'row', gap: 8 },
  label: { fontSize: 10, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 1 },
  placeName: { color: colors.text, fontSize: 14 },
  address: { color: colors.textDisabled, fontSize: 12, marginTop: 2 },
  statusText: { color: colors.textSubtle, fontSize: 11, marginTop: 6, lineHeight: 15 },
  button: { flex: 1, backgroundColor: colors.surface, borderRadius: 8, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.borderStrong },
  buttonText: { color: colors.textSubtle, fontSize: 13 },
  searchToggle: { paddingHorizontal: 12, justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  searchToggleActive: { backgroundColor: colors.text, borderColor: colors.text },
  searchToggleText: { color: colors.textSubtle, fontSize: 13, fontWeight: '500' },
  searchToggleTextActive: { color: colors.textInverse },
  searchPanel: { marginTop: 10 },
  searchInput: { backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontSize: 14, borderWidth: 1, borderColor: colors.borderStrong },
  searchCancel: { marginTop: 10, alignSelf: 'flex-start' },
  searchCancelText: { color: colors.textDisabled, fontSize: 12 },
  resultCard: { marginTop: 10, backgroundColor: colors.surface, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: colors.borderStrong },
  resultsList: { marginTop: 10, gap: 8 },
  emptySearch: { marginTop: 10, color: colors.textDisabled, fontSize: 12 },
  manualResult: { marginTop: 10, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.borderStrong },
  manualResultText: { flex: 1, color: colors.textSubtle, fontSize: 13, fontWeight: '500' },
  secondaryAction: { marginTop: 10 },
  secondaryActionText: { color: colors.textDisabled, fontSize: 12 },
});
