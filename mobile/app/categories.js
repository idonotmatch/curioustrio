import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { api } from '../services/api';
import { loadWithCache, invalidateCacheByPrefix } from '../services/cache';
import { DismissKeyboardScrollView } from '../components/DismissKeyboardScrollView';

export default function CategoriesScreen() {
  const [categories, setCategories] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [suggestions, setSuggestions] = useState([]);
  const [snoozedSuggestionIds, setSnoozedSuggestionIds] = useState([]);
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
  const [movingCatId, setMovingCatId] = useState(null);
  const [movingParentId, setMovingParentId] = useState(null);
  const [mergingCatId, setMergingCatId] = useState(null);
  const [mergeTargetId, setMergeTargetId] = useState(null);
  const [categoryActionLoading, setCategoryActionLoading] = useState(false);

  const [errorMsg, setErrorMsg] = useState('');

  const load = useCallback(async () => {
    setErrorMsg('');
    await loadWithCache(
      'cache:categories:include_hidden',
      async () => {
        const data = await api.get('/categories?include_hidden=1');
        const suggestions = data.pending_suggestions_count > 0
          ? await api.get('/categories/suggestions')
          : [];
        return { data, suggestions };
      },
      ({ data, suggestions: s }) => {
        setCategories(data.categories || []);
        setPendingCount(data.pending_suggestions_count || 0);
        setSuggestions(s);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  const reloadAfterMutation = useCallback(async () => {
    await invalidateCacheByPrefix('cache:categories');
    await reloadAfterMutation();
  }, [reloadAfterMutation]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setSnoozedSuggestionIds(prev => prev.filter(id => suggestions.some(s => s.id === id)));
  }, [suggestions]);

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
      reloadAfterMutation();
    } catch (e) {
      setErrorMsg(e.message || 'Something went wrong');
    } finally {
      setAddingCat(false);
    }
  }

  function startEditing(cat) {
    setMovingCatId(null);
    setMergingCatId(null);
    setEditingCatId(cat.id);
    setEditingCatName(cat.name);
    // Only track parent for leaf categories
    setEditingParentId(cat.parent_id ? cat.parent_id : undefined);
  }

  function startMoving(cat) {
    setEditingCatId(null);
    setMergingCatId(null);
    setMovingCatId(cat.id);
    setMovingParentId(cat.parent_id || null);
  }

  function startMerging(cat) {
    setEditingCatId(null);
    setMovingCatId(null);
    setMergingCatId(cat.id);
    setMergeTargetId(null);
  }

  async function saveCategory(id) {
    if (!editingCatName.trim()) return;
    setErrorMsg('');
    try {
      const body = { name: editingCatName.trim() };
      if (editingParentId !== undefined) body.parent_id = editingParentId;
      await api.patch(`/categories/${id}`, body);
      setEditingCatId(null);
      reloadAfterMutation();
    } catch (e) {
      setErrorMsg(e.message || 'Something went wrong');
    }
  }

  async function deleteCategory(cat) {
    const action = cat.is_default ? 'Hide' : 'Delete';
    const message = cat.is_default
      ? `Hide "${cat.name}" for your household? Existing expenses will keep it, and you can restore it later.`
      : `Delete "${cat.name}"? Expenses will keep this category. Child categories will be moved to Ungrouped.`;
    Alert.alert(
      `${action} category`,
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action, style: cat.is_default ? 'default' : 'destructive', onPress: async () => {
            setErrorMsg('');
            try { await api.delete(`/categories/${cat.id}`); reloadAfterMutation(); }
            catch (e) { setErrorMsg(e.message || 'Something went wrong'); }
          },
        },
      ]
    );
  }

  async function restoreCategory(id) {
    setErrorMsg('');
    try {
      await api.post(`/categories/${id}/restore`, {});
      reloadAfterMutation();
    } catch (e) {
      setErrorMsg(e.message || 'Something went wrong');
    }
  }

  async function saveMove(id) {
    setCategoryActionLoading(true);
    setErrorMsg('');
    try {
      await api.patch(`/categories/${id}`, { parent_id: movingParentId });
      setMovingCatId(null);
      setMovingParentId(null);
      reloadAfterMutation();
    } catch (e) {
      setErrorMsg(e.message || 'Something went wrong');
    } finally {
      setCategoryActionLoading(false);
    }
  }

  async function mergeCategory(id) {
    if (!mergeTargetId) return;
    setCategoryActionLoading(true);
    setErrorMsg('');
    try {
      await api.post(`/categories/${id}/merge`, { target_category_id: mergeTargetId });
      setMergingCatId(null);
      setMergeTargetId(null);
      reloadAfterMutation();
    } catch (e) {
      setErrorMsg(e.message || 'Something went wrong');
    } finally {
      setCategoryActionLoading(false);
    }
  }

  async function acceptSuggestion(id) {
    setErrorMsg('');
    try {
      await api.post(`/categories/suggestions/${id}/accept`);
      reloadAfterMutation();
    } catch (e) { setErrorMsg(e.message || 'Something went wrong'); }
  }

  async function rejectSuggestion(id) {
    setErrorMsg('');
    try {
      await api.post(`/categories/suggestions/${id}/reject`);
      reloadAfterMutation();
    } catch (e) { setErrorMsg(e.message || 'Something went wrong'); }
  }

  function snoozeSuggestion(id) {
    setSnoozedSuggestionIds(prev => prev.includes(id) ? prev : [...prev, id]);
  }

  const custom = categories.filter(c => c.household_id !== null);
  const defaults = categories.filter(c => c.household_id === null && !c.hidden);
  const hiddenDefaults = categories.filter(c => c.household_id === null && c.hidden);
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
  const visibleSuggestions = suggestions.filter(s => !snoozedSuggestionIds.includes(s.id));
  const renamedDefaultCount = defaults.filter(c => c.is_default && c.base_name && c.base_name !== c.name).length;

  function renderCategoryTags(cat) {
    return (
      <>
        {cat.is_default ? <Text style={styles.defaultTag}>Default</Text> : <Text style={styles.customTag}>Custom</Text>}
        {cat.is_default && cat.base_name && cat.base_name !== cat.name ? (
          <Text style={styles.overrideTag}>Household rename</Text>
        ) : null}
      </>
    );
  }

  function renderDeleteAction(cat) {
    return (
      <TouchableOpacity
        style={styles.deleteSwipe}
        onPress={() => deleteCategory(cat)}
      >
        <Ionicons name={cat.is_default ? 'eye-off-outline' : 'trash-outline'} size={16} color="#fff" />
        <Text style={styles.deleteSwipeText}>{cat.is_default ? 'Hide' : 'Delete'}</Text>
      </TouchableOpacity>
    );
  }

  function renderCatRow(cat, indented = false) {
    const isEditing = editingCatId === cat.id;
    const isMoving = movingCatId === cat.id;
    const isMerging = mergingCatId === cat.id;
    const isLeaf = !!cat.parent_id;
    const mergeTargets = custom.filter(c => c.id !== cat.id);
    const moveTargets = parentOptions.filter(p => p.id !== cat.id);
    const canWorkflow = cat.household_id !== null;

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
              {isLeaf && parentOptions.length > 0 && cat.household_id !== null && (
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
            <View style={styles.catLabelWrap}>
              <Text style={styles.catName}>{cat.name}</Text>
              {renderCategoryTags(cat)}
            </View>
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
              <>
                <TouchableOpacity onPress={() => startEditing(cat)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="pencil-outline" size={16} color="#555" />
                </TouchableOpacity>
                {canWorkflow && (
                  <>
                    <TouchableOpacity onPress={() => startMoving(cat)}>
                      <Text style={styles.rowActionText}>Move</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => startMerging(cat)}>
                      <Text style={styles.rowActionText}>Merge</Text>
                    </TouchableOpacity>
                  </>
                )}
              </>
            )}
          </View>
        </View>
        {isMoving && (
          <View style={styles.workflowBlock}>
            <Text style={styles.workflowLabel}>Move under</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.editParentPicker}>
              <View style={styles.editParentRow}>
                <TouchableOpacity
                  style={[styles.parentChip, movingParentId === null && styles.parentChipActive]}
                  onPress={() => setMovingParentId(null)}
                >
                  <Text style={[styles.parentChipText, movingParentId === null && styles.parentChipTextActive]}>
                    Ungrouped
                  </Text>
                </TouchableOpacity>
                {moveTargets.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.parentChip, movingParentId === p.id && styles.parentChipActive]}
                    onPress={() => setMovingParentId(p.id)}
                  >
                    <Text style={[styles.parentChipText, movingParentId === p.id && styles.parentChipTextActive]}>
                      {p.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <View style={styles.workflowActions}>
              <TouchableOpacity onPress={() => saveMove(cat.id)} disabled={categoryActionLoading}>
                <Text style={styles.saveText}>{categoryActionLoading ? 'Saving...' : 'Save move'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setMovingCatId(null); setMovingParentId(null); }}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {isMerging && (
          <View style={styles.workflowBlock}>
            <Text style={styles.workflowLabel}>Merge into</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.editParentPicker}>
              <View style={styles.editParentRow}>
                {mergeTargets.map(target => (
                  <TouchableOpacity
                    key={target.id}
                    style={[styles.parentChip, mergeTargetId === target.id && styles.parentChipActive]}
                    onPress={() => setMergeTargetId(target.id)}
                  >
                    <Text style={[styles.parentChipText, mergeTargetId === target.id && styles.parentChipTextActive]}>
                      {target.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <Text style={styles.workflowHint}>Past expenses and merchant memory will move to the selected category.</Text>
            <View style={styles.workflowActions}>
              <TouchableOpacity onPress={() => mergeCategory(cat.id)} disabled={!mergeTargetId || categoryActionLoading}>
                <Text style={[styles.saveText, (!mergeTargetId || categoryActionLoading) && styles.disabledActionText]}>
                  {categoryActionLoading ? 'Merging...' : 'Merge'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setMergingCatId(null); setMergeTargetId(null); }}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Swipeable>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Category Details' }} />
      <DismissKeyboardScrollView style={styles.container} contentContainerStyle={styles.content}>
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
            {visibleSuggestions.length > 0 && (
              <View style={styles.suggestCard}>
                <View style={styles.suggestHeader}>
                  <Text style={styles.suggestTitle}>Suggested groupings</Text>
                  <Text style={styles.suggestCount}>{visibleSuggestions.length} to review</Text>
                </View>
                {visibleSuggestions.map(s => (
                  <View key={s.id} style={styles.suggestRow}>
                    <View style={styles.suggestBody}>
                      <Text style={styles.suggestLabel}>
                        {s.leaf.name} → {s.suggested_parent.name}
                      </Text>
                      <Text style={styles.suggestMeta}>
                        {s.expense_count > 0 ? `${s.expense_count} categorized expense${s.expense_count === 1 ? '' : 's'}` : 'No confirmed expenses yet'}
                      </Text>
                      {s.sample_merchants?.length > 0 ? (
                        <Text style={styles.suggestExamples}>
                          Examples: {s.sample_merchants.join(', ')}
                        </Text>
                      ) : null}
                    </View>
                    <View style={styles.suggestActions}>
                      <TouchableOpacity onPress={() => acceptSuggestion(s.id)}>
                        <Text style={styles.acceptText}>Accept</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => snoozeSuggestion(s.id)}>
                        <Text style={styles.laterText}>Later</Text>
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
                    <View style={styles.catLabelWrap}>
                      <Text style={styles.parentLabel}>{parent.name}</Text>
                      {renderCategoryTags(parent)}
                    </View>
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
            <Text style={styles.defaultsNote}>
              Built-in categories shared across all households. Rename changes only your household label, and Hide removes it from your picker without changing old expenses.
            </Text>
            {(renamedDefaultCount > 0 || hiddenDefaults.length > 0) && (
              <View style={styles.defaultsSummaryCard}>
                <Text style={styles.defaultsSummaryTitle}>Household overrides</Text>
                <Text style={styles.defaultsSummaryText}>
                  {renamedDefaultCount > 0
                    ? `${renamedDefaultCount} renamed`
                    : 'No renamed defaults yet'}
                  {hiddenDefaults.length > 0 ? ` · ${hiddenDefaults.length} hidden` : ''}
                </Text>
              </View>
            )}
            {defaults.map(cat => renderCatRow(cat))}

            {hiddenDefaults.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { marginTop: 24 }]}>HIDDEN DEFAULTS</Text>
                <Text style={styles.hiddenDefaultsNote}>Restore any built-in category you want back in your household list.</Text>
                {hiddenDefaults.map(cat => (
                  <View key={cat.id} style={styles.row}>
                    <View style={styles.catLabelWrap}>
                      <Text style={styles.catName}>{cat.name}</Text>
                      <Text style={styles.defaultTag}>Default</Text>
                      <Text style={styles.hiddenTag}>Hidden</Text>
                    </View>
                    <TouchableOpacity onPress={() => restoreCategory(cat.id)}>
                      <Text style={styles.rowActionText}>Restore</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            )}
          </>
        )}
      </DismissKeyboardScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 48 },

  sectionLabel: { fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 },
  empty: { color: '#888', fontSize: 15, marginBottom: 12 },
  defaultsNote: { color: '#888', fontSize: 14, marginBottom: 10 },
  hiddenDefaultsNote: { color: '#777', fontSize: 13, marginBottom: 8 },
  defaultsSummaryCard: {
    backgroundColor: '#111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1d1d1d',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  defaultsSummaryTitle: { color: '#d4d4d4', fontSize: 13, fontWeight: '600', marginBottom: 2 },
  defaultsSummaryText: { color: '#767676', fontSize: 13 },

  // Add section
  addSection: { marginBottom: 28 },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  typeBtn: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8,
    backgroundColor: '#111', borderWidth: 1, borderColor: '#222',
  },
  typeBtnActive: { backgroundColor: '#f5f5f5', borderColor: '#f5f5f5' },
  typeBtnDisabled: { opacity: 0.3 },
  typeBtnText: { fontSize: 14, color: '#999' },
  typeBtnTextActive: { color: '#000', fontWeight: '600' },
  typeBtnTextDisabled: { color: '#888' },
  parentPicker: { marginBottom: 10 },
  parentPickerRow: { flexDirection: 'row', gap: 8 },
  addRow: { flexDirection: 'row', gap: 10 },
  addBtn: { backgroundColor: '#f5f5f5', borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' },
  addBtnDisabled: { opacity: 0.3 },
  addBtnText: { color: '#000', fontWeight: '600', fontSize: 14 },
  errorMsg: { color: '#ef4444', fontSize: 14, marginTop: 10 },

  // Suggestions
  suggestCard: { backgroundColor: '#111', borderRadius: 10, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: '#2a2a1a' },
  suggestHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  suggestTitle: { fontSize: 12, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '600' },
  suggestCount: { fontSize: 13, color: '#777' },
  suggestRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  suggestBody: { marginBottom: 10 },
  suggestLabel: { color: '#ccc', fontSize: 15, fontWeight: '500' },
  suggestMeta: { color: '#9a9a9a', fontSize: 13, marginTop: 4 },
  suggestExamples: { color: '#777', fontSize: 13, marginTop: 4 },
  suggestActions: { flexDirection: 'row', gap: 14 },
  acceptText: { color: '#4ade80', fontSize: 14, fontWeight: '600' },
  laterText: { color: '#aaa', fontSize: 14 },
  rejectText: { color: '#999', fontSize: 14 },

  // Category rows
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingRight: 12, borderBottomWidth: 1, borderBottomColor: '#111', backgroundColor: '#0a0a0a' },
  rowIndented: { paddingLeft: 16 },
  catLabelWrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, flex: 1, marginRight: 8 },
  catName: { flex: 1, fontSize: 15, color: '#f5f5f5' },
  defaultTag: { color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  customTag: { color: '#555', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  overrideTag: { color: '#8f8f8f', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  hiddenTag: { color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  actions: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  rowActionText: { color: '#777', fontSize: 13 },
  saveText: { color: '#4ade80', fontSize: 14, fontWeight: '600' },
  cancelText: { color: '#999', fontSize: 14 },
  disabledActionText: { opacity: 0.4 },

  // Edit mode within row
  editBlock: { flex: 1, marginRight: 12 },
  editInput: { backgroundColor: '#111', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, color: '#f5f5f5', fontSize: 15, borderWidth: 1, borderColor: '#1f1f1f' },
  editParentPicker: { marginTop: 8 },
  editParentRow: { flexDirection: 'row', gap: 6 },
  workflowBlock: { paddingLeft: 16, paddingRight: 12, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#111' },
  workflowLabel: { color: '#888', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 },
  workflowHint: { color: '#666', fontSize: 13, marginTop: 8 },
  workflowActions: { flexDirection: 'row', gap: 14, alignItems: 'center', marginTop: 10 },

  // Parent chips (shared)
  parentChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: '#111', borderWidth: 1, borderColor: '#222', marginRight: 2 },
  parentChipActive: { backgroundColor: '#f5f5f5', borderColor: '#f5f5f5' },
  parentChipText: { fontSize: 14, color: '#999' },
  parentChipTextActive: { color: '#000', fontWeight: '600' },

  // Parent category header
  parentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  parentLabel: { flex: 1, fontSize: 13, color: '#aaa', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  ungroupedSection: { marginTop: 12 },
  ungroupedLabel: { fontSize: 12, color: '#777', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },

  // Swipe delete
  deleteSwipe: { backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center', width: 72, borderBottomWidth: 1, borderBottomColor: '#111', gap: 3 },
  deleteSwipeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
