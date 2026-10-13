export function logPage(query, params, alias = '') {
  const prefix = alias ? alias + '.' : '';
  const limit = Number(query.limit ?? 200);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw Object.assign(new Error('Limit must be between 1 and 200.'), {status:400});
  let condition = '';
  if (query.before !== undefined || query.beforeId !== undefined) {
    if (!/^\d{1,16}$/.test(String(query.before)) || typeof query.beforeId !== 'string' || !query.beforeId || query.beforeId.length > 50) throw Object.assign(new Error('Invalid log cursor.'), {status:400});
    params.push(query.before, query.beforeId);
    condition = ` AND (${prefix}timestamp,${prefix}id)<($${params.length-1}::bigint,$${params.length}::varchar)`;
  }
  params.push(limit);
  return { condition, suffix: ` ORDER BY ${prefix}timestamp DESC,${prefix}id DESC LIMIT $${params.length}` };
}
