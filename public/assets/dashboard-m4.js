const copied = new Set();

function noteCopied(id) {
  copied.add(id);
  const continueButton = document.querySelector('[data-aa-setup-continue]');
  if (continueButton && (copied.has('setup-key') || copied.has('setup-install-prompt'))) {
    continueButton.removeAttribute('aria-disabled');
  }
}

document.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('[data-aa-copy]') : null;
  const id = button?.getAttribute('data-aa-copy');
  if (id) {
    noteCopied(id);
  }
});
