$ErrorActionPreference = 'Stop'

# --- header.ejs: remove global toggle include ---
$headerPath = 'views/partials/header.ejs'
$headerText = Get-Content -Raw -Encoding UTF8 $headerPath
$headerUpdated = [regex]::Replace($headerText, "\r?\n\s*<%- include\('theme-toggle'\) %>", '', [System.Text.RegularExpressions.RegexOptions]::None)
if ($headerUpdated -eq $headerText) { throw "Patch failed: $headerPath" }
Set-Content -Encoding UTF8 -Path $headerPath -Value $headerUpdated

# --- gm control-panel.ejs: add theme controls ---
$cpPath = 'views/gm/control-panel.ejs'
$cpText = Get-Content -Raw -Encoding UTF8 $cpPath

if ($cpText -notmatch 'data-theme-choice') {
  $anchorMatch = [regex]::Match(
    $cpText,
    '\r?\n\s*<div class="gm-cp__group">\s*\r?\n\s*<h2>Pricing Controls</h2>',
    [System.Text.RegularExpressions.RegexOptions]::Multiline
  )
  if (!$anchorMatch.Success) { throw "Anchor not found: $cpPath" }

  $themeBlock = @"

  <div class=\"gm-cp__group\">
    <h2>Theme</h2>
    <div class=\"gm-cp__theme\" role=\"group\" aria-label=\"Theme\">
      <button type=\"button\" class=\"btn gm-theme-btn\" data-theme-choice=\"default\" aria-pressed=\"false\">Default</button>
      <button type=\"button\" class=\"btn gm-theme-btn\" data-theme-choice=\"night\" aria-pressed=\"false\">Night</button>
      <button type=\"button\" class=\"btn gm-theme-btn\" data-theme-choice=\"github\" aria-pressed=\"false\">Github</button>
    </div>
  </div>
"@

  $cpText = $cpText.Insert($anchorMatch.Index, $themeBlock)
}

if ($cpText -notmatch 'gm-theme-btn--active') {
  $styleMatch = [regex]::Match($cpText, '\r?\n</style>')
  if (!$styleMatch.Success) { throw "Style end not found: $cpPath" }

  $styleBlock = @"
  .gm-cp__theme { padding: 12px 14px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .gm-cp__theme .gm-theme-btn { border-radius: 8px; }
  .gm-cp__theme .gm-theme-btn--active { box-shadow: inset 0 0 0 2px #111827; }
"@

  $cpText = $cpText.Insert($styleMatch.Index, "`r`n$styleBlock")
}

if ($cpText -notmatch 'initGmThemePanel') {
  $iifeMatch = [regex]::Match($cpText, '\(function \(\) \{')
  if (!$iifeMatch.Success) { throw "IIFE not found: $cpPath" }

  $jsBlock = @"

    (function initGmThemePanel() {
      var root = document.documentElement;
      var buttons = document.querySelectorAll('[data-theme-choice]');
      if (!buttons || !buttons.length) return;

      function normalize(theme) {
        var value = String(theme || '').toLowerCase();
        if (value === 'default' || value === 'night' || value === 'github') return value;
        return 'default';
      }

      function getTheme() {
        var t = root.getAttribute('data-theme');
        if (t) return normalize(t);
        if (root.classList.contains('github-mode')) return 'github';
        if (root.classList.contains('night-mode')) return 'night';
        return 'default';
      }

      function apply(theme) {
        var t = normalize(theme);
        if (window.AETheme && typeof window.AETheme.setTheme === 'function') {
          window.AETheme.setTheme(t);
          return;
        }
        root.dataset.theme = t;
        root.classList.toggle('night-mode', t === 'night');
        root.classList.toggle('github-mode', t === 'github');
        try {
          window.localStorage.setItem('ae_theme', t);
          window.localStorage.setItem('ae_night_mode', t === 'night' ? '1' : '0');
        } catch (e) {}
      }

      function sync() {
        var cur = getTheme();
        buttons.forEach(function (btn) {
          var t = normalize(btn.getAttribute('data-theme-choice'));
          var active = t === cur;
          btn.setAttribute('aria-pressed', active ? 'true' : 'false');
          btn.classList.toggle('gm-theme-btn--active', active);
        });
      }

      buttons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          apply(btn.getAttribute('data-theme-choice'));
          sync();
        });
      });

      window.addEventListener('storage', sync);
      sync();
    })();
"@

  $insertAt = $iifeMatch.Index + $iifeMatch.Length
  $cpText = $cpText.Insert($insertAt, $jsBlock)
}

Set-Content -Encoding UTF8 -Path $cpPath -Value $cpText

Write-Output 'patched gm theme location'
