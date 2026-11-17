// Small shared view helpers for the popup and dashboard.

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// A colour-coded tag chip. `off` renders it muted (an unselected option).
export function tagChip(tag, { off = false, attrs = '' } = {}) {
  if (!tag) return '';
  return `<span class="tag${off ? ' off' : ''}" style="--c:${esc(tag.color)}" ${attrs}>${esc(tag.name)}</span>`;
}

export function tagChips(ids, tags) {
  return ids.map((id) => tagChip(tags.find((t) => t.id === id))).join('');
}

export function statusPill(status, STATUS) {
  const s = STATUS[status];
  return `<span class="status st-${status}">${s.icon} ${s.label}</span>`;
}
