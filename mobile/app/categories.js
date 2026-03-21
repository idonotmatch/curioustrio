import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { Stack } from 'expo-router';
import { api } from '../services/api';

export default function CategoriesScreen() {
  const [categories, setCategories] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [suggestions, setSuggestions] = useState([]);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  const [newCatName, setNewCatName] = useState('');
  const [newCatParentId, setNewCatParentId] = useState(null);
  const [addingCat, setAddingCat] = useState(false);

  const [editingCatId, setEditingCatId] = useState(null);
  const [editingCatName, setEditingCatName] = useState('');

  const [errorMsg, setErrorMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/categories');
      setCategories(data.categories || []);
      const count = data.pending_suggestions_count || 0;
      setPendingCount(count);
      if (count > 0) {
        const s = await api.get('/categories/suggestions');
        setSuggestions(s);
      } else {
        setSuggestions([]);
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addCategory() {
    if (!newCatName.trim()) return;
    setErrorMsg('');
    setAddingCat(true);
    try {
      const body = { name: newCatName.trim() };
      if (newCatParentId) body.parent_id = newCatParentId;
      await api.post('/categories', body);
      setNewCatName('');
      setNewCatParentId(null);
      load();
    } catch (e) {
      setErrorMsg(e.message || 'Something went wrong');
    } finally {
      setAddingCat(false);
    }
  }

  async function saveCategory(id) {
    if (!editingCatName.trim()) return;
    setErrorMsg('');
    try {
      await api.patch(`/categories/${id}`, { name: editingCatName.trim() });
      setEditingCatId(null);
      load();
    } catch (e) {
      setErrorMsg(e.message || 'Something went wrong');
    }
  }

  async function deleteCategory(id, name) {
    Alert.alert('Delete category', `Delete "${name}"? Expenses won't lose their category.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setErrorMsg('');
          try { await api.delete(`/categories/${id}`); load(); }
          catch (e) { setErrorMsg(e.message || 'Something went wrong'); }
        },
      },
    ]);
  }

  async function acceptSuggestion(id) {
    setErrorMsg('');
    try {
      await api.post(`/categories/suggestions/${id}/accept`);
      load();
    } catch (e) {
      setErrorMsg(e.message || 'Something went wrong');
    }
  }

  async function rejectSuggestion(id) {
    setErrorMsg('');
    try {
      await api.post(`/categories/suggestions/${id}/reject`);
      load();
    } catch (e) {
      setErrorMsg(e.message || 'Something went wrong');
    }
  }

  const custom = categories.filter(c => c.household_id !== null);
  const defaults = categories.filter(c => c.household_id === null);

  // Which IDs are referenced as parent_id by at least one custom category
  const referencedParentIds = new Set(custom.filter(c => c.parent_id).map(c => c.parent_id));
  const parentCats = custom.filter(c => !c.parent_id && referencedParentIds.has(c.id));
  const childrenByParent = {};
  custom.filter(c => c.parent_id).forEach(c => {
    if (!childrenByParent[c.parent_id]) childrenByParent[c.parent_id] = [];
    childrenByParent[c.parent_id].push(c);
  });
  const renderedIds = new Set([
    ...parentCats.map(c => c.id),
    ...Object.values(childrenByParent).flat().map(c => c.id),
  ]);
  const ungrouped = custom.filter(c => !renderedIds.has(c.id));

  // Parent options for the "add" form picker
  const parentOptions = custom.filter(c => !c.parent_id);

  function renderCatRow(cat, indented = false) {
    return (
      <View key={cat.id} style={[styles.row, indented && styles.rowIndented]}>
        {editingCatId === cat.id ? (
          <TextInput
            style={[styles.editInput, { flex: 1 }]}
            value={editingCatName}
            onChangeText={setEditingCatName}
            autoFocus
            onSubmitEditing={() => saveCategory(cat.id)}
            returnKeyType="done"
          />
        ) : (
          <Text style={styles.catName}>{cat.name}</Text>
        )}
        <View style={styles.actions}>
          {editingCatId === cat.id ? (
            <>
              <TouchableOpacity onPress={() => saveCategory(cat.id)}>
                <Text style={styles.saveText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setEditingCatId(null)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity onPress={() => { setEditingCatId(cat.id); setEditingCatName(cat.name); }}>
                <Text style={styles.editText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => deleteCategory(cat.id, cat.name)}>
                <Text style={styles.deleteText}>Delete</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Category Details' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {loading ? (
          <ActivityIndicator color="#555" style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Suggestions card */}
            {pendingCount > 0 && !dismissed && (
              <View style={styles.suggestCard}>
                <View style={styles.suggestHeader}>
                  <Text style={styles.suggestTitle}>Suggested groupings</Text>
                  <TouchableOpacity onPress={() => setDismissed(true)}>
                    <Text style={styles.dismissText}>Dismiss</Text>
                  </TouchableOpacity>
                </View>
                {suggestions.map(s => (
                  <View key={s.id} style={styles.suggestRow}>
                    <Text style={styles.suggestLabel}>
                      {s.leaf.name} → {s.suggested_parent.name}
                    </Text>
                    <View style={styles.suggestActions}>
                      <TouchableOpacity onPress={() => acceptSuggestion(s.id)}>
                        <Text style={styles.acceptText}>Accept</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => rejectSuggestion(s.id)}>
                        <Text style={styles.rejectText}>Reject</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Grouped custom categories */}
            <Text style={styles.sectionLabel}>CUSTOM</Text>
            {custom.length === 0 && <Text style={styles.empty}>No custom categories yet.</Text>}

            {/* Parent sections */}
            {parentCats.map(parent => (
              <View key={parent.id}>
                <View style={styles.parentHeader}>
                  <Text style={styles.parentLabel}>{parent.name}</Text>
                  <View style={styles.actions}>
                    <TouchableOpacity onPress={() => { setEditingCatId(parent.id); setEditingCatName(parent.name); }}>
                      <Text style={styles.editText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteCategory(parent.id, parent.name)}>
                      <Text style={styles.deleteText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {(childrenByParent[parent.id] || []).map(child => renderCatRow(child, true))}
              </View>
            ))}

            {/* Ungrouped */}
            {ungrouped.length > 0 && (
              <View style={styles.ungroupedSection}>
                <Text style={styles.ungroupedLabel}>Ungrouped</Text>
                {ungrouped.map(cat => renderCatRow(cat, false))}
              </View>
            )}

            {/* Add new */}
            <View style={styles.addSection}>
              <View style={styles.addRow}>
                <TextInput
                  style={[styles.editInput, { flex: 1 }]}
                  value={newCatName}
                  onChangeText={setNewCatName}
                  placeholder="New category name"
                  placeholderTextColor="#444"
                  onSubmitEditing={addCategory}
                  returnKeyType="done"
                />
                <TouchableOpacity
                  style={[styles.addBtn, (!newCatName.trim() || addingCat) && styles.addBtnDisabled]}
                  onPress={addCategory}
                  disabled={!newCatName.trim() || addingCat}
                >
                  {addingCat
                    ? <ActivityIndicator color="#000" size="small" />
                    : <Text style={styles.addBtnText}>Add</Text>}
                </TouchableOpacity>
              </View>
              {/* Optional parent picker */}
              {parentOptions.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.parentPicker}>
                  <TouchableOpacity
                    style={[styles.parentChip, !newCatParentId && styles.parentChipActive]}
                    onPress={() => setNewCatParentId(null)}
                  >
                    <Text style={[styles.parentChipText, !newCatParentId && styles.parentChipTextActive]}>None</Text>
                  </TouchableOpacity>
                  {parentOptions.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.parentChip, newCatParentId === p.id && styles.parentChipActive]}
                      onPress={() => setNewCatParentId(p.id)}
                    >
                      <Text style={[styles.parentChipText, newCatParentId === p.id && styles.parentChipTextActive]}>
                        {p.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </View>

            {errorMsg ? <Text style={styles.errorMsg}>{errorMsg}</Text> : null}

            {/* Default categories (read-only) */}
            <Text style={[styles.sectionLabel, { marginTop: 32 }]}>DEFAULTS</Text>
            <Text style={styles.defaultsNote}>Built-in categories shared across all households.</Text>
            {defaults.map(cat => (
              <View key={cat.id} style={[styles.row, { opacity: 0.4 }]}>
                <Text style={styles.catName}>{cat.name}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 48 },

  sectionLabel: { fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 },
  empty: { color: '#444', fontSize: 13, marginBottom: 12 },
  defaultsNote: { color: '#444', fontSize: 12, marginBottom: 10 },

  // Suggestions card
  suggestCard: { backgroundColor: '#111', borderRadius: 10, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: '#2a2a1a' },
  suggestHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  suggestTitle: { fontSize: 11, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '600' },
  dismissText: { fontSize: 12, color: '#555' },
  suggestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  suggestLabel: { flex: 1, color: '#ccc', fontSize: 14 },
  suggestActions: { flexDirection: 'row', gap: 12 },
  acceptText: { color: '#4ade80', fontSize: 13, fontWeight: '600' },
  rejectText: { color: '#555', fontSize: 13 },

  // Category rows
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#111' },
  rowIndented: { paddingLeft: 16 },
  catName: { flex: 1, fontSize: 15, color: '#f5f5f5' },
  actions: { flexDirection: 'row', gap: 16 },
  editText: { color: '#888', fontSize: 13 },
  deleteText: { color: '#ef4444', fontSize: 13 },
  saveText: { color: '#4ade80', fontSize: 13, fontWeight: '600' },
  cancelText: { color: '#555', fontSize: 13 },

  // Parent section header
  parentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  parentLabel: { flex: 1, fontSize: 13, color: '#888', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Ungrouped section
  ungroupedSection: { marginTop: 12 },
  ungroupedLabel: { fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },

  // Edit input
  editInput: { backgroundColor: '#111', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, color: '#f5f5f5', fontSize: 14, borderWidth: 1, borderColor: '#1f1f1f' },

  // Add form
  addSection: { marginTop: 16 },
  addRow: { flexDirection: 'row', gap: 10 },
  addBtn: { backgroundColor: '#f5f5f5', borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' },
  addBtnDisabled: { opacity: 0.3 },
  addBtnText: { color: '#000', fontWeight: '600', fontSize: 14 },

  // Error message
  errorMsg: { color: '#ef4444', fontSize: 13, marginTop: 10 },

  // Parent picker
  parentPicker: { marginTop: 10 },
  parentChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: '#111', borderWidth: 1, borderColor: '#222', marginRight: 8 },
  parentChipActive: { backgroundColor: '#f5f5f5', borderColor: '#f5f5f5' },
  parentChipText: { fontSize: 13, color: '#555' },
  parentChipTextActive: { color: '#000', fontWeight: '600' },
});
