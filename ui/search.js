import { SEARCH_TYPES, searchProfiles } from '../services/search/index.js';
import { listProfiles } from '../storage/profiles.js';

export function wireSearch(onOpen) {
  const form = document.getElementById('workspace-search-form');
  const profiles = form.elements.profile;
  const query = form.elements.query;
  const status = document.getElementById('workspace-search-status');
  const results = document.getElementById('workspace-search-results');
  let generation = 0;

  function refreshProfiles() {
    const previous = profiles.value;
    profiles.replaceChildren(new Option('All profiles', ''),
      ...listProfiles().map(profile => new Option(profile, profile)));
    if ([...profiles.options].some(option => option.value === previous)) profiles.value = previous;
  }

  async function run() {
    const request = ++generation;
    const term = query.value.trim();
    results.replaceChildren();
    status.textContent = term ? 'Searching…' : '';
    if (!term) return;

    try {
      const scopes = profiles.value ? [profiles.value] : listProfiles();
      const { results: matches, total, skipped } = await searchProfiles(term, scopes, { type: form.elements.type.value });
      if (request !== generation) return;

      const fragment = document.createDocumentFragment();
      for (const match of matches) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'workspace-search-result';
        const title = document.createElement('strong');
        title.textContent = match.title;
        const context = document.createElement('span');
        const date = String(match.date || '').slice(0, 10);
        context.textContent = [match.profile, SEARCH_TYPES[match.type].label, match.resource, date].filter(Boolean).join(' · ');
        button.append(title, context);
        if (match.preview) {
          const preview = document.createElement('span');
          preview.textContent = match.preview;
          button.append(preview);
        }
        button.addEventListener('click', async () => {
          if (results.inert) return;
          results.inert = true;
          try {
            await onOpen(match);
          } finally {
            results.inert = false;
          }
        });
        item.append(button);
        fragment.append(item);
      }
      results.replaceChildren(fragment);
      const count = total === 1 ? '1 match' : `${total} matches`;
      const scope = skipped.length ? ` Could not read ${skipped.length} profile/type combination(s).` : '';
      status.textContent = (total > matches.length ? `Showing ${matches.length} of ${count}. Narrow your search to see more.`
        : `${count}.`) + scope;
    } catch (error) {
      if (request === generation) status.textContent = 'Search could not be completed.';
      console.error('[Search]', error);
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    run();
  });
  form.addEventListener('change', event => {
    if (event.target.matches('select')) run();
  });
  refreshProfiles();
  return refreshProfiles;
}
