import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import MapEditor from './editor/MapEditor.tsx';
import './style.css';

const isEditor = location.pathname.startsWith('/editor');
createRoot(document.getElementById('root')!).render(<StrictMode>{isEditor ? <MapEditor /> : <App />}</StrictMode>);
