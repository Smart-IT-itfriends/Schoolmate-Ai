function normalizeMenuText(text) {
  if (!text) {
    return '';
  }

  return String(text)
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
    .toLowerCase();
}

function matchesMenuText(inputText, expectedText) {
  return normalizeMenuText(inputText) === normalizeMenuText(expectedText);
}

module.exports = {
  normalizeMenuText,
  matchesMenuText,
};
