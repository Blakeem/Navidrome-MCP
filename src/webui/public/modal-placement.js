const topbar = document.querySelector('.topbar');

// The top bar's height varies with the safe-area inset and phone width,
// so a panel placed below it reads the bar's bottom edge instead of a fixed offset.
export function placeBelowTopbar(panel) {
  const top = Math.max(0, topbar.getBoundingClientRect().bottom);
  panel.style.setProperty('--modal-top', `${top}px`);
}
