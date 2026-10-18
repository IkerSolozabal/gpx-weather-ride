/**
 * Selector de salida para ordenador: botones de día y un campo de hora con − / +.
 * El valor real sigue en el <input type="datetime-local"> original (oculto), así el
 * resto de la app no cambia. En pantallas táctiles no se usa: se queda el selector
 * nativo de Android/iOS, que allí es mejor.
 */

import { t, getLang } from '../i18n.js';
import { formatClock, nextDays, parseClock, stepClock } from '../lib/clock.js';

const STEP = 15;

/** true en ordenadores con ratón (sin pantalla táctil como entrada principal). */
export const wantsCustomPicker = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/**
 * @param {HTMLInputElement} input  datetime-local original
 * @param {HTMLElement} field       contenedor del campo (se le añade la clase is-custom)
 * @param {{days: number}} opts     número de días seleccionables
 */
export function createStartPicker(input, field, { days = 16 } = {}) {
  field.classList.add('is-custom');
  input.hidden = true;
  input.tabIndex = -1;

  const box = document.createElement('div');
  box.className = 'start-picker';
  box.innerHTML = `
    <div class="day-strip" role="radiogroup"></div>
    <div class="clock">
      <button type="button" class="clock-step" data-step="-${STEP}"><span aria-hidden="true">−</span></button>
      <input type="text" class="clock-input" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="5">
      <button type="button" class="clock-step" data-step="${STEP}"><span aria-hidden="true">+</span></button>
    </div>`;
  field.appendChild(box);
  const strip = box.querySelector('.day-strip');
  const clock = box.querySelector('.clock-input');

  const read = () => {
    const [date = '', time = '00:00'] = (input.value || '').split('T');
    return { date, minutes: parseClock(time) ?? 0 };
  };

  /** Escribe en el input original y avisa al formulario como si lo hubiera cambiado el usuario. */
  const write = (date, minutes) => {
    input.value = `${date}T${formatClock(minutes)}`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    render();
  };

  function dayLabel(iso) {
    const d = new Date(`${iso}T12:00`);
    const loc = getLang() === 'en' ? 'en-GB' : 'es-ES';
    const [today, tomorrow] = nextDays(Date.now(), 2);
    const top = iso === today ? t('today') : iso === tomorrow ? t('tomorrow') : new Intl.DateTimeFormat(loc, { weekday: 'short' }).format(d).replace('.', '');
    const full = new Intl.DateTimeFormat(loc, { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
    return { top, num: d.getDate(), full };
  }

  let builtKey = '';
  function render() {
    const { date, minutes } = read();
    const list = nextDays(Date.now(), days);
    if (date && !list.includes(date)) list.unshift(date); // p. ej. una salida compartida de ayer
    // Solo se reconstruyen los botones si cambian los días o el idioma; si no, se marca el elegido
    // (así no se pierde el foco al moverse con el teclado).
    const key = `${getLang()}|${list.join(',')}`;
    if (key !== builtKey) {
      builtKey = key;
      strip.innerHTML = list
        .map((iso) => {
          const l = dayLabel(iso);
          return `<button type="button" class="day-chip" role="radio" data-date="${iso}" title="${l.full}">
            <span class="day-top">${l.top}</span><span class="day-num">${l.num}</span></button>`;
        })
        .join('');
    }
    for (const chip of strip.querySelectorAll('.day-chip')) {
      const on = chip.dataset.date === date;
      chip.classList.toggle('is-on', on);
      chip.setAttribute('aria-checked', String(on));
      chip.tabIndex = on ? 0 : -1;
    }
    if (document.activeElement !== clock) clock.value = formatClock(minutes);
    box.querySelector('[data-step^="-"]').setAttribute('aria-label', t('timeEarlier'));
    box.querySelector('[data-step]:not([data-step^="-"])').setAttribute('aria-label', t('timeLater'));
    clock.setAttribute('aria-label', t('startTime'));
    strip.setAttribute('aria-label', t('startDay'));
    const on = strip.querySelector('.is-on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  strip.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.day-chip');
    if (chip) write(chip.dataset.date, read().minutes);
  });
  // Flechas izquierda/derecha para moverse entre días (patrón de radiogroup).
  strip.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    const chips = [...strip.querySelectorAll('.day-chip')];
    const i = chips.findIndex((c) => c.classList.contains('is-on'));
    const next = chips[Math.max(0, Math.min(chips.length - 1, i + (ev.key === 'ArrowRight' ? 1 : -1)))];
    if (!next) return;
    ev.preventDefault();
    write(next.dataset.date, read().minutes);
    strip.querySelector('.is-on')?.focus();
  });
  // Rueda del ratón sobre la tira de días: desplazamiento horizontal.
  strip.addEventListener('wheel', (ev) => {
    if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) {
      strip.scrollLeft += ev.deltaY;
      ev.preventDefault();
    }
  }, { passive: false });

  box.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.clock-step');
    if (!btn) return;
    const { date, minutes } = read();
    write(date, stepClock(minutes, Number(btn.dataset.step)));
  });

  const commit = () => {
    const minutes = parseClock(clock.value);
    const current = read();
    if (minutes === null || minutes === current.minutes) {
      clock.value = formatClock(current.minutes);
      return;
    }
    write(current.date, minutes);
  };
  clock.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      const { date, minutes } = read();
      write(date, stepClock(minutes, ev.key === 'ArrowUp' ? STEP : -STEP));
      clock.value = formatClock(read().minutes);
      clock.select();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      commit();
      clock.select();
    }
  });
  clock.addEventListener('focus', () => clock.select());
  clock.addEventListener('blur', commit);

  render();
  return { refresh: render };
}
