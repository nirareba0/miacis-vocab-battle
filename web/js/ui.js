/** Small local icon set; navigation never starts a match or spends currency. */
const paths = {
 home:'<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
 battle:'<path d="m5 3 14 14-2 2L3 5V3zM16 3l5 0v2l-6 6M8 14l-5 5m0-4 6 6m6-6 6 6m-2-2 2-4"/>',
 book:'<path d="M12 5Q6 2 3 5v15q4-3 9 0 5-3 9 0V5q-4-3-9 0v15"/>',
 gacha:'<rect x="5" y="3" width="14" height="18" rx="4"/><path d="M5 13h14M9 17h6M12 6v5M9.5 8.5h5"/>',
 closet:'<path d="M9 5a3 3 0 1 1 4 3l-1 1v2L3 17v3h18v-3l-9-6"/>',
 ranking:'<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v3q0 4 5 4m7-7h4v3q0 4-5 4M12 13v7m-4 0h8"/>',
 record:'<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6m-6 4h6m-6 4h3"/>',
 play:'<rect x="3" y="4" width="18" height="16" rx="4"/><path d="m10 8 6 4-6 4z"/>',
 arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>'
};
export function icon(name) { return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.home}</svg>`; }
export function updateNavigation(route, signedIn) {
  document.getElementById('app-navigation')?.remove();
  const visible = signedIn && !['#/battle', '#/streak', '#/knock'].includes(route);
  document.body.classList.toggle('has-navigation', visible);
  if (!visible) return;
  const nav = document.createElement('nav');
  nav.id = 'app-navigation';
  nav.setAttribute('aria-label', 'メインメニュー');
  nav.innerHTML = [['home','ホーム','home'],['zukan','図鑑','book'],['gacha','ガチャ','gacha'],['closet','着せ替え','closet'],['ranking','順位','ranking']].map(([screen,label,glyph])=>`<a href="#/${screen}" ${route === '#/'+screen ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span></a>`).join('');
  document.body.append(nav);
}
