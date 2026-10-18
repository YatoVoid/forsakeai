import '@fontsource-variable/schibsted-grotesk/wght.css';
import '../app/app.css';
import './doc.css';

try {
  const theme = localStorage.getItem('forsakeai.theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  // Falls back to the system theme.
}
