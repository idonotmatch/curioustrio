import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, TextInput, Linking, Platform,
} from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { getCoords, getLocation } from '../services/locationService';
import { api } from '../services/api';
import { colors } from '../theme/tokens';
import { locationStatusPresentation } from '../services/provenancePresentation';
import { normalizeLocationData } from '../services/locationData';
const { buildMapsUrl, formatPlaceDistance } = require('../services/locationPresentation');
const {
  currentLocationAction,
  selectSuggestedLocationCandidate,
} = require('../services/locationIntent');

export function LocationPicker({ onLocation, locationData, merchant }) {
  const [loading, setLoading] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState('');
  const [resolvingKey, setResolvingKey] = useState('');
  const [status, setStatus] = useState(locationStatusPresentation(locationData || {}));
  const [currentCoordsFallback, setCurrentCoordsFallback] = useState(null);
  const lastCoordsRef = useRef(null);
  const merchantName = `${merchant || ''}`.trim();
  const locationAction = currentLocationAction(merchantName);
  const statusDetail = locationAction.mode === 'merchant_nearby' && status.label === 'Optional'
    ? `Find ${merchantName} near your current location.`
    : status.detail;

  useEffect(() => {
    setStatus(locationStatusPresentation(locationData || {}));
  }, [locationData]);

  useEffect(() => {
    if (!searchMode) return undefined;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
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
        lastCoordsRef.current = coords;
        const params = new URLSearchParams({ q: trimmed });
        if (coords) {
          params.set('lat', String(coords.latitude));
          params.set('lng', String(coords.longitude));
        }
        const lookup = await api.get(`/places/autocomplete?${params.toString()}`);
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
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, searchMode]);

  function beginSearch(nextQuery = '', { preserveCurrentFallback = false } = {}) {
    setSearchMode(true);
    setQuery(nextQuery);
    setSearchError('');
    if (!preserveCurrentFallback) setCurrentCoordsFallback(null);
  }

  function endSearch() {
    setSearchMode(false);
    setSearchResults([]);
    setSearchError('');
    setCurrentCoordsFallback(null);
  }

  function commitLocation(result) {
    const normalized = normalizeLocationData({
      ...result,
      source: result.source || (result.search_strategy === 'user_history' ? 'history' : 'search'),
      status: 'enriched',
      confidence: result.confidence ?? 1,
      location_user_owned: true,
    });
    onLocation(normalized);
    setStatus(locationStatusPresentation(normalized));
    endSearch();
  }

  async function selectLocation(result) {
    const hasCoordinates = result.latitude != null
      && result.longitude != null
      && Number.isFinite(Number(result.latitude))
      && Number.isFinite(Number(result.longitude));
    if (!result.completion_url || hasCoordinates) {
      commitLocation(result);
      return;
    }

    const key = result.completion_url;
    setResolvingKey(key);
    setSearchError('');
    try {
      const coords = lastCoordsRef.current;
      const payload = { completion_url: result.completion_url };
      if (coords) {
        payload.lat = coords.latitude;
        payload.lng = coords.longitude;
      }
      const lookup = await api.post('/places/complete', payload);
      commitLocation(lookup?.result || result);
    } catch (error) {
      setSearchError(error?.message || 'Could not load place details');
    } finally {
      setResolvingKey('');
    }
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
      const coords = await getCoords({
        requestIfNeeded: true,
        throwOnDenied: true,
        throwOnFailure: true,
        maxAgeMs: 15000,
      });
      lastCoordsRef.current = coords;
      if (locationAction.mode === 'merchant_nearby') {
        let results = [];
        try {
          const params = new URLSearchParams({
            q: merchantName,
            intent: 'auto',
            radius: '2000',
            lat: String(coords.latitude),
            lng: String(coords.longitude),
          });
          const lookup = await api.get(`/places/search?${params.toString()}`);
          results = Array.isArray(lookup?.results)
            ? lookup.results
            : (lookup?.result ? [lookup.result] : []);
          const suggestion = selectSuggestedLocationCandidate(merchantName, results);
          if (suggestion?.value) {
            commitLocation({
              ...suggestion.value,
              source: suggestion.value.search_strategy === 'user_history' ? 'history' : 'merchant_suggestion',
              confidence: suggestion.confidence,
            });
            return;
          }
        } catch {
          results = [];
        }

        setCurrentCoordsFallback(coords);
        beginSearch(merchantName, { preserveCurrentFallback: true });
        setSearchResults(results);
        setSearchError(results.length ? '' : `No nearby match found for ${merchantName}.`);
        setStatus({
          label: 'Choose a place',
          detail: results.length
            ? `Choose the ${merchantName} location you visited.`
            : 'Search for the merchant or use your current position instead.',
        });
        return;
      }

      const result = await getLocation({ coords, throwOnFailure: true });
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

  async function useCurrentPositionFallback() {
    if (!currentCoordsFallback || loading) return;
    setLoading(true);
    try {
      const result = await getLocation({ coords: currentCoordsFallback, throwOnFailure: true });
      if (result) commitLocation(result);
    } catch (error) {
      setStatus(locationStatusPresentation({ status: error?.code || 'lookup_failed' }));
    } finally {
      setLoading(false);
    }
  }

  async function openInMaps(location = locationData) {
    const url = buildMapsUrl(location, Platform.OS);
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      setStatus({ label: 'Map unavailable', detail: 'Could not open this location in Maps.' });
    }
  }

  return (
    <View style={styles.container}>
      {locationData ? (
        <View style={styles.selectedPlace}>
          <View style={styles.selectedHeader}>
            <View style={styles.pinBadge}>
              <Ionicons name="location" size={17} color={colors.text} />
            </View>
            <View style={styles.selectedCopy}>
              <Text style={styles.label}>LOCATION</Text>
              <Text style={styles.selectedName} numberOfLines={1}>{locationData.place_name || 'Selected place'}</Text>
              {locationData.address ? <Text style={styles.address} numberOfLines={2}>{locationData.address}</Text> : null}
            </View>
            <TouchableOpacity
              onPress={() => onLocation(null)}
              style={styles.iconButton}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear location"
            >
              <Ionicons name="close" size={18} color={colors.textSubtle} />
            </TouchableOpacity>
          </View>
          <View style={styles.selectedMetaRow}>
            <View style={styles.statusBadge}>
              <Ionicons name="checkmark-circle" size={13} color={colors.success} />
              <Text style={styles.statusBadgeText}>{locationStatusPresentation(locationData).label}</Text>
            </View>
            {formatPlaceDistance(locationData.distance_meters) ? (
              <Text style={styles.distanceText}>{formatPlaceDistance(locationData.distance_meters)}</Text>
            ) : null}
          </View>
          <View style={styles.selectedActions}>
            <TouchableOpacity
              onPress={() => beginSearch(locationData.place_name || merchant || '')}
              style={styles.secondaryAction}
              accessibilityRole="button"
            >
              <Ionicons name="search" size={15} color={colors.textMuted} />
              <Text style={styles.secondaryActionText} numberOfLines={1}>Change</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => openInMaps()}
              style={styles.secondaryAction}
              accessibilityRole="link"
              accessibilityLabel="View selected location in Maps"
            >
              <Ionicons name="map-outline" size={15} color={colors.textMuted} />
              <Text style={styles.secondaryActionText} numberOfLines={1}>View in Maps</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View>
          <View style={styles.locationHeading}>
            <Ionicons name="location-outline" size={16} color={colors.textMuted} />
            <Text style={styles.label}>LOCATION</Text>
          </View>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.button} onPress={handlePress} disabled={loading}>
              {loading
                ? <ActivityIndicator color={colors.textSubtle} size="small" />
                : <Ionicons name="navigate" size={17} color={colors.textMuted} />
              }
              <Text style={styles.buttonText} numberOfLines={1}>{loading ? 'Locating…' : locationAction.label}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, searchMode && styles.buttonActive]}
              onPress={() => {
                if (searchMode) endSearch();
                else beginSearch(merchant || '');
              }}
            >
              <Ionicons name={searchMode ? 'close' : 'search'} size={17} color={searchMode ? colors.text : colors.textMuted} />
              <Text style={[styles.buttonText, searchMode && styles.buttonTextActive]} numberOfLines={1}>
                {searchMode ? 'Close search' : 'Search places'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {!locationData ? (
        <Text style={styles.statusText}>{statusDetail}</Text>
      ) : null}

      {searchMode ? (
        <View style={styles.searchPanel}>
          <View style={styles.searchInputWrap}>
            <Ionicons name="search" size={17} color={colors.textSubtle} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Merchant, place, or address"
              placeholderTextColor={colors.textDisabled}
              autoCorrect
              spellCheck
              autoCapitalize="words"
              textContentType="location"
              clearButtonMode="while-editing"
              returnKeyType="search"
              autoFocus={!query}
            />
          </View>
          {locationData ? (
            <TouchableOpacity style={styles.searchCancel} onPress={endSearch}>
              <Text style={styles.searchCancelText}>Cancel search</Text>
            </TouchableOpacity>
          ) : null}
          {currentCoordsFallback ? (
            <TouchableOpacity
              style={styles.positionFallback}
              onPress={useCurrentPositionFallback}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Use current position instead of matching the merchant"
            >
              <Ionicons name="navigate-outline" size={16} color={colors.textMuted} />
              <Text style={styles.positionFallbackText}>Use current position instead</Text>
            </TouchableOpacity>
          ) : null}
          {searching ? (
            <ActivityIndicator color={colors.textSubtle} size="small" style={{ marginTop: 10 }} />
          ) : query.trim() ? (
            searchResults.length ? (
              <View style={styles.resultsList}>
                {searchResults.map((result) => {
                  const key = result.completion_url || result.mapkit_stable_id || `${result.place_name}:${result.address}`;
                  return (
                    <TouchableOpacity
                      key={key}
                      style={styles.resultCard}
                      onPress={() => selectLocation(result)}
                      disabled={!!resolvingKey}
                    >
                      <View style={styles.resultIcon}>
                        <Ionicons
                          name={result.search_strategy === 'user_history' ? 'time-outline' : 'location-outline'}
                          size={18}
                          color={colors.textMuted}
                        />
                      </View>
                      <View style={styles.resultCopy}>
                        <Text style={styles.placeName} numberOfLines={1}>{result.place_name}</Text>
                        {result.address ? <Text style={styles.address} numberOfLines={2}>{result.address}</Text> : null}
                        <Text style={styles.resultMeta}>
                          {[
                            result.search_strategy === 'user_history' ? 'Used before' : 'Apple Maps',
                            formatPlaceDistance(result.distance_meters),
                          ].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      {resolvingKey === key
                        ? <ActivityIndicator size="small" color={colors.textSubtle} />
                        : <Ionicons name="chevron-forward" size={17} color={colors.textDisabled} />
                      }
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
  container: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locationHeading: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  actionRow: { flexDirection: 'row', gap: 8 },
  label: { fontSize: 10, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0 },
  selectedPlace: { gap: 10 },
  selectedHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  pinBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.infoMuted,
    borderWidth: 1,
    borderColor: colors.infoBorder,
  },
  selectedCopy: { flex: 1, minWidth: 0 },
  selectedName: { color: colors.text, fontSize: 15, fontWeight: '600', marginTop: 3 },
  iconButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  placeName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  address: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  statusText: { color: colors.textSubtle, fontSize: 11, marginTop: 6, lineHeight: 15 },
  selectedMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 24,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: colors.successMuted,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  statusBadgeText: { flexShrink: 1, color: colors.success, fontSize: 11, fontWeight: '600' },
  distanceText: { color: colors.textSubtle, fontSize: 11 },
  button: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    gap: 7,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  buttonActive: { backgroundColor: colors.surfacePressed, borderColor: colors.infoBorder },
  buttonText: { flexShrink: 1, color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  buttonTextActive: { color: colors.text },
  searchPanel: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  searchInputWrap: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 10 },
  searchCancel: { marginTop: 10, alignSelf: 'flex-start' },
  searchCancelText: { color: colors.textDisabled, fontSize: 12 },
  resultCard: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: colors.borderStrong },
  resultIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.neutralWash },
  resultCopy: { flex: 1, minWidth: 0 },
  resultsList: { marginTop: 10, gap: 8 },
  resultMeta: { color: colors.textSubtle, fontSize: 11, marginTop: 4 },
  emptySearch: { marginTop: 10, color: colors.textDisabled, fontSize: 12 },
  manualResult: { marginTop: 10, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.borderStrong },
  manualResultText: { flex: 1, color: colors.textSubtle, fontSize: 13, fontWeight: '500' },
  positionFallback: { marginTop: 10, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.borderStrong },
  positionFallbackText: { flexShrink: 1, color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  selectedActions: { flexDirection: 'row', gap: 8 },
  secondaryAction: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  secondaryActionText: { flexShrink: 1, color: colors.textMuted, fontSize: 12, fontWeight: '600' },
});
