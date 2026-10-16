/* Windbreaker version — bumped with every release merged to main (see CHANGELOG.md). */
(function (root) {
  var VERSION = '1.0';
  root.WB = root.WB || {};
  root.WB.VERSION = VERSION;
  if (typeof document === 'undefined') return;
  function show() {
    if (document.getElementById('wb-version')) return;
    var el = document.createElement('p');
    el.id = 'wb-version';
    el.textContent = 'v' + VERSION;
    el.style.cssText = 'margin:8px 0 16px;text-align:center;font-size:12px;opacity:.45;letter-spacing:.04em';
    var foot = document.querySelector('.home-foot');
    if (foot && foot.parentNode) foot.parentNode.insertBefore(el, foot.nextSibling);
    else document.body.appendChild(el);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
  else show();
})(typeof self !== 'undefined' ? self : this);
