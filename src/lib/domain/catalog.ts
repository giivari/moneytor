export type CatalogItem = Readonly<{
  id: string;
  displayName: string;
  isActive: boolean;
  isBuiltIn: boolean;
  systemKey: string | null;
}>;

export function validateCatalogName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 120 || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error("Catalog name must contain 1–120 printable characters");
  }
  return trimmed;
}

export function validateSystemKey(key: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(key) || key.length > 80) {
    throw new Error("Invalid stable system key");
  }
  return key;
}

export function assertUuid(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Invalid relation ID");
  }
  return id;
}

export function customCatalogItem(id: string, displayName: string): CatalogItem {
  if (!id.trim()) throw new Error("Catalog ID is required");
  return { id, displayName: validateCatalogName(displayName), isActive: true, isBuiltIn: false, systemKey: null };
}

export function assertUniqueSystemKeys(items: readonly CatalogItem[]): void {
  const keys = new Set<string>();
  for (const item of items) {
    if (item.isBuiltIn && item.systemKey === null) throw new Error("Built-in catalog item requires a system key");
    if (!item.isBuiltIn && item.systemKey !== null) throw new Error("Custom catalog item cannot claim a system key");
    if (item.systemKey === null) continue;
    validateSystemKey(item.systemKey);
    if (keys.has(item.systemKey)) throw new Error(`Duplicate system key: ${item.systemKey}`);
    keys.add(item.systemKey);
  }
}

export function requireActive<T extends { id: string; isActive: boolean }>(item: T | null | undefined, id: string): T {
  if (!item || item.id !== id) throw new Error(`Unknown reference: ${id}`);
  if (!item.isActive) throw new Error(`Inactive reference: ${id}`);
  return item;
}
