export function initializeProfile() {
  const root = document.getElementById('profile');
  const button = document.getElementById('profileBtn');
  const dropdown = document.getElementById('profileDropdown');
  function close() {
    dropdown.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }
  button.addEventListener('click', () => {
    dropdown.hidden = !dropdown.hidden;
    button.setAttribute('aria-expanded', String(!dropdown.hidden));
  });
  document.addEventListener('click', event => { if (!root.contains(event.target)) close(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !dropdown.hidden) { close(); button.focus(); }
  });
  root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget)) close(); });
  return { show() { root.hidden = false; }, hide() { close(); root.hidden = true; } };
}
