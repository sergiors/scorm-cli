import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import contentPackage from 'virtual:package-data';
import { PackageApp } from './App';
import './styles.css';

const container = document.getElementById('root');

if (container) {
  createRoot(container).render(
    <StrictMode>
      <PackageApp contentPackage={contentPackage} />
    </StrictMode>,
  );
}
