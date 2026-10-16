// Solo para desarrollo sin `npm install`: si no hay copia local de Leaflet
// (web/vendor/leaflet), la carga desde unpkg. En Docker la copia local siempre existe.
(function () {
  if (window.L) return;
  var v = '1.9.4';
  var css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'https://unpkg.com/leaflet@' + v + '/dist/leaflet.css';
  document.head.appendChild(css);
  document.write('<script src="https://unpkg.com/leaflet@' + v + '/dist/leaflet.js"><\/script>');
})();
