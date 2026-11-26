// Last line of defence against a blank page: if the app has not started within 12 seconds
// (failed download, stale dev cache, very old browser), reload once, then show instructions.
(function () {
  var KEY = 'sc_boot_reloaded';
  setTimeout(function () {
    if (document.documentElement.getAttribute('data-app') === 'mounted') {
      sessionStorage.removeItem(KEY);
      return;
    }
    if (!sessionStorage.getItem(KEY)) {
      sessionStorage.setItem(KEY, '1');
      location.reload();
      return;
    }
    var root = document.getElementById('root');
    if (!root) return;
    root.innerHTML =
      '<div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;font-family:system-ui,Segoe UI,sans-serif;color:#14213D;background:#F6F7FB">' +
      '<div style="font-size:22px;font-weight:700;margin-bottom:8px">Shastra Connect could not start</div>' +
      '<div style="max-width:420px;font-size:14px;color:#5B6478;line-height:1.5">Please check your internet connection and use an up-to-date browser (Chrome, Edge, Safari or Firefox). ' +
      'If you are running it on this computer, close the Shastra window and double-click START-HERE.cmd again.</div>' +
      '<button id="sc-retry" style="margin-top:20px;padding:10px 18px;border:0;border-radius:12px;background:#14213D;color:#fff;font-weight:600;cursor:pointer">Try again</button></div>';
    document.getElementById('sc-retry').onclick = function () {
      sessionStorage.removeItem(KEY);
      location.reload();
    };
  }, 12000);
})();
