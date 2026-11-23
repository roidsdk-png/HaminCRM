function namePattern(name: string): RegExp {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped
    .replace(/[یيى]/g, '[یيى]')
    .replace(/[کك]/g, '[کك]')
    .replace(/[\s\u200c]+/g, '[\\s\\u200c]+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, 'gu');
}

export function maskKnownNames<T>(value: T, names: string[]): T {
  const patterns = [
    ...new Set(
      names.map((name) => name.trim()).filter((name) => name.length > 1),
    ),
  ]
    .sort((a, b) => b.length - a.length)
    .map(namePattern);
  function mask(item: unknown): unknown {
    if (typeof item === 'string')
      return patterns.reduce(
        (text, pattern) => text.replace(pattern, '[نام پوشانده‌شده]'),
        item,
      );
    if (Array.isArray(item)) return item.map(mask);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item).map(([key, child]) => [key, mask(child)]),
      );
    return item;
  }
  return mask(value) as T;
}
