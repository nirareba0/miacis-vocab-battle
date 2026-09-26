/** Fixed, trusted vector accessories aligned to the mascot sprite's 100×100 canvas. */
const glasses = '<circle cx="42.5" cy="36.7" r="3.3"/><circle cx="49.2" cy="36.7" r="3.3"/><path d="M45.8 36.5h.2M39 36l-2-1M52.5 36l3-1"/>';
const ribbon = '<path d="M48 47l-6-3v7l6-3 6 3v-7z"/><circle cx="48" cy="47.5" r="1.4" fill="#ffe58a"/>';
const medal = (color) => `<path d="M43 44l5 8 6-8" fill="none" stroke="#f078a6" stroke-width="2"/><circle cx="48" cy="53" r="3.5" fill="${color}"/><path d="M48 51v4" stroke="#fff5bf"/>`;
const parts = {
  hat_cap: '<path d="M38 23q0-12 17-8l5 9z" fill="#5bc5e8"/><path d="M37 23q-7 4 7 4l16-3" fill="#2585b8"/>',
  hat_straw: '<ellipse cx="50" cy="24" rx="15" ry="3" fill="#edbd57"/><path d="M41 23l2-10h13l3 10z" fill="#ffe49a"/><path d="M42 21h16" stroke="#e98883" stroke-width="3"/>',
  hat_silk: '<path d="M42 23l-2-14h17l-1 14z" fill="#35324c"/><path d="M42 20h14" stroke="#b69be9" stroke-width="3"/><ellipse cx="49" cy="24" rx="14" ry="2" fill="#35324c"/>',
  hat_grad: '<path d="M42 19v7q7 3 14-1v-7" fill="#423956"/><path d="M34 17l15-7 16 7-16 6z" fill="#34334d"/><path d="M62 18v12" stroke="#f6d163" stroke-width="1.5"/>',
  hat_ribbon: '<g transform="translate(8 -30)"><path d="M48 47l-7-5v10l7-4 7 4V42z" fill="#ef8ab9"/><circle cx="48" cy="47" r="2" fill="#ffe4f1"/></g>',
  hat_rescue: '<path d="M37 24q0-15 23-6l2 7z" fill="#f47975"/><path d="M36 25h27" stroke="#fff0b7" stroke-width="2"/><path d="M49 16v7M46 19.5h6" stroke="white" stroke-width="2"/>',
  hat_safari: '<path d="M38 23q1-13 20-6l3 7z" fill="#9fae73"/><ellipse cx="49" cy="25" rx="15" ry="2.5" fill="#cbd69a"/><path d="M48 14v9" stroke="#768752"/>',
  hat_crown: '<path d="M39 15l6 5 5-10 5 10 7-5-3 12H41z" fill="#ffd260"/><path d="M42 24h16" stroke="#fff4be" stroke-width="2"/><circle cx="50" cy="22" r="1.8" fill="#ba77d9"/>',
  face_glasses: `<g fill="#ffffff33" stroke="#433a72" stroke-width=".9">${glasses}</g>`,
  face_sun: `<g fill="#292344" stroke="#7b66ac" stroke-width=".8">${glasses}</g><path d="M40 35l3 2M47 35l3 2" stroke="#93dded"/>`,
  face_monocle: '<circle cx="49" cy="36.5" r="3.5" fill="#ffffff33" stroke="#dda64a"/><path d="M52.5 37q5 11-2 14" fill="none" stroke="#dda64a" stroke-width=".6"/>',
  face_disguise: `<g fill="#ffffff33" stroke="#463341" stroke-width="1">${glasses}</g><path d="M46 41q-4-3-7 2 5 2 7-1 3 3 7 0-3-4-7-1" fill="#463341"/>`,
  face_mask: '<path d="M38 39l15-1-1 7q-7 4-13-1z" fill="#f7f9ff"/><path d="M40 41h10M41 43h8" stroke="#c5cbe1" stroke-width=".6"/>',
  face_goggle: '<path d="M37 33h19v7H37z" fill="#78e5ef" stroke="#7774a0" stroke-width="1.5"/><path d="M40 34l4 5m5-5 4 5" stroke="#e4ffff"/>',
  face_opera: '<path d="M37 32q6 3 10 0l-1 10q-9 0-9-10" fill="#f4eafa"/><path d="M39 36q3-3 5 0" fill="none" stroke="#734d9c"/>',
  face_fox: '<path d="M37 39l-1-10 7 5 6-1 7-4-1 11-9 5z" fill="#fff4dc"/><path d="M39 36l4 2m7 0 3-3M44 42l2 1 2-2" fill="none" stroke="#dc7270" stroke-width="1.4"/>',
  neck_muffler: '<path d="M41 45q9 3 15-1l1 4q-8 4-16 1z" fill="#f08084"/><path d="M50 49l-2 10 5 1 1-11" fill="#f08084"/><path d="M49 56l4 1" stroke="#ffe0b1" stroke-width="2"/>',
  neck_tie: `<g fill="#9acdf1">${ribbon}</g>`,
  neck_beads: '<path d="M41 45q7 13 15-1" fill="none" stroke="#ab754e" stroke-width="2.8" stroke-dasharray=".2 3" stroke-linecap="round"/>',
  neck_bronze: medal('#c38c62'),
  neck_gold: medal('#f6c858'),
  neck_bell: '<path d="M41 45q8 7 15-1" fill="none" stroke="#c3c9e9"/><path d="M45 52q0-6 6-1l1 3h-8z" fill="#e0e7f6"/><circle cx="48" cy="55" r="1" fill="#8992bf"/>',
  neck_pendant: '<path d="M41 45l7 9 8-10" fill="none" stroke="#c7cce5"/><path d="M48 51l3 4-3 5-3-5z" fill="#73d9ee"/><path d="M48 52v6" stroke="#ebffff"/>',
  neck_star: '<path d="M41 45q7 8 15-1" fill="none" stroke="#ffe1a0"/><path d="M48 49l1.5 3 3 .5-2 2 .5 3-3-1.5-3 1.5 .5-3-2-2 3-.5z" fill="#ffe18a"/>'
};
export function renderAccessory(item, slot) {
  if (!item || typeof item.id !== 'string' || !item.id.startsWith(`${slot}_`) || !Object.hasOwn(parts, item.id)) return '';
  return `<svg class="miacis-part miacis-part-${slot}" aria-hidden="true" viewBox="0 0 100 100" style="position:absolute;inset:0;width:100%;height:100%;z-index:4;pointer-events:none;overflow:visible"><g stroke="#514286" stroke-width=".65" stroke-linejoin="round" stroke-linecap="round">${parts[item.id]}</g></svg>`;
}
