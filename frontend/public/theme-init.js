// Applies the saved theme before first paint, to avoid a flash of the wrong theme.
(function () {
  try {
    var t = localStorage.getItem('projectflow.theme') || 'system';
    var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
