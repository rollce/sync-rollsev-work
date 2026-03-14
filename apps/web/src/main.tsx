import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#0f766e'
    },
    secondary: {
      main: '#ca8a04'
    },
    background: {
      default: '#f4f7f5',
      paper: '#ffffff'
    }
  },
  shape: {
    borderRadius: 12
  },
  typography: {
    fontFamily: '"Space Grotesk", "Manrope", "Segoe UI", sans-serif'
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </StrictMode>
);
