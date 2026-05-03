// P001-PAI-0032: KV cursor-based pagination helper.
// KV list() returns max 1000 keys per call. This helper loops using the
// cursor until list_complete is true, preventing silent data loss.

/**
 * Lists ALL keys from a KV namespace matching the given prefix,
 * handling cursor-based pagination transparently.
 */
export async function listAllKeys(
  kv: KVNamespace,
  options: KVNamespaceListOptions = {},
): Promise<KVNamespaceListKey<unknown>[]> {
  const allKeys: KVNamespaceListKey<unknown>[] = [];
  let cursor: string | undefined;

  // P001-PAI-0032: loop until KV signals list_complete
  do {
    const result = await kv.list({ ...options, cursor });
    allKeys.push(...result.keys);
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  return allKeys;
}
