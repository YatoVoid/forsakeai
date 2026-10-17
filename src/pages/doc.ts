import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/600.css';
import '../app/app.css';
import './doc.css';

try {
  const theme = localStorage.getItem('plainhand.theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  // Falls back to the system theme.
}
