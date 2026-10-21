// Ventana de novedades: la app la abre sola con las que no has visto y desde el pie con todas.
import { getLang, newsItems } from '../i18n.js';

export function createNews(dialog, list) {
  let shown = [];

  function render() {
    list.replaceChildren(
      ...shown.map((release) => {
        const section = document.createElement('section');
        const date = document.createElement('h3');
        date.className = 'news-date';
        date.textContent = new Date(`${release.id}T12:00`).toLocaleDateString(getLang(), { day: 'numeric', month: 'long', year: 'numeric' });
        const ul = document.createElement('ul');
        ul.className = 'news-items';
        for (const text of newsItems(release)) {
          const li = document.createElement('li');
          li.textContent = text;
          ul.append(li);
        }
        section.append(date, ul);
        return section;
      }),
    );
  }

  return {
    open(releases) {
      shown = releases;
      render();
      if (!dialog.open) dialog.showModal();
      list.scrollTop = 0;
    },
    refresh() {
      if (dialog.open) render();
    },
  };
}
