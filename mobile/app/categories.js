import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { api } from '../services/api';

export default function CategoriesScreen() {
  const [categories, setCategories] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [suggestions, setSuggestions] = useState([]);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  // Add form
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState('parent'); // 'parent' | 'leaf'
  const [newCatParentId, setNewCatParentId] = useState(null);
  const [addingCat, setAddingCat] = useState(false);

  // Edit
  const [editingCatId, setEditingCatId] = useState(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [editingParentId, setEditingParentId] = useState(undefined);

  const [errorMsg, setErrorMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
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
    if (newCatType === 'leaf' && !newCatParentId) {
      setErrorMsg('Select a parent category');
      return;
    }
    setErrorMsg('');
    setAddingCat(true);
    try {
      const body = { name: newCatName.trim() };
      if (newCatType === 'leaf' && newCatParentId) body.parent_id = newCatParentId;
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

  function startEditing(cat) {
    setEditingCatId(cat.id);
    setEditingCatName(cat.name);
    // Only track parent for leaf categories
    setEditingParentId(cat.parent_id ? cat.parent_id : undefined);
  }

  async function saveCategory(id) {
    if (!editingCatName.trim()) return;
    setErrorMsg('');
    try {
      const body = { name: editingCatName.trim() };
      if (editingParentId !== undefined) body.parent_id = editingParentId;
      await api.patch(`/categories/${id}`, body);
      setEditingCatId(null);
      load();
    } catch (e) {
      setErrorMsg(e.message || 'Something went wrong');
    }
  }

  async function deleteCategory(id, name) {
    Alert.alert(
      'Delete category',
      `Delete "${name}"? Expenses will keep this category. Child categories will be moved to Ungrouped.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            setErrorMsg('');
            try { await api.delete(`/categories/${id}`); load(); }
            catch (e) { setErrorMsg(e.message || 'Something went wrong'); }
          },
        },
      ]
    );
  }

  async function acceptSuggestion(id) {
    setErrorMsg('');
    try {
      await api.post(`/categories/suggestions/${id}/accept`);
      load();
    } catch (e) { setErrorMsg(e.message || 'Something went wrong'); }
  }

  async function rejectSuggestion(id) {
    setErrorMsg('');
    try {
      await api.post(`/categories/suggestions/${id}/reject`);
      load();
    } catch (e) { setErrorMsg(e.message || 'Something went wrong'); }
  }

  const custom = categories.filter(c => c.household_id !== null);
  const defaults = categories.filter(c => c.household_id === null);
  const parentOptions = custom.filter(c => !c.parent_id);

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

  function renderDeleteAction(cat) {
    return (
      <TouchableOpacity
        style={styles.deleteSwipe}
        onPress={() => deleteCategory(cat.id, cat.name)}
      >
        <Ionicons name="trash-outline" size={16} color="#fff" />
        <Text style={styles.deleteSwipeText}>Delete</Text>
      </TouchableOpacity>
    );
  }

  function renderCatRow(cat, indented = false) {
    const isEditing = editingCatId === cat.id;
    const isLeaf = !!cat.parent_id;

    return (
      <Swipeable
        key={cat.id}
        renderRightActions={() => renderDeleteAction(cat)}
        overshootRight={false}
      >
        <View style={[styles.row, indented && styles.rowIndented]}>
          {isEditing ? (
            <View style={styles.editBlock}>
              <TextInput
                style={styles.editInput}
                value={editingCatName}
                onChangeText={setEditingCatName}
                autoFocus
                onSubmitEditing={() => saveCategory(cat.id)}
                returnKeyType="done"
              />
              {isLeaf && parentOptions.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.editParentPicker}>
                  <View style={styles.editParentRow}>
                    <TouchableOpacity
                      style={[styles.parentChip, editingParentId === null && styles.parentChipActive]}
                      onPress={() => setEditingParentId(null)}
                    >
                      <Text style={[styles.parentChipText, editingParentId === null && styles.parentChipTextActive]}>
                        Ungrouped
                      </Text>
                    </TouchableOpacity>
                    {parentOptions.map(p => (
                      <TouchableOpacity
                        key={p.id}
                        style={[styles.parentChip, editingParentId === p.id && styles.parentChipActive]}
                        onPress={() => setEditingParentId(p.id)}
                      >
                        <Text style={[styles.parentChipText, editingParentId === p.id && styles.parentChipTextActive]}>
                          {p.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              )}
            </View>
          ) : (
            <Text style={styles.catName}>{cat.name}</Text>
          )}
          <View style={styles.actions}>
            {isEditing ? (
              <>
                <TouchableOpacity onPress={() => saveCategory(cat.id)}>
                  <Text style={styles.saveText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setEditingCatId(null)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity onPress={() => startEditing(cat)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="pencil-outline" size={16} color="#555" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Swipeable>
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
            {/* Add new — TOP */}
            <View style={styles.addSection}>
              <Text style={styles.sectionLabel}>ADD CATEGORY</Text>
              <View style={styles.typeRow}>
                <TouchableOpacity
                  style={[styles.typeBtn, newCatType === 'parent' && styles.typeBtnActive]}
                  onPress={() => { setNewCatType('parent'); setNewCatParentId(null); }}
                >
                  <Text style={[styles.typeBtnText, newCatType === 'parent' && styles.typeBtnTextActive]}>
                    Top-level
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.typeBtn, newCatType === 'leaf' && styles.typeBtnActive, parentOptions.length === 0 && styles.typeBtnDisabled]}
                  onPress={() => parentOptions.length > 0 && setNewCatType('leaf')}
                  disabled={parentOptions.length === 0}
                >
                  <Text style={[styles.typeBtnText, newCatType === 'leaf' && styles.typeBtnTextActive, parentOptions.length === 0 && styles.typeBtnTextDisabled]}>
                    Sub-category
                  </Text>
                </TouchableOpacity>
              </View>

              {newCatType === 'leaf' && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.parentPicker}>
                  <View style={styles.parentPickerRow}>
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
                  </View>
                </ScrollView>
              )}

              <View style={styles.addRow}>
                <TextInput
                  style={[styles.editInput, { flex: 1 }]}
                  value={newCatName}
                  onChangeText={setNewCatName}
                  placeholder={newCatType === 'parent' ? 'e.g. Food & Drink' : 'e.g. Groceries'}
                  placeholderTextColor="#444"
                  onSubmitEditing={addCategory}
                  returnKeyType="done"
                />
                <TouchableOpacity
                  style={[
                    styles.addBtn,
                    (!newCatName.trim() || addingCat || (newCatType === 'leaf' && !newCatParentId)) && styles.addBtnDisabled,
                  ]}
                  onPress={addCategory}
                  disabled={!newCatName.trim() || addingCat || (newCatType === 'leaf' && !newCatParentId)}
                >
                  {addingCat
                    ? <ActivityIndicator color="#000" size="small" />
                    : <Text style={styles.addBtnText}>Add</Text>}
                </TouchableOpacity>
              </View>
              {errorMsg ? <Text style={styles.errorMsg}>{errorMsg}</Text> : null}
            </View>

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

            {/* Custom categories */}
            <Text style={styles.sectionLabel}>CUSTOM</Text>
            {custom.length === 0 && <Text style={styles.empty}>No custom categories yet.</Text>}

            {parentCats.map(parent => (
              <View key={parent.id}>
                <View style={styles.parentHeader}>
                  {editingCatId === parent.id ? (
                    <TextInput
                      style={[styles.editInput, { flex: 1 }]}
                      value={editingCatName}
                      onChangeText={setEditingCatName}
                      autoFocus
                      onSubmitEditing={() => saveCategory(parent.id)}
                      returnKeyType="done"
                    />
                  ) : (
                    <Text style={styles.parentLabel}>{parent.name}</Text>
                  )}
                  <View style={styles.actions}>
                    {editingCatId === parent.id ? (
                      <>
                        <TouchableOpacity onPress={() => saveCategory(parent.id)}>
                          <Text style={styles.saveText}>Save</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setEditingCatId(null)}>
                          <Text style={styles.cancelText}>Cancel</Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <TouchableOpacity onPress={() => startEditing(parent)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="pencil-outline" size={15} color="#555" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
                {(childrenByParent[parent.id] || []).map(child => renderCatRow(child, true))}
              </View>
            ))}

            {ungrouped.length > 0 && (
              <View style={styles.ungroupedSection}>
                <Text style={styles.ungroupedLabel}>Ungrouped</Text>
                {ungrouped.map(cat => renderCatRow(cat, false))}
              </View>
            )}

            {/* Default categories */}
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

  // Add section
  addSection: { marginBottom: 28 },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  typeBtn: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8,
    backgroundColor: '#111', borderWidth: 1, borderColor: '#222',
  },
  typeBtnActive: { backgroundColor: '#f5f5f5', borderColor: '#f5f5f5' },
  typeBtnDisabled: { opacity: 0.3 },
  typeBtnText: { fontSize: 13, color: '#666' },
  typeBtnTextActive: { color: '#000', fontWeight: '600' },
  typeBtnTextDisabled: { color: '#444' },
  parentPicker: { marginBottom: 10 },
  parentPickerRow: { flexDirection: 'row', gap: 8 },
  addRow: { flexDirection: 'row', gap: 10 },
  addBtn: { backgroundColor: '#f5f5f5', borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' },
  addBtnDisabled: { opacity: 0.3 },
  addBtnText: { color: '#000', fontWeight: '600', fontSize: 14 },
  errorMsg: { color: '#ef4444', fontSize: 13, marginTop: 10 },

  // Suggestions
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
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingRight: 12, borderBottomWidth: 1, borderBottomColor: '#111', backgroundColor: '#0a0a0a' },
  rowIndented: { paddingLeft: 16 },
  catName: { flex: 1, fontSize: 15, color: '#f5f5f5' },
  actions: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  saveText: { color: '#4ade80', fontSize: 13, fontWeight: '600' },
  cancelText: { color: '#555', fontSize: 13 },

  // Edit mode within row
  editBlock: { flex: 1, marginRight: 12 },
  editInput: { backgroundColor: '#111', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, color: '#f5f5f5', fontSize: 14, borderWidth: 1, borderColor: '#1f1f1f' },
  editParentPicker: { marginTop: 8 },
  editParentRow: { flexDirection: 'row', gap: 6 },

  // Parent chips (shared)
  parentChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: '#111', borderWidth: 1, borderColor: '#222', marginRight: 2 },
  parentChipActive: { backgroundColor: '#f5f5f5', borderColor: '#f5f5f5' },
  parentChipText: { fontSize: 13, color: '#555' },
  parentChipTextActive: { color: '#000', fontWeight: '600' },

  // Parent category header
  parentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  parentLabel: { flex: 1, fontSize: 13, color: '#888', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  ungroupedSection: { marginTop: 12 },
  ungroupedLabel: { fontSize: 10, color: '#333', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },

  // Swipe delete
  deleteSwipe: { backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center', width: 72, borderBottomWidth: 1, borderBottomColor: '#111', gap: 3 },
  deleteSwipeText: { color: '#fff', fontSize: 10, fontWeight: '600' },
});
