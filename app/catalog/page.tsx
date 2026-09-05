'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Edit, Plus, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { Badge, Button, Card, EmptyState, LoadingState } from '@/components/ui/core';
import { PageHeader } from '@/components/PageHeader';
import { MobileQuickActionMenu } from '@/components/MobileQuickActionMenu';
import { ModalHeader } from '@/components/ModalCloseButton';
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { IconActionButton } from '@/components/IconActionButton';
import { MoneyInput } from '@/components/MoneyInput';
import { TablePagination } from '@/components/TablePagination';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { canManageCatalogItems } from '@/lib/permissions';
import { catalogItemMatchesFilters, type CatalogItemStatusFilter, type CatalogItemTypeFilter } from '@/lib/catalog-items';
import { formatCurrency } from '@/lib/formatting';
import {
  archiveCatalogItem,
  createCatalogItem,
  listCatalogItemsPage,
  restoreCatalogItem,
  updateCatalogItem,
} from '@/lib/repositories/catalogItems';
import {
  createCatalogCategory,
  listCatalogCategories,
  updateCatalogCategory,
} from '@/lib/repositories/catalogCategories';
import type { CatalogCategory, CatalogCategoryStatus, CatalogItem, CatalogItemInput, CatalogItemStatus, CatalogItemType } from '@/types';
import type { FirestoreCursor } from '@/lib/repositories/pagination';
import { userFacingErrorMessage } from '@/lib/repositories/pagination';

type CatalogSection = 'items' | 'categories';
type ConfirmAction = { kind: 'archive' | 'restore'; item: CatalogItem };
type CatalogItemForm = {
  type: CatalogItemType;
  name: string;
  code: string;
  categoryId: string;
  category: string;
  unit: string;
  description: string;
  regularPrice: number;
  salePrice: number | null;
  status: CatalogItemStatus;
};
type CatalogCategoryForm = {
  type: CatalogItemType;
  name: string;
  status: CatalogCategoryStatus;
};

const emptyItemForm: CatalogItemForm = {
  type: 'PRODUCT',
  name: '',
  code: '',
  categoryId: '',
  category: '',
  unit: '',
  description: '',
  regularPrice: 0,
  salePrice: null,
  status: 'ACTIVE',
};

const emptyCategoryForm: CatalogCategoryForm = {
  type: 'PRODUCT',
  name: '',
  status: 'ACTIVE',
};

function formFromItem(item: CatalogItem): CatalogItemForm {
  return {
    type: item.type,
    name: item.name,
    code: item.code || '',
    categoryId: item.categoryId || '',
    category: item.category || '',
    unit: item.unit || '',
    description: item.description || '',
    regularPrice: item.regularPrice,
    salePrice: item.salePrice ?? null,
    status: item.status,
  };
}

function itemTypeLabel(type: CatalogItemType) {
  return type === 'PRODUCT' ? 'Product' : 'Service';
}

export default function CatalogPage() {
  const { user } = useAuth();
  const { settings } = useApp();
  const { currentOrganizationId, ready: workspaceReady, membership, canWrite } = useWorkspace();
  const canManage = canManageCatalogItems(membership) && canWrite;
  const [activeSection, setActiveSection] = useState<CatalogSection>('items');
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<FirestoreCursor>(null);
  const [hasMore, setHasMore] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<CatalogItemTypeFilter>('All');
  const [statusFilter, setStatusFilter] = useState<CatalogItemStatusFilter>('ACTIVE');
  const [categoryTypeFilter, setCategoryTypeFilter] = useState<CatalogItemTypeFilter>('All');
  const [categoryStatusFilter, setCategoryStatusFilter] = useState<CatalogItemStatusFilter>('All');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [showItemModal, setShowItemModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [editingCategory, setEditingCategory] = useState<CatalogCategory | null>(null);
  const [itemForm, setItemForm] = useState<CatalogItemForm>(emptyItemForm);
  const [categoryForm, setCategoryForm] = useState<CatalogCategoryForm>(emptyCategoryForm);
  const [savingItem, setSavingItem] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [categoryModalError, setCategoryModalError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [returnToItemForm, setReturnToItemForm] = useState(false);
  const requestRef = useRef(0);

  const refreshItems = useCallback(async () => {
    if (!user || !workspaceReady || !currentOrganizationId) return;
    const requestId = ++requestRef.current;
    setItemsLoading(true);
    setItemsError(null);
    setActionError(null);
    setItems([]);
    setCursor(null);
    setHasMore(false);
    try {
      const result = await listCatalogItemsPage(user, currentOrganizationId, showArchived);
      if (requestId !== requestRef.current) return;
      setItems(result.items);
      setCursor(result.nextCursor);
      setHasMore(result.hasMore);
      setPage(1);
    } catch (error) {
      if (requestId !== requestRef.current) return;
      console.error('Unable to load Catalog', error);
      setItemsError(userFacingErrorMessage(error, 'Unable to load Catalog. Please try again.'));
    } finally {
      if (requestId === requestRef.current) setItemsLoading(false);
    }
  }, [currentOrganizationId, showArchived, user, workspaceReady]);

  const refreshCategories = useCallback(async () => {
    if (!user || !workspaceReady || !currentOrganizationId) return;
    setCategoriesLoading(true);
    try {
      setCategories(await listCatalogCategories(user, currentOrganizationId));
    } catch (error) {
      console.error('Unable to load catalog categories', error);
      setActionError(userFacingErrorMessage(error, 'Unable to load categories. Please try again.'));
    } finally {
      setCategoriesLoading(false);
    }
  }, [currentOrganizationId, user, workspaceReady]);

  const loadMoreItems = useCallback(async () => {
    if (!user || !workspaceReady || !currentOrganizationId || !cursor || itemsLoading) return;
    const requestId = ++requestRef.current;
    setItemsLoading(true);
    try {
      const result = await listCatalogItemsPage(user, currentOrganizationId, showArchived, cursor);
      if (requestId !== requestRef.current) return;
      setItems((current) => [...current, ...result.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setCursor(result.nextCursor);
      setHasMore(result.hasMore);
    } catch (error) {
      if (requestId !== requestRef.current) return;
      console.error('Unable to load more Catalog items', error);
      setActionError(userFacingErrorMessage(error, 'Unable to load more items. Please try again.'));
    } finally {
      if (requestId === requestRef.current) setItemsLoading(false);
    }
  }, [currentOrganizationId, cursor, itemsLoading, showArchived, user, workspaceReady]);

  useEffect(() => { void refreshItems(); }, [refreshItems]);
  useEffect(() => { void refreshCategories(); }, [refreshCategories]);
  useEffect(() => { setPage(1); }, [searchTerm, showArchived, statusFilter, typeFilter]);

  const filteredItems = useMemo(
    () => items.filter((item) => catalogItemMatchesFilters(item, searchTerm, typeFilter, statusFilter)),
    [items, searchTerm, statusFilter, typeFilter],
  );
  const filteredCategories = useMemo(
    () => categories.filter((category) => (categoryTypeFilter === 'All' || category.type === categoryTypeFilter)
      && (categoryStatusFilter === 'All' || category.status === categoryStatusFilter)),
    [categories, categoryStatusFilter, categoryTypeFilter],
  );
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleItems = filteredItems.slice((safePage - 1) * pageSize, safePage * pageSize);
  const error = actionError || itemsError;

  const openCreateItem = () => {
    if (!canManage) return;
    setEditingItem(null);
    setItemForm(emptyItemForm);
    setActionError(null);
    setReturnToItemForm(false);
    setShowItemModal(true);
  };

  const openEditItem = (item: CatalogItem) => {
    if (!canManage) return;
    setEditingItem(item);
    setItemForm(formFromItem(item));
    setActionError(null);
    setReturnToItemForm(false);
    setShowItemModal(true);
  };

  const closeItemModal = () => {
    if (savingItem) return;
    setShowItemModal(false);
    setReturnToItemForm(false);
  };

  const handleItemSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !currentOrganizationId || !canManage || savingItem) return;
    setSavingItem(true);
    setActionError(null);
    const input: CatalogItemInput = { ...itemForm, salePrice: itemForm.salePrice ?? undefined };
    try {
      if (editingItem) await updateCatalogItem(user, currentOrganizationId, editingItem.id, input);
      else await createCatalogItem(user, currentOrganizationId, input);
      setShowItemModal(false);
      setEditingItem(null);
      setReturnToItemForm(false);
      await refreshItems();
    } catch (error) {
      console.error('Unable to save catalog item', error);
      setActionError(userFacingErrorMessage(error, 'Unable to save the item. Please try again.'));
    } finally {
      setSavingItem(false);
    }
  };

  const openAddCategory = (type: CatalogItemType = 'PRODUCT') => {
    if (!canManage) return;
    setEditingCategory(null);
    setCategoryForm({ ...emptyCategoryForm, type });
    setCategoryModalError(null);
    setShowCategoryModal(true);
  };

  const openRenameCategory = (category: CatalogCategory) => {
    if (!canManage) return;
    setEditingCategory(category);
    setCategoryForm({ type: category.type, name: category.name, status: category.status });
    setCategoryModalError(null);
    setShowCategoryModal(true);
  };

  const closeCategoryModal = () => {
    if (!savingCategory) setShowCategoryModal(false);
  };

  const handleCategorySubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !currentOrganizationId || !canManage || savingCategory) return;
    setSavingCategory(true);
    setCategoryModalError(null);
    try {
      const createdCategory = editingCategory
        ? (await updateCatalogCategory(user, currentOrganizationId, editingCategory.id, { name: categoryForm.name, status: categoryForm.status }), null)
        : await createCatalogCategory(user, currentOrganizationId, categoryForm);
      await refreshCategories();
      setShowCategoryModal(false);
      if (createdCategory && returnToItemForm) {
        if (createdCategory.type === itemForm.type) {
          setItemForm((current) => ({ ...current, categoryId: createdCategory.id, category: createdCategory.name }));
        }
        setActiveSection('items');
        setShowItemModal(true);
        setReturnToItemForm(false);
      }
    } catch (error) {
      console.error('Unable to save catalog category', error);
      setCategoryModalError(userFacingErrorMessage(error, 'Unable to save the category. Please try again.'));
    } finally {
      setSavingCategory(false);
    }
  };

  const toggleCategoryStatus = async (category: CatalogCategory) => {
    if (!user || !currentOrganizationId || !canManage || savingCategory) return;
    setSavingCategory(true);
    setActionError(null);
    try {
      await updateCatalogCategory(user, currentOrganizationId, category.id, {
        name: category.name,
        status: category.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      });
      await refreshCategories();
    } catch (error) {
      console.error('Unable to update catalog category', error);
      setActionError(userFacingErrorMessage(error, 'Unable to update the category. Please try again.'));
    } finally {
      setSavingCategory(false);
    }
  };

  const executeConfirmedAction = async () => {
    if (!confirmAction || !user || !currentOrganizationId || !canManage || confirmBusy) return;
    setConfirmBusy(true);
    setActionError(null);
    try {
      if (confirmAction.kind === 'archive') await archiveCatalogItem(user, currentOrganizationId, confirmAction.item.id);
      else await restoreCatalogItem(user, currentOrganizationId, confirmAction.item.id);
      setConfirmAction(null);
      await refreshItems();
    } catch (error) {
      console.error('Unable to update catalog item lifecycle', error);
      setActionError(userFacingErrorMessage(error, 'Unable to update the item. Please try again.'));
    } finally {
      setConfirmBusy(false);
    }
  };

  const toggleArchived = () => {
    requestRef.current += 1;
    setShowArchived((current) => !current);
    setItems([]);
    setCursor(null);
    setHasMore(false);
    setStatusFilter(showArchived ? 'ACTIVE' : 'All');
    setSearchTerm('');
    setTypeFilter('All');
    setActionError(null);
  };

  const manageCategoriesFromItemForm = () => {
    setShowItemModal(false);
    setActiveSection('categories');
    setReturnToItemForm(true);
  };

  const selectSection = (section: CatalogSection) => {
    setActiveSection(section);
    if (section === 'items' && returnToItemForm) {
      setShowItemModal(true);
      setReturnToItemForm(false);
    }
  };

  const currentActions = activeSection === 'items'
    ? <>
      <Button variant="outline" onClick={() => void refreshItems()} disabled={itemsLoading} className="gap-2"><RefreshCw size={16} /> Refresh</Button>
      <Button variant="outline" onClick={toggleArchived}>{showArchived ? 'Active Items' : 'Archived Items'}</Button>
      {canManage && <Button onClick={openCreateItem} className="gap-2"><Plus size={18} /> Add Item</Button>}
    </>
    : <>
      <Button variant="outline" onClick={() => void refreshCategories()} disabled={categoriesLoading} className="gap-2"><RefreshCw size={16} /> Refresh</Button>
      {canManage && <Button onClick={() => openAddCategory()} className="gap-2"><Plus size={18} /> Add Category</Button>}
    </>;

  const mobileQuickActions = activeSection === 'items'
    ? <MobileQuickActionMenu items={[
      { label: 'Add Item', onSelect: openCreateItem, disabled: !canManage },
      { label: showArchived ? 'Active Items' : 'Archived Items', onSelect: toggleArchived },
    ]} />
    : <MobileQuickActionMenu items={[
      { label: 'Add Category', onSelect: () => openAddCategory(), disabled: !canManage },
      { label: 'Refresh Categories', onSelect: () => void refreshCategories() },
    ]} />;

  return <div className="space-y-6">
    {error && <p className="rounded-lg bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] p-3 text-sm text-[var(--app-danger)]" role="alert">{error}</p>}
    <PageHeader title="Catalog" subtitle="Manage the products and services your business sells." actions={currentActions} mobileQuickActions={mobileQuickActions} />

    <nav className="flex min-w-0 border-b border-[var(--app-border)]" role="tablist" aria-label="Catalog sections">
      <CatalogSectionTab active={activeSection === 'items'} onClick={() => selectSection('items')}>Products &amp; Services</CatalogSectionTab>
      <CatalogSectionTab active={activeSection === 'categories'} onClick={() => selectSection('categories')}>Categories</CatalogSectionTab>
    </nav>

    {activeSection === 'items' ? <ProductsAndServicesSection
      itemsLoading={itemsLoading}
      items={items}
      filteredItems={filteredItems}
      visibleItems={visibleItems}
      settingsCurrency={settings.currency}
      searchTerm={searchTerm}
      typeFilter={typeFilter}
      statusFilter={statusFilter}
      showArchived={showArchived}
      page={safePage}
      pageSize={pageSize}
      hasMore={hasMore}
      canManage={canManage}
      onSearchChange={setSearchTerm}
      onTypeFilterChange={setTypeFilter}
      onStatusFilterChange={setStatusFilter}
      onOpenCreate={openCreateItem}
      onOpenEdit={openEditItem}
      onArchive={(item) => setConfirmAction({ kind: 'archive', item })}
      onRestore={(item) => setConfirmAction({ kind: 'restore', item })}
      onPageChange={setPage}
      onPageSizeChange={(nextPageSize) => { setPageSize(nextPageSize); setPage(1); }}
      onLoadMore={() => void loadMoreItems()}
    /> : <CategoriesSection
      categories={filteredCategories}
      allCategoryCount={categories.length}
      loading={categoriesLoading}
      typeFilter={categoryTypeFilter}
      statusFilter={categoryStatusFilter}
      canManage={canManage}
      saving={savingCategory}
      onTypeFilterChange={setCategoryTypeFilter}
      onStatusFilterChange={setCategoryStatusFilter}
      onAddCategory={() => openAddCategory()}
      onRenameCategory={openRenameCategory}
      onToggleStatus={(category) => void toggleCategoryStatus(category)}
    />}

    {confirmAction && <ConfirmActionDialog
      open
      title={`${confirmAction.kind === 'archive' ? 'Archive' : 'Restore'} “${confirmAction.item.name}”?`}
      description={confirmAction.kind === 'archive'
        ? 'This item will be hidden from the normal Catalog view and can be restored later.'
        : 'This item will return to the Catalog view with its current Active or Inactive status.'}
      confirmLabel={confirmAction.kind === 'archive' ? 'Archive' : 'Restore'}
      variant={confirmAction.kind === 'archive' ? 'warning' : 'default'}
      loading={confirmBusy}
      onCancel={() => setConfirmAction(null)}
      onConfirm={() => void executeConfirmedAction()}
    />}

    {showItemModal && <div className="app-modal fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-3 sm:p-4" role="dialog" aria-modal="true" aria-label="Catalog item form">
      <form onSubmit={handleItemSubmit} className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:max-h-[calc(100dvh-2rem)] sm:p-6">
        <ModalHeader title={editingItem ? 'Edit Item' : 'Add Item'} subtitle="Add a product or service to your business catalog." onClose={closeItemModal} />
        <CatalogItemFields form={itemForm} setForm={setItemForm} currency={settings.currency} categories={categories} onManageCategories={manageCategoriesFromItemForm} />
        {actionError && <p className="rounded-lg bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] p-3 text-sm text-[var(--app-danger)]" role="alert">{actionError}</p>}
        <div className="app-modal-footer"><Button type="button" variant="outline" onClick={closeItemModal} disabled={savingItem}>Cancel</Button><Button type="submit" disabled={savingItem}>{savingItem ? 'Saving…' : editingItem ? 'Update Item' : 'Save Item'}</Button></div>
      </form>
    </div>}

    {showCategoryModal && <CategoryFormModal form={categoryForm} editingCategory={editingCategory} saving={savingCategory} error={categoryModalError} setForm={setCategoryForm} onClose={closeCategoryModal} onSubmit={handleCategorySubmit} />}
  </div>;
}

function CatalogSectionTab({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button type="button" role="tab" aria-selected={active} className={`shrink-0 border-b-2 px-3 py-3 text-sm font-semibold transition-colors sm:px-4 ${active ? 'border-[var(--app-primary)] text-[var(--app-primary)]' : 'border-transparent text-[var(--app-muted)] hover:text-[var(--app-text)]'}`} onClick={onClick}>{children}</button>;
}

function ProductsAndServicesSection({
  itemsLoading, items, filteredItems, visibleItems, settingsCurrency, searchTerm, typeFilter, statusFilter, showArchived, page, pageSize, hasMore, canManage,
  onSearchChange, onTypeFilterChange, onStatusFilterChange, onOpenCreate, onOpenEdit, onArchive, onRestore, onPageChange, onPageSizeChange, onLoadMore,
}: {
  itemsLoading: boolean;
  items: CatalogItem[];
  filteredItems: CatalogItem[];
  visibleItems: CatalogItem[];
  settingsCurrency: string;
  searchTerm: string;
  typeFilter: CatalogItemTypeFilter;
  statusFilter: CatalogItemStatusFilter;
  showArchived: boolean;
  page: number;
  pageSize: number;
  hasMore: boolean;
  canManage: boolean;
  onSearchChange: (value: string) => void;
  onTypeFilterChange: (value: CatalogItemTypeFilter) => void;
  onStatusFilterChange: (value: CatalogItemStatusFilter) => void;
  onOpenCreate: () => void;
  onOpenEdit: (item: CatalogItem) => void;
  onArchive: (item: CatalogItem) => void;
  onRestore: (item: CatalogItem) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onLoadMore: () => void;
}) {
  return <section aria-labelledby="products-services-heading" className="space-y-4">
    <h2 id="products-services-heading" className="sr-only">Products &amp; Services</h2>
    <Card className="p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search products and services</span>
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-tertiary)]" aria-hidden="true" />
          <input className="w-full !pl-10" placeholder="Search name, code, or category" value={searchTerm} onChange={(event) => onSearchChange(event.target.value)} />
        </label>
        <label className="min-w-0 text-sm text-[var(--app-muted)]"><span className="sr-only">Filter by type</span><select className="w-full sm:w-40" aria-label="Filter by type" value={typeFilter} onChange={(event) => onTypeFilterChange(event.target.value as CatalogItemTypeFilter)}><option value="All">All types</option><option value="PRODUCT">Products</option><option value="SERVICE">Services</option></select></label>
        <label className="min-w-0 text-sm text-[var(--app-muted)]"><span className="sr-only">Filter by status</span><select className="w-full sm:w-40" aria-label="Filter by status" value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value as CatalogItemStatusFilter)}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="All">All statuses</option></select></label>
      </div>
    </Card>

    {itemsLoading && items.length === 0 ? <LoadingState label="Loading Catalog…" /> : filteredItems.length === 0 ? <Card className="p-0"><EmptyState
      title={items.length === 0 ? (showArchived ? 'No archived catalog items.' : 'No catalog items yet.') : 'No matching catalog items.'}
      description={items.length === 0 && !showArchived ? 'Add the products or services your business sells to start building your catalog.' : undefined}
      action={items.length === 0 && !showArchived && canManage ? <Button onClick={onOpenCreate} className="gap-2"><Plus size={16} /> Add Item</Button> : undefined}
    /></Card> : <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[940px] text-left">
          <thead><tr className="border-b border-[var(--app-border)]"><th>Name</th><th>Type</th><th>Category</th><th>Code / SKU</th><th>Unit</th><th>Regular Price</th><th>Sale Price</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
          <tbody className="divide-y divide-[var(--app-border-subtle)]">
            {visibleItems.map((item) => <tr key={item.id} className="hover:bg-[var(--app-surface-subtle)]">
              <td><div className="font-semibold text-[var(--app-text)]">{item.name}</div>{item.description && <div className="max-w-[240px] truncate text-xs text-[var(--app-muted)]">{item.description}</div>}</td>
              <td><Badge variant={item.type === 'PRODUCT' ? 'blue' : 'purple'}>{itemTypeLabel(item.type)}</Badge></td>
              <td className="text-sm text-[var(--app-muted)]">{item.category || '—'}</td>
              <td className="text-sm text-[var(--app-muted)]">{item.code || '—'}</td>
              <td className="text-sm text-[var(--app-muted)]">{item.unit || '—'}</td>
              <td className="whitespace-nowrap font-medium text-[var(--app-text)]">{formatCurrency(item.regularPrice, settingsCurrency)}</td>
              <td className="whitespace-nowrap font-medium text-[var(--app-text)]">{item.salePrice == null ? '—' : formatCurrency(item.salePrice, settingsCurrency)}</td>
              <td><Badge variant={item.archived ? 'gray' : item.status === 'ACTIVE' ? 'green' : 'orange'}>{item.archived ? 'Archived' : item.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge></td>
              <td><div className="flex justify-end gap-1">
                {canManage && <IconActionButton icon={<Edit size={15} />} label={`Edit ${item.name}`} onClick={() => onOpenEdit(item)} />}
                {canManage && !item.archived && <IconActionButton icon={<Archive size={15} />} label={`Archive ${item.name}`} variant="danger" onClick={() => onArchive(item)} />}
                {canManage && item.archived && <IconActionButton icon={<RotateCcw size={15} />} label={`Restore ${item.name}`} variant="success" onClick={() => onRestore(item)} />}
              </div></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <TablePagination page={page} pageSize={pageSize} totalCount={filteredItems.length} hasMore={hasMore} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
    </Card>}
    {hasMore && <div className="flex justify-center"><Button variant="outline" onClick={onLoadMore} disabled={itemsLoading}>{itemsLoading ? 'Loading…' : 'Load More Items'}</Button></div>}
  </section>;
}

function CategoriesSection({ categories, allCategoryCount, loading, typeFilter, statusFilter, canManage, saving, onTypeFilterChange, onStatusFilterChange, onAddCategory, onRenameCategory, onToggleStatus }: {
  categories: CatalogCategory[];
  allCategoryCount: number;
  loading: boolean;
  typeFilter: CatalogItemTypeFilter;
  statusFilter: CatalogItemStatusFilter;
  canManage: boolean;
  saving: boolean;
  onTypeFilterChange: (value: CatalogItemTypeFilter) => void;
  onStatusFilterChange: (value: CatalogItemStatusFilter) => void;
  onAddCategory: () => void;
  onRenameCategory: (category: CatalogCategory) => void;
  onToggleStatus: (category: CatalogCategory) => void;
}) {
  return <section aria-labelledby="categories-heading" className="space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><h2 id="categories-heading" className="text-xl font-bold text-[var(--app-text)]">Categories</h2><p className="mt-1 text-sm text-[var(--app-muted)]">Organize the products and services in your catalog.</p></div>
      {canManage && <Button onClick={onAddCategory} className="gap-2 self-start"><Plus size={16} /> Add Category</Button>}
    </div>
    <Card className="p-3 sm:p-4"><div className="flex flex-col gap-3 sm:flex-row sm:justify-end"><label className="min-w-0 text-sm text-[var(--app-muted)]"><span className="sr-only">Filter categories by type</span><select className="w-full sm:w-40" aria-label="Filter categories by type" value={typeFilter} onChange={(event) => onTypeFilterChange(event.target.value as CatalogItemTypeFilter)}><option value="All">All types</option><option value="PRODUCT">Products</option><option value="SERVICE">Services</option></select></label><label className="min-w-0 text-sm text-[var(--app-muted)]"><span className="sr-only">Filter categories by status</span><select className="w-full sm:w-40" aria-label="Filter categories by status" value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value as CatalogItemStatusFilter)}><option value="All">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label></div></Card>
    {loading ? <LoadingState label="Loading categories…" /> : categories.length === 0 ? <Card className="p-0"><EmptyState title={allCategoryCount === 0 ? 'No categories yet.' : 'No matching categories.'} description={allCategoryCount === 0 ? 'Create reusable Product and Service categories for your catalog.' : undefined} action={allCategoryCount === 0 && canManage ? <Button onClick={onAddCategory} className="gap-2"><Plus size={16} /> Add Category</Button> : undefined} /></Card> : <Card className="overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left"><thead><tr className="border-b border-[var(--app-border)]"><th>Category Name</th><th>Type</th><th>Status</th><th className="text-right">Actions</th></tr></thead><tbody className="divide-y divide-[var(--app-border-subtle)]">{categories.map((category) => <tr key={category.id} className="hover:bg-[var(--app-surface-subtle)]"><td className="font-semibold text-[var(--app-text)]">{category.name}</td><td><Badge variant={category.type === 'PRODUCT' ? 'blue' : 'purple'}>{itemTypeLabel(category.type)}</Badge></td><td><Badge variant={category.status === 'ACTIVE' ? 'green' : 'orange'}>{category.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge></td><td><div className="flex justify-end gap-2">{canManage && <Button type="button" size="sm" variant="outline" onClick={() => onRenameCategory(category)} disabled={saving}>Rename</Button>}{canManage && <Button type="button" size="sm" variant="outline" onClick={() => onToggleStatus(category)} disabled={saving}>{category.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}</Button>}</div></td></tr>)}</tbody></table></div></Card>}
  </section>;
}

function CatalogItemFields({ form, setForm, currency, categories, onManageCategories }: {
  form: CatalogItemForm;
  setForm: React.Dispatch<React.SetStateAction<CatalogItemForm>>;
  currency: string;
  categories: CatalogCategory[];
  onManageCategories: () => void;
}) {
  const update = (values: Partial<CatalogItemForm>) => setForm((current) => ({ ...current, ...values }));
  const activeCategories = categories.filter((category) => category.type === form.type && category.status === 'ACTIVE');
  const selectedCategory = categories.find((category) => category.id === form.categoryId);
  const categoryOptions = selectedCategory && selectedCategory.status === 'INACTIVE' ? [selectedCategory, ...activeCategories] : activeCategories;
  const codeLabel = form.type === 'PRODUCT' ? 'Code / SKU' : 'Code';

  return <>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase text-[var(--app-muted)]" htmlFor="catalog-type">Type <span className="text-[var(--app-danger)]">*</span></label>
        <select id="catalog-type" required className="w-full" value={form.type} onChange={(event) => update({ type: event.target.value as CatalogItemType, categoryId: '', category: '' })}><option value="PRODUCT">Product</option><option value="SERVICE">Service</option></select>
      </div>
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase text-[var(--app-muted)]" htmlFor="catalog-status">Status</label>
        <select id="catalog-status" className="w-full" value={form.status} onChange={(event) => update({ status: event.target.value as CatalogItemStatus })}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>
      </div>
    </div>

    <div className="space-y-2">
      <label className="text-xs font-bold uppercase text-[var(--app-muted)]" htmlFor="catalog-category">Category</label>
      <select id="catalog-category" className="w-full" value={form.categoryId} onChange={(event) => { const category = categories.find((item) => item.id === event.target.value); update({ categoryId: category?.id || '', category: category?.name || '' }); }}><option value="">No category</option>{categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.name}{category.status === 'INACTIVE' ? ' (Inactive)' : ''}</option>)}</select>
      {activeCategories.length === 0 && <p className="pt-1 text-xs text-[var(--app-muted)]">No {itemTypeLabel(form.type)} categories available. <button type="button" className="font-semibold text-[var(--app-secondary)] hover:underline" onClick={onManageCategories}>Manage Categories</button></p>}
    </div>

    <div className="space-y-2">
      <label className="text-xs font-bold uppercase text-[var(--app-muted)]" htmlFor="catalog-name">Name <span className="text-[var(--app-danger)]">*</span></label>
      <input id="catalog-name" required className="w-full" value={form.name} onChange={(event) => update({ name: event.target.value })} placeholder="e.g. Website Development" />
    </div>

    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase text-[var(--app-muted)]" htmlFor="catalog-code">{codeLabel}</label>
        <input id="catalog-code" className="w-full" value={form.code} onChange={(event) => update({ code: event.target.value })} placeholder={form.type === 'PRODUCT' ? 'e.g. BAG-450' : 'e.g. WEB-001'} />
      </div>
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase text-[var(--app-muted)]" htmlFor="catalog-unit">Unit</label>
        <input id="catalog-unit" className="w-full" value={form.unit} onChange={(event) => update({ unit: event.target.value })} placeholder="e.g. hour, pc, session" />
      </div>
    </div>

    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase text-[var(--app-muted)]" htmlFor="catalog-regular-price">Regular Price <span className="text-[var(--app-danger)]">*</span></label>
        <MoneyInput id="catalog-regular-price" required aria-label="Regular Price" value={form.regularPrice} currency={currency} onChange={(value) => update({ regularPrice: value })} className="w-full" />
      </div>
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase text-[var(--app-muted)]" htmlFor="catalog-sale-price">Sale Price <span className="font-normal normal-case">(optional)</span></label>
        <MoneyInput id="catalog-sale-price" allowEmpty aria-label="Sale Price" value={form.salePrice} currency={currency} onChange={(value) => update({ salePrice: value })} className="w-full" />
      </div>
    </div>

    <div className="space-y-2">
      <label className="text-xs font-bold uppercase text-[var(--app-muted)]" htmlFor="catalog-description">Description</label>
      <textarea id="catalog-description" className="w-full" rows={3} value={form.description} onChange={(event) => update({ description: event.target.value })} placeholder="Optional details your team should know." />
    </div>
  </>;
}

function CategoryFormModal({ form, editingCategory, saving, error, setForm, onClose, onSubmit }: {
  form: CatalogCategoryForm;
  editingCategory: CatalogCategory | null;
  saving: boolean;
  error: string | null;
  setForm: React.Dispatch<React.SetStateAction<CatalogCategoryForm>>;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const isRename = Boolean(editingCategory);
  return <div className="app-modal fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-3 sm:p-4" role="dialog" aria-modal="true" aria-label={isRename ? 'Rename category' : 'Add category'}><form onSubmit={onSubmit} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-4 shadow-xl sm:p-6"><ModalHeader title={isRename ? 'Rename Category' : 'Add Category'} subtitle={isRename ? 'Category type remains fixed after creation.' : 'Create a reusable Product or Service category.'} onClose={onClose} /><div className="space-y-2"><label className="text-xs font-bold uppercase text-[var(--app-muted)]" htmlFor="category-type">Category Type <span className="text-[var(--app-danger)]">*</span></label><select id="category-type" required disabled={isRename} className="w-full" value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as CatalogItemType }))}><option value="PRODUCT">Product</option><option value="SERVICE">Service</option></select></div><div className="space-y-2"><label className="text-xs font-bold uppercase text-[var(--app-muted)]" htmlFor="category-name">Category Name <span className="text-[var(--app-danger)]">*</span></label><input id="category-name" autoFocus required className="w-full" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Consulting" /></div><div className="space-y-2"><label className="text-xs font-bold uppercase text-[var(--app-muted)]" htmlFor="category-status">Status</label><select id="category-status" className="w-full" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as CatalogCategoryStatus }))}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></div>{error && <p className="rounded-lg bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] p-3 text-sm text-[var(--app-danger)]" role="alert">{error}</p>}<div className="app-modal-footer"><Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : isRename ? 'Save Changes' : 'Add Category'}</Button></div></form></div>;
}
